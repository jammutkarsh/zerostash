// Rules, webhooks and feeds end to end over the D1 stand-in: service write → emitted jobs →
// job run → effect. fetch is stubbed for webhook delivery and feed downloads.
import { afterEach, expect, test } from 'bun:test';
import { NewBookmark, NewList, NewRule, type RuleCondition } from '../shared/schemas';
import { getBookmark } from './domain/bookmarks';
import { allFeeds, createFeed } from './domain/feeds';
import { createList } from './domain/lists';
import { conditionHolds, createRule } from './domain/rules';
import { createTag } from './domain/tags';
import { createWebhook } from './domain/webhooks';
import { type Job, runJob } from './jobs';
import { addBookmark, changeTags, editBookmark, removeBookmark } from './service';
import { testDb } from './test/d1';

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

function harness() {
	const db = testDb();
	const jobs: Job[] = [];
	const pending: Promise<unknown>[] = [];
	const env = {
		DB: db,
		ZEROSTASH_AI: 'off',
		JOBS: { send: async (b: Job) => void jobs.push(b), sendBatch: async (bs: { body: Job }[]) => void jobs.push(...bs.map((b) => b.body)) },
		FILES: { delete: async () => {} },
	} as unknown as Env;
	const ctx = { env, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
	/** Let fire-and-forget work finish, then hand over the queued jobs. */
	const drain = async () => {
		while (pending.length) await pending.shift();
		return jobs.splice(0);
	};
	return { db, ctx, drain };
}

test('rule: when a github.com link is added, tag it and add it to a list', async () => {
	const { db, ctx, drain } = harness();
	globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch; // crawl fails quietly
	const tag = await createTag(db, 'code');
	const list = await createList(db, NewList.parse({ name: 'Repos', icon: '📦' }));
	await createRule(
		db,
		NewRule.parse({
			name: 'Repos',
			event: { type: 'bookmarkAdded' },
			condition: { type: 'urlContains', str: 'GITHUB.com' },
			actions: [{ type: 'addTag', tagId: tag.id }, { type: 'addToList', listId: list.id }, { type: 'downloadFullPageArchive' }],
		}),
	);
	const gh = (await addBookmark(ctx, NewBookmark.parse({ type: 'link', url: 'https://github.com/x/y' }))).bookmark;
	const other = (await addBookmark(ctx, NewBookmark.parse({ type: 'link', url: 'https://example.com/z' }))).bookmark;
	const jobs = await drain();
	expect(jobs.filter((j) => j.kind === 'rules').length).toBe(2);
	for (const j of jobs) await runJob(ctx, j, false);
	expect((await getBookmark(db, gh.id))!).toMatchObject({ tags: [{ name: 'code', attachedBy: 'human' }], listIds: [list.id] });
	expect((await getBookmark(db, other.id))!).toMatchObject({ tags: [], listIds: [] });
});

test('rule events: favourited / archived fire on the change only; tagAdded on new tags only; nothing listens → no jobs', async () => {
	const { db, ctx, drain } = harness();
	const b = (await addBookmark(ctx, NewBookmark.parse({ type: 'text', text: 'note' }))).bookmark;
	expect(await drain()).toEqual([]); // no rules, no webhooks
	const fav = await createTag(db, 'starred');
	await createRule(db, NewRule.parse({ name: 'fav', event: { type: 'favourited' }, condition: { type: 'alwaysTrue' }, actions: [{ type: 'addTag', tagId: fav.id }] }));
	await createRule(db, NewRule.parse({ name: 'tagged', event: { type: 'tagAdded', tagId: fav.id }, condition: { type: 'alwaysTrue' }, actions: [{ type: 'archiveBookmark' }] }));
	await editBookmark(ctx, { bookmarkId: b.id, favourited: true });
	await editBookmark(ctx, { bookmarkId: b.id, favourited: true }); // already favourite: no event
	const jobs = await drain();
	expect(jobs).toEqual([{ kind: 'rules', bookmarkId: b.id, events: [{ type: 'favourited' }] }]);
	await runJob(ctx, jobs[0], false);
	// The rule's own tag doesn't fire the "tagAdded" rule (no loops)...
	expect((await getBookmark(db, b.id))!.archived).toBe(false);
	expect(await drain()).toEqual([]);
	// ...but a user adding it does.
	await changeTags(ctx, b.id, [], [{ tagId: fav.id, attachedBy: 'human' }]);
	await changeTags(ctx, b.id, [{ tagId: fav.id, attachedBy: 'human' }], []);
	const tagJobs = (await drain()).filter((j) => j.kind === 'rules');
	expect(tagJobs).toEqual([{ kind: 'rules', bookmarkId: b.id, events: [{ type: 'tagAdded', tagId: fav.id }] }]);
	await runJob(ctx, tagJobs[0], false);
	expect((await getBookmark(db, b.id))!.archived).toBe(true);
});

test('conditions', () => {
	const b = { title: null, favourited: true, archived: false, source: 'rss', feedId: 'f1', tags: [{ id: 't1', name: 'x', attachedBy: 'ai' }], content: { type: 'link', url: 'https://GitHub.com/a', title: 'Hello World' } } as never;
	const yes: RuleCondition[] = [
		{ type: 'titleContains', str: 'world' },
		{ type: 'titleDoesNotContain', str: 'bye' },
		{ type: 'importedFromFeed', feedId: 'f1' },
		{ type: 'bookmarkSourceIs', source: 'rss' },
		{ type: 'hasTag', tagId: 't1' },
		{ type: 'and', conditions: [{ type: 'isFavourited' }, { type: 'or', conditions: [{ type: 'isArchived' }, { type: 'bookmarkTypeIs', bookmarkType: 'link' }] }] },
	];
	for (const c of yes) expect({ c, holds: conditionHolds(c, b) }).toEqual({ c, holds: true });
	expect(conditionHolds({ type: 'urlDoesNotContain', str: 'github' }, b)).toBe(false);
	expect(conditionHolds({ type: 'and', conditions: [{ type: 'isArchived' }, { type: 'alwaysTrue' }] }, b)).toBe(false);
});

test('webhooks: delivered with the token and Karakeep payload; deleted carries the snapshot; failures retry', async () => {
	const { db, ctx, drain } = harness();
	const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
	let status = 200;
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
		return new Response('', { status });
	}) as unknown as typeof fetch;
	await createWebhook(db, { url: 'https://hooks.example/a', events: ['created', 'deleted'], token: 's3cret' });
	await createWebhook(db, { url: 'https://hooks.example/b', events: ['edited'] });
	const b = (await addBookmark(ctx, NewBookmark.parse({ type: 'text', text: 'hi' }))).bookmark;
	await removeBookmark(ctx, b.id);
	for (const j of await drain()) await runJob(ctx, j, false);
	// "created" was queued, but the bookmark was gone by delivery time: skipped. "deleted" carries its snapshot.
	// The "edited" hook never fires: nothing was edited.
	expect(calls.map((c) => [c.url, c.auth, c.body.operation, c.body.type, c.body.userId])).toEqual([['https://hooks.example/a', 'Bearer s3cret', 'deleted', 'text', 'owner']]);
	status = 500;
	const b2 = (await addBookmark(ctx, NewBookmark.parse({ type: 'text', text: 'again' }))).bookmark;
	const [created] = await drain();
	await expect(runJob(ctx, created, false)).rejects.toThrow();
	await runJob(ctx, created, true); // last attempt: gives up quietly
	expect(b2.id).toBeTruthy();
});

test('feeds: fetch → new items saved (deduped, in order), tags imported, conditional GET, failures recorded', async () => {
	const { db, ctx, drain } = harness();
	const rss = `<rss><channel>
		<item><title>New</title><link>https://ex.com/new</link><category>Go</category></item>
		<item><title>Old</title><link>https://ex.com/old</link></item>
	</channel></rss>`;
	const seen: (string | null)[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		if (url !== 'https://ex.com/feed') return new Response('', { status: 404 }); // link previews
		seen.push(new Headers(init.headers).get('if-none-match'));
		return seen.length === 1 ? new Response(rss, { headers: { etag: '"v1"', 'content-type': 'application/rss+xml' } }) : new Response(null, { status: 304 });
	}) as unknown as typeof fetch;
	const feed = await createFeed(db, { name: 'Ex', url: 'https://ex.com/feed', enabled: true, importTags: true });
	await addBookmark(ctx, NewBookmark.parse({ type: 'link', url: 'https://ex.com/old' })); // already saved
	await drain();
	await runJob(ctx, { kind: 'feed', feedId: feed.id }, false);
	const jobs = await drain();
	const tagJob = jobs.find((j) => j.kind === 'feedTags')!;
	await runJob(ctx, tagJob, false);
	const saved = await db.prepare(`SELECT id, url, link_title, source, feed_id FROM bookmarks WHERE feed_id = ?`).bind(feed.id).all<Record<string, string>>();
	expect(saved.results.map((r) => [r.url, r.link_title, r.source])).toEqual([['https://ex.com/new', 'New', 'rss']]);
	expect((await getBookmark(db, saved.results[0].id))!.tags.map((t) => t.name)).toEqual(['Go']);
	expect((await allFeeds(db))[0]).toMatchObject({ lastFetchedStatus: 'success' });

	await runJob(ctx, { kind: 'feed', feedId: feed.id }, false);
	expect(seen).toEqual([null, '"v1"']); // second fetch is conditional

	globalThis.fetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
	await runJob(ctx, { kind: 'feed', feedId: feed.id }, false);
	expect((await allFeeds(db))[0].lastFetchedStatus).toBe('failure');
});
