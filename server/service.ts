// Use cases shared by both API adapters (tRPC and REST): domain writes plus their side effects
// (link previews, files, AI, and events that drive rules and webhooks).
import type { NewBookmarkInput, TagRef, UpdateBookmark } from '../shared/schemas';
import { attachAsset, detachAsset, r2Key, replaceAsset, sweepOrphanAssets, uploadAsset } from './domain/assets';
import { createBookmark, deleteBookmark, getBookmark, mustGetBookmark, updateBookmark } from './domain/bookmarks';
import { addToList, removeFromList } from './domain/lists';
import { updateTags } from './domain/tags';
import { DomainError, notFound } from './domain/util';
import { emit } from './events';
import { queueAi } from './jobs';
import { crawl } from './og';

export interface Ctx {
	env: Env;
	waitUntil: (p: Promise<unknown>) => void;
}

export async function addBookmark(ctx: Ctx, input: NewBookmarkInput) {
	const res = await createBookmark(ctx.env.DB, input);
	if (res.alreadyExists) return res;
	const { bookmark } = res;
	if (bookmark.content.type === 'link') ctx.waitUntil(crawl(ctx, bookmark.id, bookmark.content.url));
	const ai = await queueAi(ctx, [bookmark.id]);
	// Clients poll while a status is pending, so the reply must already say so.
	if (ai) res.bookmark = { ...bookmark, taggingStatus: ai.tag ? 'pending' : null, summarizationStatus: ai.summarize ? 'pending' : null };
	ctx.waitUntil(emit(ctx, [{ bookmarkId: bookmark.id, rules: [{ type: 'bookmarkAdded' }], webhook: 'created' }]));
	return res;
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
