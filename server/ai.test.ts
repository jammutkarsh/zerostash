import { expect, test } from 'bun:test';
import { NewBookmark } from '../shared/schemas';
import { aiModel, aiProvider, buildPrompt, parseResult, styleTag } from './ai';
import { createBookmark, getBookmark } from './domain/bookmarks';
import { updateSettings } from './domain/settings';
import { listTags } from './domain/tags';
import { queueAi, runJob, type Job } from './jobs';
import { testDb } from './test/d1';

test('provider order and default models: Claude, OpenAI, Gemini, custom (needs URL + model), Workers AI, off', () => {
	const ai = {} as Ai;
	const pick = (env: Partial<Env>) => {
		const p = aiProvider({ AI: ai, ...env } as Env);
		return p && `${p}:${aiModel({ AI: ai, ...env } as Env, p)}`;
	};
	expect(pick({ ZEROSTASH_AI: 'off', ANTHROPIC_API_KEY: 'k' })).toBeNull();
	expect(pick({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' })).toBe('anthropic:claude-sonnet-5-5');
	expect(pick({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' })).toBe('openai:gpt-6.1-terra');
	expect(pick({ GEMINI_API_KEY: 'g' })).toBe('gemini:gemini-3.8-flash');
	expect(pick({ GEMINI_API_KEY: 'g', AI_MODEL: 'gemini-3.8-pro' })).toBe('gemini:gemini-3.8-pro');
	expect(pick({ AI_API_KEY: 'x', AI_MODEL: 'm' })).toBe('workers-ai:m'); // custom needs a base URL too
	expect(pick({ AI_API_KEY: 'x', AI_BASE_URL: 'https://api.deepseek.com', AI_MODEL: 'deepseek-chat' })).toBe('custom:deepseek-chat');
	expect(pick({})).toBe('workers-ai:@cf/google/gemma-4-26b-a4b-it');
});

test('parseResult takes the JSON out of chatty replies and validates it', () => {
	expect(parseResult('Sure! {"tags":["go"],"summary":"S."} Hope that helps')).toEqual({ tags: ['go'], summary: 'S.' });
	expect(() => parseResult('no json here')).toThrow();
	expect(() => parseResult('{"tags":"go","summary":"x"}')).toThrow();
});

test('styleTag', () => {
	expect(styleTag('Machine learning', 'lowercase-hyphens')).toBe('machine-learning');
	expect(styleTag('machine_learning', 'titlecase-spaces')).toBe('Machine Learning');
	expect(styleTag('Machine learning', 'camelCase')).toBe('machineLearning');
	expect(styleTag(' Machine learning ', 'as-generated')).toBe('Machine learning');
});

test('prompt carries what is known and the existing tags', async () => {
	const db = testDb();
	const { bookmark } = await createBookmark(db, NewBookmark.parse({ type: 'text', text: 'Notes on Postgres VACUUM', note: 'for work' }));
	const p = buildPrompt(bookmark, '', ['databases', 'go'], 'English');
	expect(p.user).toContain('Notes on Postgres VACUUM');
	expect(p.user).toContain('Note: for work');
	expect(p.user).toContain('Existing tags: databases, go');
});

function stubEnv(db: D1Database, reply: () => unknown) {
	const sent: unknown[] = [];
	const env = {
		DB: db,
		AI: { run: async () => reply(), toMarkdown: async () => ({ format: 'text', data: '' }) },
		JOBS: { send: async (b: unknown) => void sent.push(b), sendBatch: async (bs: { body: unknown }[]) => void sent.push(...bs.map((b) => b.body)) },
	} as unknown as Env;
	return { env, sent, ctx: { env, waitUntil: () => {} } };
}

test('save → queued → AI tags (attached by ai, styled) and summary; failures marked on the last attempt', async () => {
	const db = testDb();
	await updateSettings(db, { tagStyle: 'lowercase-hyphens' });
	const { ctx, sent } = stubEnv(db, () => ({ response: { tags: ['Query Planning', 'Postgres'], summary: 'How VACUUM works.' } }));
	const { bookmark } = await createBookmark(db, NewBookmark.parse({ type: 'text', text: 'Postgres VACUUM notes' }));
	await queueAi(ctx, [bookmark.id]);
	expect(sent).toEqual([{ kind: 'ai', bookmarkId: bookmark.id, tag: true, summarize: true }]);
	expect((await getBookmark(db, bookmark.id))!).toMatchObject({ taggingStatus: 'pending', summarizationStatus: 'pending' });

	await runJob(ctx, sent[0] as Job, false);
	const done = (await getBookmark(db, bookmark.id))!;
	expect(done).toMatchObject({ taggingStatus: 'success', summarizationStatus: 'success', summary: 'How VACUUM works.' });
	expect(done.tags.map((t) => [t.name, t.attachedBy])).toEqual([
		['postgres', 'ai'],
		['query-planning', 'ai'],
	]);
	expect((await listTags(db, { nameContains: 'postgres' }))[0].numBookmarksByAttachedType).toEqual({ ai: 1, human: 0 });

	// A failing provider: retried (throws) until the last attempt, then marked failed.
	const broken = stubEnv(db, () => ({ response: 'not json' }));
	const job: Job = { kind: 'ai', bookmarkId: bookmark.id, tag: true, summarize: false };
	await expect(runJob(broken.ctx, job, false)).rejects.toThrow();
	await runJob(broken.ctx, job, true);
	expect((await getBookmark(db, bookmark.id))!.taggingStatus).toBe('failure');
});

test('settings can turn auto-tagging off; ZEROSTASH_AI=off queues nothing', async () => {
	const db = testDb();
	const { bookmark } = await createBookmark(db, NewBookmark.parse({ type: 'text', text: 'x' }));
	const { env, ctx, sent } = stubEnv(db, () => ({}));
	await queueAi({ env: { ...env, ZEROSTASH_AI: 'off' }, waitUntil: () => {} }, [bookmark.id]);
	await updateSettings(db, { autoTaggingEnabled: false, autoSummarizationEnabled: false });
	await queueAi(ctx, [bookmark.id]);
	expect(sent).toEqual([]);
	expect((await getBookmark(db, bookmark.id))!.taggingStatus).toBeNull();
});
