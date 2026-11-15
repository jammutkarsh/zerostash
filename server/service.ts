// Use cases shared by both API adapters (tRPC and REST): domain writes plus their side effects
// (link previews, files, AI, and events that drive rules and webhooks).
import type { NewBookmarkInput, Preview, TagRef, UpdateBookmark } from '../shared/schemas';
import { aiProvider } from './ai';
import { attachAsset, detachAsset, r2Key, replaceAsset, sweepOrphanAssets, uploadAsset } from './domain/assets';
import { applyCrawl, createBookmark, deleteBookmark, getBookmark, markBrowserFailed, mustGetBookmark, staleAi, updateBookmark } from './domain/bookmarks';
import { addToList, removeFromList } from './domain/lists';
import { updateTags } from './domain/tags';
import { DomainError, marks, notFound } from './domain/util';
import { emit } from './events';
import type { Job } from './jobs';
import { crawl } from './og';

export interface Ctx {
	env: Env;
	waitUntil: (p: Promise<unknown>) => void;
}

/**
 * Save path, kept to one D1 round trip before the reply (see createBookmark): the page fetch,
 * the AI job and rule/webhook events all run after the response. A lost AI message is re-queued
 * by the cron (requeueStaleAi).
 */
export async function addBookmark(ctx: Ctx, input: NewBookmarkInput) {
	const res = await createBookmark(ctx.env.DB, input, { aiOn: !!aiProvider(ctx.env) });
	if (res.alreadyExists) return res;
	const { bookmark: b } = res;
	if (b.content.type === 'link' && b.content.crawlStatus === 'pending') ctx.waitUntil(crawl(ctx, b.id, b.content.url));
	const tag = b.taggingStatus === 'pending';
	const summarize = b.summarizationStatus === 'pending';
	if (tag || summarize) {
		ctx.waitUntil(
			ctx.env.JOBS.send({ kind: 'ai', bookmarkId: b.id, tag, summarize } satisfies Job).catch((err) =>
				console.log(JSON.stringify({ msg: 'ai queue send failed; cron will retry', id: b.id, error: String(err) })),
			),
		);
	}
	ctx.waitUntil(emit(ctx, [{ bookmarkId: b.id, rules: [{ type: 'bookmarkAdded' }], webhook: 'created' }]));
	return res;
}

/** A preview read by the Zerostash extension in the user's browser (or `null`: the browser couldn't read it either). */
export async function browserPreview(ctx: Ctx, bookmarkId: string, og: Preview | null) {
	if (!og || !(og.title || og.description || og.imageUrl)) return markBrowserFailed(ctx.env.DB, bookmarkId);
	await applyCrawl(ctx.env.DB, bookmarkId, { title: og.title, description: og.description, imageUrl: og.imageUrl, siteName: og.siteName, faviconUrl: og.faviconUrl, author: og.author });
	ctx.waitUntil(emit(ctx, [{ bookmarkId, webhook: 'crawled' }]));
}

/** Cron: AI jobs queued over 10 minutes ago that never finished (message lost) go back on the queue. */
export async function requeueStaleAi(ctx: Ctx, now = Date.now()) {
	const stale = await staleAi(ctx.env.DB, 10 * 60_000, 20, now);
	if (!stale.length) return;
	await ctx.env.JOBS.sendBatch(stale.map((s) => ({ body: { kind: 'ai', ...s } satisfies Job })));
	// Not again next run while these are queued.
	await ctx.env.DB.prepare(`UPDATE bookmarks SET updated_at = ? WHERE id IN (${marks(stale.length)})`).bind(now, ...stale.map((s) => s.bookmarkId)).run();
}

export async function editBookmark(ctx: Ctx, patch: UpdateBookmark) {
	const before = await mustGetBookmark(ctx.env.DB, patch.bookmarkId);
	const after = await updateBookmark(ctx.env.DB, patch);
	ctx.waitUntil(
		emit(ctx, [
			{
				bookmarkId: after.id,
				rules: [...(!before.favourited && after.favourited ? [{ type: 'favourited' as const }] : []), ...(!before.archived && after.archived ? [{ type: 'archived' as const }] : [])],
				webhook: 'edited',
			},
		]),
	);
	return after;
}

export async function changeTags(ctx: Ctx, bookmarkId: string, attach: TagRef[], detach: TagRef[]) {
	const before = new Set((await mustGetBookmark(ctx.env.DB, bookmarkId)).tags.map((t) => t.id));
	const res = await updateTags(ctx.env.DB, bookmarkId, attach, detach);
	const added = res.attached.filter((id) => !before.has(id));
	const removed = res.detached.filter((id) => before.has(id));
	if (added.length || removed.length) {
		ctx.waitUntil(
			emit(ctx, [
				{
					bookmarkId,
					rules: [...added.map((tagId) => ({ type: 'tagAdded' as const, tagId })), ...removed.map((tagId) => ({ type: 'tagRemoved' as const, tagId }))],
					webhook: 'edited',
				},
			]),
		);
	}
	return res;
}

export async function listAdd(ctx: Ctx, listId: string, bookmarkId: string) {
	await addToList(ctx.env.DB, listId, bookmarkId);
	ctx.waitUntil(emit(ctx, [{ bookmarkId, rules: [{ type: 'addedToList', listId }], webhook: 'edited' }]));
}

export async function listRemove(ctx: Ctx, listId: string, bookmarkId: string) {
	await removeFromList(ctx.env.DB, listId, bookmarkId);
	ctx.waitUntil(emit(ctx, [{ bookmarkId, rules: [{ type: 'removedFromList', listId }], webhook: 'edited' }]));
}

const dropFiles = (ctx: Ctx, ids: string[]) => ids.length && ctx.waitUntil(ctx.env.FILES.delete(ids.map(r2Key)));

export async function removeBookmark(ctx: Ctx, id: string): Promise<void> {
	const b = await getBookmark(ctx.env.DB, id);
	const assets = await deleteBookmark(ctx.env.DB, id);
	if (!b || !assets) throw notFound('Bookmark');
	dropFiles(ctx, assets);
	ctx.waitUntil(emit(ctx, [{ bookmarkId: id, webhook: 'deleted', url: b.content.type === 'link' ? b.content.url : undefined, type: b.content.type }]));
}

// ---- files ----

/** The `file` field of a multipart upload (what Karakeep's clients send). */
export async function storeUpload(ctx: Ctx, file: unknown) {
	if (!(file instanceof File)) throw new DomainError('BAD_REQUEST', 'Send the file as multipart/form-data in a field named "file".');
	return uploadAsset(ctx.env.DB, ctx.env.FILES, file);
}

export async function serveAsset(env: Env, id: string): Promise<Response> {
	const object = await env.FILES.get(r2Key(id));
	if (!object) throw notFound('Asset');
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	// Ids are never reused, so the bytes never change. Private: only the signed-in owner sees them.
	headers.set('cache-control', 'private, max-age=31536000, immutable');
	headers.set('x-content-type-options', 'nosniff');
	return new Response(object.body, { headers });
}

export const attachFile = (ctx: Ctx, bookmarkId: string, assetId: string, assetType: string) => attachAsset(ctx.env.DB, bookmarkId, assetId, assetType);

export async function detachFile(ctx: Ctx, bookmarkId: string, assetId: string) {
	dropFiles(ctx, [await detachAsset(ctx.env.DB, bookmarkId, assetId)]);
}

export async function replaceFile(ctx: Ctx, bookmarkId: string, oldId: string, newId: string) {
	dropFiles(ctx, [await replaceAsset(ctx.env.DB, bookmarkId, oldId, newId)]);
}

/** Cron: uploads nothing claimed within a day. */
export async function sweepUploads(env: Env) {
	const ids = await sweepOrphanAssets(env.DB);
	if (ids.length) await env.FILES.delete(ids.map(r2Key));
}
