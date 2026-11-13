// AI tags and summaries. Provider, first match wins (a key you set beats the free fallback):
//   1. Anthropic          ANTHROPIC_API_KEY   default claude-sonnet-5-5
//   2. OpenAI             OPENAI_API_KEY      default gpt-6.1-terra
//   3. Gemini             GEMINI_API_KEY      default gemini-3.8-flash (Google's OpenAI-compatible API)
//   4. Any other OpenAI-compatible API: AI_API_KEY + AI_BASE_URL + AI_MODEL (no default model)
//   5. Workers AI (the AI binding; free daily quota)
// AI_MODEL overrides the default model of whichever provider is in use. ZEROSTASH_AI=off turns
// it all off. Defaults are each vendor's cheap-but-smart tier. Page text comes from Workers
// AI's toMarkdown (free for HTML/PDF). The prompt is our own.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { isPrivateHost } from '../shared/og';
import type { Bookmark } from '../shared/schemas';
import { r2Key } from './domain/assets';

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'custom' | 'workers-ai';

export function aiProvider(env: Env): Provider | null {
	if (env.ZEROSTASH_AI === 'off') return null;
	if (env.ANTHROPIC_API_KEY) return 'anthropic';
	if (env.OPENAI_API_KEY) return 'openai';
	if (env.GEMINI_API_KEY) return 'gemini';
	if (env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL) return 'custom';
	return env.AI ? 'workers-ai' : null;
}

// Cloudflare's recommended small model (Nov 2026). Its catalog churns (the Llama 3.x 8B models
// went in 2026), so a job failing with error 5028 means: pick a current model here.
const DEFAULT_MODEL: Record<Provider, string> = {
	anthropic: 'claude-sonnet-5-5',
	openai: 'gpt-6.1-terra',
	gemini: 'gemini-3.8-flash',
	custom: '',
	'workers-ai': '@cf/google/gemma-4-26b-a4b-it',
};

/** The model a provider runs: AI_MODEL if set, else the provider's default. */
export const aiModel = (env: Env, p: Provider) => env.AI_MODEL || DEFAULT_MODEL[p];

const OPENAI_COMPATIBLE: Partial<Record<Provider, (env: Env) => { base: string; key: string }>> = {
	openai: (env) => ({ base: 'https://api.openai.com/v1', key: env.OPENAI_API_KEY! }),
	gemini: (env) => ({ base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: env.GEMINI_API_KEY! }),
	custom: (env) => ({ base: env.AI_BASE_URL!.replace(/\/$/, ''), key: env.AI_API_KEY! }),
};

// Models that take server-side refusal fallbacks (fallbacks: "default").
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MAX_CONTENT_CHARS = 6000;
const MAX_PAGE_BYTES = 512 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; Zerostash/1.0; +https://github.com/jammutkarsh/zerostash)';

export const AiResult = z.object({
	tags: z.array(z.string().trim().min(1).max(64)).max(10),
	summary: z.string().trim().max(2000),
});
export type AiResult = z.infer<typeof AiResult>;

const RESULT_SCHEMA = {
	type: 'object',
	properties: {
		tags: { type: 'array', items: { type: 'string' } },
		summary: { type: 'string' },
	},
	required: ['tags', 'summary'],
	additionalProperties: false,
} as const;

// ---- input ----

export async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
	const reader = res.body!.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < max) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
	}
	await reader.cancel().catch(() => {});
	const out = new Uint8Array(new ArrayBuffer(Math.min(size, max)));
	let at = 0;
	for (const c of chunks) {
		const part = c.subarray(0, out.length - at);
		out.set(part, at);
		at += part.length;
		if (at >= out.length) break;
	}
	return out;
}

/** Readable text of a link (fetched), a PDF or an image (from R2); '' when there's none. */
async function contentText(env: Env, b: Bookmark): Promise<string> {
	try {
		let file: { name: string; blob: Blob } | null = null;
		if (b.content.type === 'link' && !isPrivateHost(b.content.url)) {
			const res = await fetch(b.content.url, {
				redirect: 'follow',
				signal: AbortSignal.timeout(10_000),
				headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf' },
			});
			const type = res.headers.get('content-type') ?? '';
			if (res.ok && res.body && /html|pdf/.test(type)) {
				file = { name: type.includes('pdf') ? 'page.pdf' : 'page.html', blob: new Blob([await readCapped(res, MAX_PAGE_BYTES)], { type }) };
			} else await res.body?.cancel();
		} else if (b.content.type === 'asset') {
			const object = await env.FILES.get(r2Key(b.content.assetId));
			if (object) file = { name: b.content.fileName ?? (b.content.assetType === 'pdf' ? 'file.pdf' : 'image.png'), blob: await object.blob() };
		}
		if (!file) return '';
		const doc = await env.AI.toMarkdown(file, { conversionOptions: { output: { format: 'text' } } });
		return doc.format === 'error' ? '' : doc.data.slice(0, MAX_CONTENT_CHARS);
	} catch (err) {
		console.log(JSON.stringify({ msg: 'ai content failed', id: b.id, error: String(err) }));
		return '';
	}
}

export function buildPrompt(b: Bookmark, text: string, existingTags: string[], lang: string): { system: string; user: string } {
	const c = b.content;
	const fields = [
		['Title', b.title || (c.type === 'link' ? c.title : c.type === 'asset' ? c.fileName : null)],
		['URL', c.type === 'link' ? c.url : null],
		['Description', c.type === 'link' ? c.description : null],
		['Note', b.note],
		['Text', c.type === 'text' ? c.text.slice(0, MAX_CONTENT_CHARS) : null],
		['Page content', text || null],
	]
		.filter(([, v]) => v)
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n\n');
	return {
		system: 'You file bookmarks in a personal reading library. Answer with a JSON object only.',
		user: [
			`Suggest tags and write a summary for this saved item, in ${lang}.`,
			'- "tags": 3 to 5 short topics (1 to 3 words each) someone would browse by, most specific first. Prefer existing tags when they fit.',
			'- "summary": 2 to 3 plain sentences saying what it is and what a reader gets from it. No preamble.',
			existingTags.length ? `Existing tags: ${existingTags.join(', ')}` : '',
			'',
			fields,
		]
			.filter((l) => l !== '')
			.join('\n'),
	};
}

/** First {...} in a model reply, validated. */
export function parseResult(raw: string): AiResult {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end < start) throw new Error(`no JSON in reply: ${raw.slice(0, 120)}`);
	return AiResult.parse(JSON.parse(raw.slice(start, end + 1)));
}

// ---- providers ----

async function viaAnthropic(env: Env, p: { system: string; user: string }): Promise<string> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	const model = aiModel(env, 'anthropic');
	const res = await client.beta.messages.create({
		model,
		max_tokens: 4000,
		system: p.system,
		messages: [{ role: 'user', content: p.user }],
		// Tagging is a simple task: low effort keeps it fast and cheap.
		output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
		// On a safety decline, the API re-runs the request on a fallback model it picks.
		...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
	});
	if (res.stop_reason === 'refusal') throw new Error(`refused: ${res.stop_details?.category ?? 'unknown'}`);
	return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

async function viaOpenAiCompatible(env: Env, provider: Provider, p: { system: string; user: string }): Promise<string> {
	const { base, key } = OPENAI_COMPATIBLE[provider]!(env);
	const res = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			model: aiModel(env, provider),
			messages: [
				{ role: 'system', content: p.system },
				{ role: 'user', content: p.user },
			],
			response_format: { type: 'json_object' },
		}),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	return body.choices?.[0]?.message?.content ?? '';
}

async function viaWorkersAi(env: Env, p: { system: string; user: string }): Promise<string> {
	const out = (await env.AI.run(aiModel(env, 'workers-ai') as '@cf/google/gemma-4-26b-a4b-it', {
		messages: [
			{ role: 'system', content: p.system },
			{ role: 'user', content: p.user },
		],
		response_format: { type: 'json_schema', json_schema: { name: 'bookmark_tags', schema: RESULT_SCHEMA } },
		max_tokens: 1200,
	})) as { response?: unknown; choices?: { message?: { content?: string } }[] };
	// Older models answer { response }, newer ones the OpenAI shape { choices }.
	const reply = out.response ?? out.choices?.[0]?.message?.content ?? '';
	return typeof reply === 'string' ? reply : JSON.stringify(reply);
}

/** Tags and a summary for one bookmark. Throws when the provider fails or answers badly. */
export async function suggest(env: Env, b: Bookmark, existingTags: string[], lang: string): Promise<AiResult> {
	const provider = aiProvider(env);
	if (!provider) throw new Error('AI is off');
	const prompt = buildPrompt(b, await contentText(env, b), existingTags, lang);
	const raw =
		provider === 'anthropic' ? await viaAnthropic(env, prompt)
		: provider === 'workers-ai' ? await viaWorkersAi(env, prompt)
		: await viaOpenAiCompatible(env, provider, prompt);
	return parseResult(raw);
}

// ---- tag style (Karakeep's user setting) ----

export type TagStyle = 'lowercase-hyphens' | 'lowercase-spaces' | 'lowercase-underscores' | 'titlecase-spaces' | 'titlecase-hyphens' | 'camelCase' | 'as-generated';

export function styleTag(tag: string, style: TagStyle): string {
	const words = tag.trim().split(/[\s_-]+/).filter(Boolean);
	const title = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();
	switch (style) {
		case 'lowercase-hyphens':
			return words.join('-').toLowerCase();
		case 'lowercase-spaces':
			return words.join(' ').toLowerCase();
		case 'lowercase-underscores':
			return words.join('_').toLowerCase();
		case 'titlecase-spaces':
			return words.map(title).join(' ');
		case 'titlecase-hyphens':
			return words.map(title).join('-');
		case 'camelCase':
			return words.map((w, i) => (i ? title(w) : w.toLowerCase())).join('');
		default:
			return tag.trim();
	}
}
