// Background jobs on the zerostash-jobs queue, one message per invocation (max_batch_size 1,
// so each job gets the Free plan's full 10 ms CPU and 50 D1 queries). A failing job is retried
// by the queue (max_retries) and marked failed on its last attempt.
import { parseFeed } from '../shared/feed';
import type { RuleEvent, WebhookEvent } from '../shared/schemas';
import { aiProvider, readCapped, styleTag, suggest } from './ai';
import { finishAi, getBookmark, markAiPending } from './domain/bookmarks';
import { feedRow, importItems, recordFetch } from './domain/feeds';
import { allRules, applyRules } from './domain/rules';
import { getSettings } from './domain/settings';
import { listTags, updateTags } from './domain/tags';
import { webhookRow } from './domain/webhooks';
import { emit } from './events';
import { isPrivateHost } from '../shared/og';
import { OWNER_ID } from '../shared/schemas';
import type { Ctx } from './service';

export type Job =
	| { kind: 'ai'; bookmarkId: string; tag: boolean; summarize: boolean }
	| { kind: 'rules'; bookmarkId: string; events: RuleEvent[] }
	| { kind: 'webhook'; webhookId: string; operation: WebhookEvent; bookmarkId: string; url?: string; type?: string }
	| { kind: 'feed'; feedId: string }
	| { kind: 'feedTags'; bookmarkId: string; names: string[] };

export const MAX_RETRIES = 3; // keep in step with wrangler.jsonc queues.consumers[0].max_retries
const UA = 'Mozilla/5.0 (compatible; Zerostash/1.0; +https://github.com/jammutkarsh/zerostash)';

/** After saves: queue tagging/summarising if AI is on (Karakeep's per-user settings default to on). */
export async function queueAi(ctx: Ctx, bookmarkIds: string[]): Promise<{ tag: boolean; summarize: boolean } | null> {
	if (!bookmarkIds.length || !aiProvider(ctx.env)) return null;
	const s = await getSettings(ctx.env.DB);
	const what = { tag: s.autoTaggingEnabled !== false, summarize: s.autoSummarizationEnabled !== false };
	if (!what.tag && !what.summarize) return null;
	await markAiPending(ctx.env.DB, bookmarkIds, what.tag, what.summarize);
	await ctx.env.JOBS.sendBatch(bookmarkIds.map((bookmarkId) => ({ body: { kind: 'ai', bookmarkId, ...what } satisfies Job })));
	return what;
}

async function runAi(ctx: Ctx, job: Extract<Job, { kind: 'ai' }>): Promise<void> {
	const db = ctx.env.DB;
	const b = await getBookmark(db, job.bookmarkId);
	if (!b) return; // deleted meanwhile
	const s = await getSettings(db);
	// Curated tags (a Karakeep setting): the AI may only pick from these.
	const curated = s.curatedTagIds?.length ? await listTags(db, { ids: s.curatedTagIds.slice(0, 90) }) : null;
	const known = curated ?? (await listTags(db, { limit: 50 }));
	const result = await suggest(ctx.env, b, known.map((t) => t.name), s.inferredTagLang || 'English');
	let added: string[] = [];
	if (job.tag) {
		const allowed = curated ? new Map(curated.map((t) => [t.name.toLowerCase(), t.name])) : null;
		const names = result.tags
			.map((t) => (allowed ? allowed.get(t.trim().toLowerCase()) : styleTag(t, s.tagStyle)))
			.filter((t): t is string => !!t)
			.slice(0, 5);
		const before = new Set(b.tags.map((t) => t.id));
		if (names.length) added = (await updateTags(db, b.id, names.map((tagName) => ({ tagName, attachedBy: 'ai' as const })), [])).attached.filter((id) => !before.has(id));
	}
	await finishAi(db, b.id, {
		tagging: job.tag ? 'success' : undefined,
		summarization: job.summarize ? (result.summary ? 'success' : 'failure') : undefined,
		summary: job.summarize ? result.summary || undefined : undefined,
	});
	await emit(ctx, [{ bookmarkId: b.id, rules: added.map((tagId) => ({ type: 'tagAdded', tagId })), webhook: 'ai tagged' }]);
}

async function runRules(ctx: Ctx, job: Extract<Job, { kind: 'rules' }>): Promise<void> {
	const b = await getBookmark(ctx.env.DB, job.bookmarkId);
	if (b) await applyRules(ctx.env.DB, b, job.events, await allRules(ctx.env.DB, true));
}

async function runWebhook(ctx: Ctx, job: Extract<Job, { kind: 'webhook' }>): Promise<void> {
	const hook = await webhookRow(ctx.env.DB, job.webhookId);
	if (!hook || !hook.events.includes(job.operation)) return; // removed or changed meanwhile
	const b = job.operation === 'deleted' ? null : await getBookmark(ctx.env.DB, job.bookmarkId);
	if (!b && job.operation !== 'deleted') return;
	const res = await fetch(hook.url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(hook.token ? { authorization: `Bearer ${hook.token}` } : {}) },
		body: JSON.stringify({
			jobId: crypto.randomUUID(),
			bookmarkId: job.bookmarkId,
			userId: OWNER_ID,
			url: b ? (b.content.type === 'link' ? b.content.url : undefined) : job.url,
			type: b?.content.type ?? job.type,
			operation: job.operation,
		}),
		signal: AbortSignal.timeout(10_000),
	});
	await res.body?.cancel();
	if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

// ponytail: a 1 MB cap and regex parsing keep a fetch inside the 10 ms CPU budget for typical
// feeds; very large feeds are cut off (their newest items still come through).
const FEED_MAX_BYTES = 1024 * 1024;

async function runFeed(ctx: Ctx, job: Extract<Job, { kind: 'feed' }>): Promise<void> {
	const db = ctx.env.DB;
	const feed = await feedRow(db, job.feedId).catch(() => null);
	if (!feed || !feed.enabled) return;
	try {
		if (isPrivateHost(feed.url)) throw new Error('private host');
		const res = await fetch(feed.url, {
			redirect: 'follow',
			signal: AbortSignal.timeout(15_000),
			headers: {
				'user-agent': UA,
				accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
				...(feed.etag ? { 'if-none-match': feed.etag } : {}),
				...(feed.last_modified ? { 'if-modified-since': feed.last_modified } : {}),
			},
		});
		if (res.status === 304) return void (await recordFetch(db, feed.id, { ok: true }));
		if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
		const xml = new TextDecoder().decode(await readCapped(res, FEED_MAX_BYTES));
		const added = await importItems(db, feed.id, parseFeed(xml, res.url || feed.url));
		await recordFetch(db, feed.id, { ok: true, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') });
		if (!added.length) return;
		const ids = added.map((a) => a.id);
		await queueAi(ctx, ids);
		const withTags = feed.import_tags ? added.filter((a) => a.item.categories.length) : [];
		if (withTags.length) await ctx.env.JOBS.sendBatch(withTags.map((a) => ({ body: { kind: 'feedTags', bookmarkId: a.id, names: a.item.categories.slice(0, 10) } satisfies Job })));
		await emit(ctx, ids.map((bookmarkId) => ({ bookmarkId, rules: [{ type: 'bookmarkAdded' }], webhook: 'created' })));
	} catch (err) {
		// No retry: the next cron run past the interval tries again.
		console.log(JSON.stringify({ msg: 'feed fetch failed', feed: feed.id, error: String(err) }));
		await recordFetch(db, feed.id, { ok: false });
	}
}

export async function runJob(ctx: Ctx, job: Job, lastAttempt: boolean): Promise<void> {
	try {
		if (job.kind === 'ai') await runAi(ctx, job);
		else if (job.kind === 'rules') await runRules(ctx, job);
		else if (job.kind === 'webhook') await runWebhook(ctx, job);
		else if (job.kind === 'feed') await runFeed(ctx, job);
		else if (job.kind === 'feedTags') await updateTags(ctx.env.DB, job.bookmarkId, job.names.map((tagName) => ({ tagName: tagName.trim(), attachedBy: 'human' as const })).filter((t) => t.tagName), []);
	} catch (err) {
		console.log(JSON.stringify({ msg: 'job failed', job, lastAttempt, error: String(err) }));
		if (!lastAttempt) throw err;
		if (job.kind === 'ai') {
			await finishAi(ctx.env.DB, job.bookmarkId, { tagging: job.tag ? 'failure' : undefined, summarization: job.summarize ? 'failure' : undefined });
		}
	}
}

/** On demand (Karakeep's "summarize" button): runs now, in the request. */
export async function summarizeNow(env: Env, bookmarkId: string) {
	const b = await getBookmark(env.DB, bookmarkId);
	if (!b) return null;
	const s = await getSettings(env.DB);
	await markAiPending(env.DB, [b.id], false, true);
	try {
		const result = await suggest(env, b, [], s.inferredTagLang || 'English');
		await env.DB.prepare('UPDATE bookmarks SET summary = ?, summarization_status = ?, updated_at = ? WHERE id = ?')
			.bind(result.summary || null, result.summary ? 'success' : 'failure', Date.now(), b.id)
			.run();
	} catch (err) {
		await finishAi(env.DB, b.id, { summarization: 'failure' });
		throw err;
	}
	return getBookmark(env.DB, b.id);
}
