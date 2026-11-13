// Bookmark events → queue jobs: one "rules" job per bookmark when an enabled rule listens for
// one of its events, one "webhook" job per subscribed webhook. Checking first costs one small
// read per write but spends no queue operations (Free plan: 10k/day) when nothing listens.
import type { RuleEvent, WebhookEvent } from '../shared/schemas';
import { eventMatches } from './domain/rules';
import type { Job } from './jobs';
import type { Ctx } from './service';

export interface BookmarkEvent {
	bookmarkId: string;
	rules?: RuleEvent[];
	webhook?: WebhookEvent;
	/** For "deleted", whose bookmark is gone by the time the webhook job runs. */
	url?: string;
	type?: string;
}

export async function emit(ctx: Ctx, events: BookmarkEvent[]): Promise<void> {
	if (!events.length) return;
	try {
		const [rules, hooks] = await ctx.env.DB.batch<{ event?: string; id?: string; events?: string }>([
			ctx.env.DB.prepare('SELECT event FROM rules WHERE enabled = 1'),
			ctx.env.DB.prepare('SELECT id, events FROM webhooks'),
		]);
		const listening = rules.results.map((r) => JSON.parse(r.event!) as RuleEvent);
		const jobs: Job[] = [];
		for (const e of events) {
			const hits = (e.rules ?? []).filter((x) => listening.some((w) => eventMatches(w, x)));
			if (hits.length) jobs.push({ kind: 'rules', bookmarkId: e.bookmarkId, events: hits });
			if (!e.webhook) continue;
			for (const h of hooks.results) {
				if ((JSON.parse(h.events!) as string[]).includes(e.webhook)) {
					jobs.push({ kind: 'webhook', webhookId: h.id!, operation: e.webhook, bookmarkId: e.bookmarkId, url: e.url, type: e.type });
				}
			}
		}
		for (let i = 0; i < jobs.length; i += 100) await ctx.env.JOBS.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
	} catch (err) {
		// Never fail the write that caused the event.
		console.log(JSON.stringify({ msg: 'emit failed', error: String(err) }));
	}
}
