// Secrets are set in the dashboard (or with `wrangler secret put`), never in config.
// Declared here rather than via wrangler's `secrets.required`, which blocks the very first
// deploy of a new Worker; without ZEROSTASH_SECRET the app deploys and shows its setup page.
interface ZerostashSecrets {
	ZEROSTASH_SECRET: string;
	/** "off" disables AI tagging and summaries. */
	ZEROSTASH_AI?: string;
	/** AI provider, first match wins (see server/ai.ts): Anthropic, OpenAI, Gemini, other OpenAI-compatible, Workers AI. */
	ANTHROPIC_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GEMINI_API_KEY?: string;
	AI_API_KEY?: string;
	AI_BASE_URL?: string;
	/** Overrides the provider's default model; required with AI_API_KEY. */
	AI_MODEL?: string;
}
interface Env extends ZerostashSecrets {}
declare namespace Cloudflare {
	interface Env extends ZerostashSecrets {}
}
