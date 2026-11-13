import { expect, test } from 'bun:test';
import { NewBookmark, NewList } from '../../shared/schemas';
import { testDb } from '../test/d1';
import { changesSince, createBookmark, deleteBookmark, getBookmark, listBookmarks, updateBookmark } from './bookmarks';
import { addToList, createList, deleteList, getList, listSizes, removeFromList } from './lists';
import { deleteTag, getTag, listTags, mergeTags, renameTag, updateTags } from './tags';
import { DomainError } from './util';

const T0 = Date.UTC(2026, 10, 13);
const add = (db: D1Database, input: Parameters<typeof NewBookmark.parse>[0], now = T0) => createBookmark(db, NewBookmark.parse(input), now);
const link = (n: number) => ({ type: 'link' as const, url: `https://example.com/${n}`, createdAt: new Date(T0 + n) });
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof DomainError ? e.code : String(e)));

test('create: links dedupe by URL, text and asset rules', async () => {
	const db = testDb();
	const a = await add(db, { ...link(1), title: 'Tab title', favourited: true, source: 'extension' });
	expect(a.alreadyExists).toBe(false);
	expect(a.bookmark).toMatchObject({ title: 'Tab title', favourited: true, source: 'extension', content: { type: 'link', crawlStatus: 'pending' } });
	expect(a.bookmark.createdAt).toBeInstanceOf(Date);
	const again = await add(db, link(1));
	expect(again).toMatchObject({ alreadyExists: true, bookmark: { id: a.bookmark.id } });
	expect((await add(db, { type: 'text', text: 'hello' })).bookmark.content).toEqual({ type: 'text', text: 'hello', sourceUrl: null });
	expect(await code(add(db, { type: 'asset', assetId: 'missing', assetType: 'image' }))).toBe('NOT_FOUND');
	expect(() => NewBookmark.parse({ type: 'link', url: 'ftp://x' })).toThrow();
	expect(() => NewBookmark.parse({ type: 'text' })).toThrow();
});

test('update: fields, URL conflict, missing bookmark', async () => {
	const db = testDb();
	const a = (await add(db, link(1))).bookmark;
	await add(db, link(2));
	const b = await updateBookmark(db, { bookmarkId: a.id, title: 'Mine', note: 'n', archived: true }, T0 + 10);
	expect(b).toMatchObject({ title: 'Mine', note: 'n', archived: true });
	expect(b.modifiedAt.getTime()).toBe(T0 + 10);
	expect((await updateBookmark(db, { bookmarkId: a.id, title: null, note: '' })).title).toBeNull();
	expect(await code(updateBookmark(db, { bookmarkId: a.id, url: 'https://example.com/2' }))).toBe('CONFLICT');
	expect(await code(updateBookmark(db, { bookmarkId: 'nope', title: 'x' }))).toBe('NOT_FOUND');
});

test('paging: cursor, both orders, filters', async () => {
	const db = testDb();
	for (let n = 1; n <= 5; n++) await add(db, { ...link(n), archived: n === 3 });
	const p1 = await listBookmarks(db, { archived: false }, { limit: 2 });
	const p2 = await listBookmarks(db, { archived: false }, { limit: 2, cursor: p1.nextCursor });
	const urls = (p: typeof p1) => p.bookmarks.map((b) => (b.content as { url: string }).url.slice(-1));
	expect([urls(p1), urls(p2), p2.nextCursor]).toEqual([['5', '4'], ['2', '1'], null]);
	expect(urls(await listBookmarks(db, {}, { limit: 10, order: 'asc' }))).toEqual(['1', '2', '3', '4', '5']);
	expect(urls(await listBookmarks(db, { archived: true }, {}))).toEqual(['3']);
});

test('tags: attach by name, counts per kind, idempotent, detach, rename, merge, delete', async () => {
	const db = testDb();
	const a = (await add(db, link(1))).bookmark.id;
	const b = (await add(db, link(2))).bookmark.id;
	await updateTags(db, a, [{ tagName: 'Go' }, { tagName: 'ai-tag', attachedBy: 'ai' }], []);
	await updateTags(db, a, [{ tagName: 'go' }], []); // same tag (ASCII case-insensitive), already attached
	await updateTags(db, b, [{ tagName: 'GO' }], []);
	const go = (await listTags(db, { nameContains: 'go' }))[0];
	expect(go).toMatchObject({ name: 'Go', numBookmarks: 2, numBookmarksByAttachedType: { human: 2, ai: 0 } });
	expect((await getBookmark(db, a))!.tags.map((t) => [t.name, t.attachedBy])).toEqual([
		['ai-tag', 'ai'],
		['Go', 'human'],
	]);
	await updateTags(db, a, [], [{ tagId: go.id }, { tagName: 'ai-tag' }]);
	await updateTags(db, a, [], [{ tagId: go.id }]); // already detached
	expect((await getTag(db, go.id)).numBookmarks).toBe(1);
	expect((await listTags(db, { attachedBy: 'none' })).map((t) => t.name)).toEqual(['ai-tag']);

	const other = (await listTags(db, {})).find((t) => t.name === 'ai-tag')!;
	expect(await code(renameTag(db, other.id, 'GO'))).toBe('CONFLICT');
	await updateTags(db, a, [{ tagId: other.id }], []);
	await mergeTags(db, go.id, [other.id]);
	expect((await getTag(db, go.id)).numBookmarks).toBe(2); // a (from ai-tag) + b
	expect(await code(getTag(db, other.id))).toBe('NOT_FOUND');

	// Deleting a bookmark keeps counts right.
	await deleteBookmark(db, b);
	expect((await getTag(db, go.id)).numBookmarks).toBe(1);
	await deleteTag(db, go.id);
	expect((await getBookmark(db, a))!.tags).toEqual([]);
	expect(await code(updateTags(db, 'nope', [{ tagName: 'x' }], []))).toBe('NOT_FOUND');
});

test('lists: counts, smart lists (members + query), nesting, delete', async () => {
	const db = testDb();
	const a = (await add(db, { ...link(1), title: 'postgres tips' })).bookmark.id;
	const b = (await add(db, link(2))).bookmark.id;
	const manual = await createList(db, NewList.parse({ name: 'Manual', icon: '📁' }));
	const smart = await createList(db, NewList.parse({ name: 'Smart', icon: '🔎', type: 'smart', query: 'postgres or mysql' }));
	await addToList(db, manual.id, a);
	await addToList(db, manual.id, a); // idempotent
	await addToList(db, smart.id, b); // hand-added to a smart list
	expect(Object.fromEntries(await listSizes(db))).toEqual({ [manual.id]: 1, [smart.id]: 2 });
	const smartItems = await listBookmarks(db, { list: { id: smart.id, type: 'smart', query: { k: 'text', v: 'postgres' } } }, {});
	expect(smartItems.bookmarks.map((x) => x.id)).toEqual([b, a]);
	await removeFromList(db, manual.id, a);
	await removeFromList(db, manual.id, a);
	expect((await listSizes(db)).get(manual.id)).toBe(0);
	expect(await code(createList(db, NewList.parse({ name: 'x', icon: '📁', parentId: 'nope' })))).toBe('BAD_REQUEST');
	const child = await createList(db, NewList.parse({ name: 'Child', icon: '📁', parentId: manual.id }));
	await deleteList(db, manual.id);
	expect((await getList(db, child.id)).parentId).toBeNull();
	expect(() => NewList.parse({ name: 'x', icon: '🔎', type: 'smart' })).toThrow();
});

test('delta sync: every visible change bumps updated_at; deletes leave tombstones', async () => {
	const db = testDb();
	const a = (await add(db, link(1), T0)).bookmark.id;
	const list = await createList(db, NewList.parse({ name: 'L', icon: '📁' }));
	const since = T0 + 100;
	const changedIds = async (now: number) => (await changesSince(db, since, now)).bookmarks.map((b) => b.id);
	expect(await changedIds(T0 + 1000)).toEqual([]);
	await addToList(db, list.id, a, T0 + 200);
	expect(await changedIds(T0 + 1000)).toEqual([a]);
	const t2 = T0 + 300;
	await updateTags(db, a, [{ tagName: 'x' }], [], t2);
	expect((await changesSince(db, t2 - 1, T0 + 1000)).bookmarks[0].tags.map((t) => t.name)).toEqual(['x']);
	await deleteList(db, list.id, false, T0 + 400);
	expect((await changesSince(db, T0 + 399, T0 + 1000)).bookmarks[0].listIds).toEqual([]);
	await deleteBookmark(db, a, T0 + 500);
	expect(await changesSince(db, T0 + 499, T0 + 1000)).toMatchObject({ bookmarks: [], deleted: [a], reset: false });
	expect((await changesSince(db, undefined, T0)).reset).toBe(true);
});

test('assets: upload rules, asset bookmarks, attach/replace/detach, delete, orphan sweep', async () => {
	const { attachAsset, detachAsset, replaceAsset, sweepOrphanAssets, uploadAsset, ORPHAN_AFTER_MS } = await import('./assets');
	const db = testDb();
	const stored = new Map<string, Blob>();
	const bucket = {
		put: async (k: string, v: Blob) => void stored.set(k, v),
		delete: async (k: string | string[]) => void [k].flat().forEach((x) => stored.delete(x)),
	} as unknown as R2Bucket;
	const file = (name: string, type: string, bytes = 3) => new File([new Uint8Array(bytes)], name, { type });
	const up = (f: File, now = T0) => uploadAsset(db, bucket, f, now);

	expect(await code(up(file('x.svg', 'image/svg+xml')))).toBe('BAD_REQUEST');
	expect(await code(up(file('x.html', 'text/html')))).toBe('BAD_REQUEST');
	expect(await code(up(file('empty.png', 'image/png', 0)))).toBe('BAD_REQUEST');
	const img = await up(file('cat.png', 'image/png'));
	expect(img).toMatchObject({ contentType: 'image/png', size: 3, fileName: 'cat.png' });
	expect(stored.has(`assets/${img.assetId}`)).toBe(true);

	const ab = (await add(db, { type: 'asset', assetId: img.assetId, assetType: 'image', fileName: 'cat.png' })).bookmark;
	expect(ab.content).toMatchObject({ type: 'asset', assetType: 'image', assetId: img.assetId, fileName: 'cat.png' });
	expect(ab.assets.map((a) => a.id)).toEqual([img.assetId]);
	expect(await code(add(db, { type: 'asset', assetId: img.assetId, assetType: 'image' }))).toBe('CONFLICT');

	const l = (await add(db, link(1))).bookmark.id;
	const pdf = await up(file('doc.pdf', 'application/pdf'));
	await attachAsset(db, l, pdf.assetId, 'userUploaded');
	expect(await code(attachAsset(db, l, pdf.assetId, 'userUploaded'))).toBe('BAD_REQUEST'); // already claimed
	const pdf2 = await up(file('doc2.pdf', 'application/pdf'));
	expect(await replaceAsset(db, l, pdf.assetId, pdf2.assetId)).toBe(pdf.assetId);
	expect((await getBookmark(db, l))!.assets.map((a) => a.fileName)).toEqual(['doc2.pdf']);
	expect(await code(detachAsset(db, ab.id, img.assetId))).toBe('BAD_REQUEST'); // an asset bookmark's own file
	expect(await detachAsset(db, l, pdf2.assetId)).toBe(pdf2.assetId);
	expect((await getBookmark(db, l))!.assets).toEqual([]);

	// Replacing an asset bookmark's own file updates its content.
	const img2 = await up(file('dog.png', 'image/png'));
	await replaceAsset(db, ab.id, img.assetId, img2.assetId);
	expect((await getBookmark(db, ab.id))!.content).toMatchObject({ assetId: img2.assetId, fileName: 'dog.png' });
	expect(await deleteBookmark(db, ab.id)).toEqual([img2.assetId]);

	const orphan = await up(file('lost.png', 'image/png'), T0);
	expect(await sweepOrphanAssets(db, T0 + ORPHAN_AFTER_MS - 1)).toEqual([]);
	expect(await sweepOrphanAssets(db, T0 + ORPHAN_AFTER_MS + 1)).toContain(orphan.assetId);
});
