// Uploaded files (images, PDFs): bytes in R2 under assets/<id>, a row in `assets`. An upload
// stands alone until a bookmark claims it (an asset bookmark, or attached to a bookmark);
// unclaimed uploads are swept by the cron after a day.
import { DomainError, notFound } from './util';

// No SVG or HTML: they'd run script on this origin when opened. Karakeep's "SingleFile"
// page archives (HTML) are refused for the same reason.
export const ASSET_TYPES: Record<string, 'image' | 'pdf'> = {
	'image/jpeg': 'image',
	'image/png': 'image',
	'image/gif': 'image',
	'image/webp': 'image',
	'image/avif': 'image',
	'application/pdf': 'pdf',
};
// ponytail: whole-file multipart parse; big files may exceed the Free plan's 10 ms CPU.
// Raise with Workers Paid, or switch to presigned R2 uploads.
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;

export const r2Key = (id: string) => `assets/${id}`;

interface Row {
	id: string;
	bookmark_id: string | null;
	asset_type: string;
	content_type: string;
	size: number;
	file_name: string | null;
	created_at: number;
}

export interface Uploaded {
	assetId: string;
	contentType: string;
	size: number;
	fileName: string;
}

export async function uploadAsset(db: D1Database, bucket: R2Bucket, file: File, now = Date.now()): Promise<Uploaded> {
	const contentType = file.type.split(';')[0].trim().toLowerCase();
	if (!ASSET_TYPES[contentType]) throw new DomainError('BAD_REQUEST', `Only images (JPEG, PNG, GIF, WebP, AVIF) and PDFs can be uploaded, not ${contentType || 'this file type'}.`);
	if (!file.size) throw new DomainError('BAD_REQUEST', 'The file is empty.');
	if (file.size > MAX_ASSET_BYTES) throw new DomainError('BAD_REQUEST', `Files can be up to ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
	const id = crypto.randomUUID();
	const fileName = (file.name || 'file').slice(0, 200);
	await bucket.put(r2Key(id), file, { httpMetadata: { contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` } });
	try {
		await db
			.prepare('INSERT INTO assets (id, asset_type, content_type, size, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
			.bind(id, 'userUploaded', contentType, file.size, fileName, now)
			.run();
	} catch (err) {
		await bucket.delete(r2Key(id));
		throw err;
	}
	return { assetId: id, contentType, size: file.size, fileName };
}

export async function assetExists(db: D1Database, id: string): Promise<boolean> {
	return !!(await db.prepare('SELECT 1 FROM assets WHERE id = ?').bind(id).first());
}

const bump = (db: D1Database, bookmarkId: string, now: number) => db.prepare('UPDATE bookmarks SET updated_at = ? WHERE id = ?').bind(now, bookmarkId);

async function mustOwn(db: D1Database, bookmarkId: string, assetId: string): Promise<Row> {
	const row = await db.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first<Row>();
	if (!row || row.bookmark_id !== bookmarkId) throw notFound('Asset');
	return row;
}

async function mainAssetOf(db: D1Database, bookmarkId: string): Promise<string | null> {
	const b = await db.prepare('SELECT asset_id FROM bookmarks WHERE id = ?').bind(bookmarkId).first<{ asset_id: string | null }>();
	if (!b) throw notFound('Bookmark');
	return b.asset_id;
}

/** Give an unclaimed upload to a bookmark. */
export async function attachAsset(db: D1Database, bookmarkId: string, assetId: string, assetType: string, now = Date.now()) {
	await mainAssetOf(db, bookmarkId);
	const [res] = await db.batch([
		db.prepare('UPDATE assets SET bookmark_id = ?, asset_type = ? WHERE id = ? AND bookmark_id IS NULL').bind(bookmarkId, assetType, assetId),
		bump(db, bookmarkId, now),
	]);
	if (!res.meta.changes) throw new DomainError('BAD_REQUEST', 'Asset not found, or it already belongs to a bookmark.');
	const row = (await db.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first<Row>())!;
	return { id: row.id, assetType: row.asset_type, fileName: row.file_name };
}

/** Returns the id whose R2 object the caller deletes. An asset bookmark's own file can't be detached. */
export async function detachAsset(db: D1Database, bookmarkId: string, assetId: string, now = Date.now()): Promise<string> {
	await mustOwn(db, bookmarkId, assetId);
	if ((await mainAssetOf(db, bookmarkId)) === assetId) throw new DomainError('BAD_REQUEST', "That's the bookmark's own file; delete the bookmark instead.");
	await db.batch([db.prepare('DELETE FROM assets WHERE id = ?').bind(assetId), bump(db, bookmarkId, now)]);
	return assetId;
}

/** Swap one of a bookmark's files for a fresh upload; returns the old id (its R2 object is the caller's to delete). */
export async function replaceAsset(db: D1Database, bookmarkId: string, oldId: string, newId: string, now = Date.now()): Promise<string> {
	const old = await mustOwn(db, bookmarkId, oldId);
	const fresh = await db.prepare('SELECT * FROM assets WHERE id = ? AND bookmark_id IS NULL').bind(newId).first<Row>();
	if (!fresh) throw new DomainError('BAD_REQUEST', 'The new asset was not found, or already belongs to a bookmark.');
	const isMain = (await mainAssetOf(db, bookmarkId)) === oldId;
	const kind = ASSET_TYPES[fresh.content_type];
	if (isMain && !kind) throw new DomainError('BAD_REQUEST', 'An asset bookmark needs an image or a PDF.');
	await db.batch([
		db.prepare('DELETE FROM assets WHERE id = ?').bind(oldId),
		db.prepare('UPDATE assets SET bookmark_id = ?, asset_type = ? WHERE id = ?').bind(bookmarkId, old.asset_type, newId),
		...(isMain ? [db.prepare('UPDATE bookmarks SET asset_id = ?, asset_type = ?, file_name = ? WHERE id = ?').bind(newId, kind, fresh.file_name, bookmarkId)] : []),
		bump(db, bookmarkId, now),
	]);
	return oldId;
}

/** Uploads no bookmark claimed within a day: rows deleted here, R2 objects by the caller. */
export async function sweepOrphanAssets(db: D1Database, now = Date.now()): Promise<string[]> {
	const { results } = await db
		.prepare('DELETE FROM assets WHERE bookmark_id IS NULL AND created_at < ? RETURNING id')
		.bind(now - ORPHAN_AFTER_MS)
		.all<{ id: string }>();
	return results.map((r) => r.id);
}
