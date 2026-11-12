import { app } from './app';
import { purgeTombstones } from './bookmarks';
import { serverOgFallback } from './og';

export default {
	fetch: app.fetch,
	// One `*/5` schedule for all background work (Free plan allows 5 cron triggers per account).
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(Promise.all([serverOgFallback(env.DB), purgeTombstones(env.DB)]));
	},
	// AI summarise/tag jobs land here in Phase 3; until then nothing is enqueued.
	async queue(batch) {
		batch.ackAll();
	},
} satisfies ExportedHandler<Env>;
