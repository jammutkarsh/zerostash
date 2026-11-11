// The login secret is set with `wrangler secret put` (or the Deploy button), never in config.
// Declared here rather than via wrangler's `secrets.required`, which blocks the very first
// deploy of a new Worker; without it the app deploys and shows its setup page instead.
interface Env {
	ZEROSTASH_SECRET: string;
}
declare namespace Cloudflare {
	interface Env {
		ZEROSTASH_SECRET: string;
	}
}
