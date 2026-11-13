import { app } from './app';
import { purgeTombstones } from './domain/bookmarks';
import { claimDueFeeds } from './domain/feeds';
import { type Job, MAX_RETRIES, runJob } from './jobs';
import { crawlBacklog } from './og';
import { sweepUploads } from './service';

// ponytail: 5 feeds per 5-minute run = 60 fetches/hour; raise if someone subscribes to more
// feeds than that can cover hourly.
const FEEDS_PER_RUN = 5;

export default {
	fetch: app.fetch,
	// One `*/5` schedule for all background work (Free plan allows 5 cron triggers per account).
	async scheduled(_controller, env, ctx) {
		const c = { env, waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
		const queueFeeds = async () => {
			const ids = await claimDueFeeds(env.DB, FEEDS_PER_RUN);
			if (ids.length) await env.JOBS.sendBatch(ids.map((feedId) => ({ body: { kind: 'feed', feedId } satisfies Job })));
		};
		ctx.waitUntil(Promise.all([crawlBacklog(c), purgeTombstones(env.DB), sweepUploads(env), queueFeeds()]));
	},
	async queue(batch, env, ctx) {
		const c = { env, waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
		for (const msg of batch.messages) {
			try {
				await runJob(c, msg.body as Job, msg.attempts > MAX_RETRIES);
				msg.ack();
			} catch {
				msg.retry();
			}
		}
	},
} satisfies ExportedHandler<Env>;
