// Bookmark persistence, returning Karakeep-shaped bookmarks. List queries are index-backed
// and cursor-paginated (no OFFSET, no COUNT) to stay inside the Free plan's 5M rows read/day.
// Every write that changes what a client shows bumps updated_at (delta sync); deletes leave
// a tombstone.
import type { OgData } from '../../shared/og';
import type { Query } from '../../shared/query';
import { type Bookmark, type BookmarkPage, type BookmarkSource, type NewBookmarkInput, OWNER_ID, type Status, type UpdateBookmark } from '../../shared/schemas';
import { querySql } from './search';
import { DomainError, isUniqueViolation, marks, notFound } from './util';

interface Row {
	id: string;
	type: 'link' | 'text' | 'asset';
	title: string | null;
	note: string | null;
	summary: string | null;
	archived: number;
	favourited: number;
	source: BookmarkSource | null;
	feed_id: string | null;
	tagging_status: Status | null;
	summarization_status: Status | null;
	url: string | null;
	link_title: string | null;
	description: string | null;
	image_url: string | null;
	favicon: string | null;
	publisher: string | null;
	author: string | null;
	crawl_status: Status | null;
	crawled_at: number | null;
	text: string | null;
	source_url: string | null;
	asset_id: string | null;
	asset_type: 'image' | 'pdf' | null;
	file_name: string | null;
	created_at: number;
	updated_at: number;
	list_ids: string; // JSON
	tags: string; // JSON
	assets: string; // JSON
}

// Always selected FROM bookmarks b. Each subquery reads its table by primary-key/index prefix.
const COLUMNS = `b.*,
	(SELECT json_group_array(list_id) FROM bookmarks_in_lists WHERE bookmark_id = b.id) AS list_ids,
	(SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'attachedBy', tb.attached_by))
		FROM tags_on_bookmarks tb JOIN tags t ON t.id = tb.tag_id WHERE tb.bookmark_id = b.id) AS tags,
	(SELECT json_group_array(json_object('id', a.id, 'assetType', a.asset_type, 'fileName', a.file_name))
		FROM assets a WHERE a.bookmark_id = b.id) AS assets`;

const date = (ms: number | null) => (ms === null ? null : new Date(ms));

function toBookmark(r: Row): Bookmark {
	return {
		id: r.id,
		createdAt: new Date(r.created_at),
		modifiedAt: new Date(r.updated_at),
		title: r.title,
		archived: r.archived === 1,
		favourited: r.favourited === 1,
		taggingStatus: r.tagging_status,
		summarizationStatus: r.summarization_status,
		embeddingStatus: null,
		note: r.note,
		summary: r.summary,
		source: r.source,
		userId: OWNER_ID,
		tags: (JSON.parse(r.tags) as Bookmark['tags']).sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' })),
		assets: JSON.parse(r.assets),
		listIds: JSON.parse(r.list_ids),
		feedId: r.feed_id,
		content:
			r.type === 'link'
				? {
						type: 'link',
						url: r.url!,
						title: r.link_title,
						description: r.description,
						imageUrl: r.image_url,
						favicon: r.favicon,
						publisher: r.publisher,
						author: r.author,
						crawlStatus: r.crawl_status,
						crawledAt: date(r.crawled_at),
					}
				: r.type === 'text'
					? { type: 'text', text: r.text ?? '', sourceUrl: r.source_url }
					: { type: 'asset', assetType: r.asset_type ?? 'image', assetId: r.asset_id!, fileName: r.file_name, sourceUrl: r.source_url },
	};
}

export async function getBookmark(db: D1Database, id: string): Promise<Bookmark | null> {
	const row = await db.prepare(`SELECT ${COLUMNS} FROM bookmarks b WHERE b.id = ?`).bind(id).first<Row>();
	return row ? toBookmark(row) : null;
}

export async function mustGetBookmark(db: D1Database, id: string): Promise<Bookmark> {
	const b = await getBookmark(db, id);
	if (!b) throw notFound('Bookmark');
	return b;
}

// ---- listing ----

export interface BookmarkFilter {
	archived?: boolean;
	favourited?: boolean;
	tagId?: string;
	feedId?: string;
	/** Manual list = its members; smart list = its members plus everything its query matches. */
	list?: { id: string; type: 'manual' | 'smart'; query: Query | null };
	query?: Query;
}

export const PAGE_DEFAULT = 20;

function encodeCursor(r: Pick<Row, 'created_at' | 'id'>): string {
	return `${r.created_at}_${r.id}`;
}

function decodeCursor(cursor: string | null | undefined): [number, string] | undefined {
	if (!cursor) return undefined;
	const i = cursor.indexOf('_');
	const at = Number(cursor.slice(0, i));
	return Number.isFinite(at) && i > 0 ? [at, cursor.slice(i + 1)] : undefined;
}

/** Where-clause for a filter (no paging); shared by listing and smart-list counts. */
export function filterSql(f: BookmarkFilter, now: number) {
	let from = 'bookmarks b';
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (f.list?.type === 'manual') {
		// Rows read = the list's members, via the bookmarks_in_lists_list index.
		from = 'bookmarks_in_lists bl JOIN bookmarks b ON b.id = bl.bookmark_id';
		where.push('bl.list_id = ?');
		params.push(f.list.id);
	} else if (f.list) {
		const q = f.list.query ? querySql(f.list.query, now) : { sql: '0', params: [] };
		where.push(`(b.id IN (SELECT bookmark_id FROM bookmarks_in_lists WHERE list_id = ?) OR ${q.sql})`);
		params.push(f.list.id, ...q.params);
	}
	if (f.tagId) where.push('b.id IN (SELECT bookmark_id FROM tags_on_bookmarks WHERE tag_id = ?)'), params.push(f.tagId);
	if (f.feedId) where.push('b.feed_id = ?'), params.push(f.feedId);
	if (f.archived !== undefined) where.push('b.archived = ?'), params.push(f.archived ? 1 : 0);
	if (f.favourited !== undefined) where.push('b.favourited = ?'), params.push(f.favourited ? 1 : 0);
	if (f.query) {
		const q = querySql(f.query, now);
		where.push(q.sql);
		params.push(...q.params);
	}
	return { from, where: where.length ? where.join(' AND ') : '1', params };
}

export async function listBookmarks(
	db: D1Database,
	f: BookmarkFilter,
	page: { cursor?: string | null; limit?: number; order?: 'asc' | 'desc' },
	now = Date.now(),
): Promise<BookmarkPage> {
	const limit = page.limit ?? PAGE_DEFAULT;
	const asc = page.order === 'asc';
	const { from, where, params } = filterSql(f, now);
	const after = decodeCursor(page.cursor);
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM ${from} WHERE ${where} ${after ? `AND (b.created_at, b.id) ${asc ? '>' : '<'} (?, ?)` : ''}
			 ORDER BY b.created_at ${asc ? 'ASC' : 'DESC'}, b.id ${asc ? 'ASC' : 'DESC'} LIMIT ?`,
		)
		.bind(...params, ...(after ?? []), limit + 1)
		.all<Row>();
	const rows = results.slice(0, limit);
	return { bookmarks: rows.map(toBookmark), nextCursor: results.length > limit ? encodeCursor(rows[rows.length - 1]) : null };
}

/** How many bookmarks match a filter. ponytail: COUNT over a scan; only used for smart-list sizes. */
export async function countBookmarks(db: D1Database, f: BookmarkFilter, now = Date.now()): Promise<number> {
	const { from, where, params } = filterSql(f, now);
	return (await db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`).bind(...params).first<number>('n')) ?? 0;
}

export async function checkUrl(db: D1Database, url: string): Promise<string | null> {
	return db.prepare(`SELECT id FROM bookmarks WHERE url = ? AND type = 'link'`).bind(url).first<string>('id');
}

// ---- writes ----

export async function createBookmark(
	db: D1Database,
	input: NewBookmarkInput,
	now = Date.now(),
): Promise<{ bookmark: Bookmark; alreadyExists: boolean }> {
	const id = crypto.randomUUID();
	const createdAt = input.createdAt?.getTime() ?? now;
	if (input.type === 'asset') {
		const asset = await db.prepare('SELECT bookmark_id FROM assets WHERE id = ?').bind(input.assetId!).first<{ bookmark_id: string | null }>();
		if (!asset) throw notFound('Asset');
		if (asset.bookmark_id) throw new DomainError('CONFLICT', 'That asset already belongs to a bookmark.');
	}
	const insert = db
		.prepare(
			`INSERT INTO bookmarks (id, type, title, note, summary, archived, favourited, source, url, crawl_status, text, source_url,
				asset_id, asset_type, file_name, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (url) WHERE type = 'link' DO NOTHING`,
		)
		.bind(
			id,
			input.type,
			input.title || null,
			input.note || null,
			input.summary || null,
			input.archived ? 1 : 0,
			input.favourited ? 1 : 0,
			input.source ?? 'api',
			input.type === 'link' ? input.url! : null,
			input.type === 'link' ? 'pending' : null,
			input.type === 'text' ? input.text! : null,
			input.type === 'link' ? null : (input.sourceUrl ?? null),
			input.type === 'asset' ? input.assetId! : null,
			input.type === 'asset' ? input.assetType! : null,
			input.type === 'asset' ? (input.fileName ?? null) : null,
			createdAt,
			now,
		);
	const [inserted] = await db.batch([
		insert,
		...(input.type === 'asset'
			? [db.prepare(`UPDATE assets SET bookmark_id = ?, asset_type = 'bookmarkAsset' WHERE id = ?`).bind(id, input.assetId!)]
			: []),
	]);
	if (inserted.meta.changes === 1) return { bookmark: (await getBookmark(db, id))!, alreadyExists: false };
	// Duplicate URL: Karakeep returns the existing bookmark with alreadyExists.
	const existing = await checkUrl(db, input.url!);
	if (!existing) throw new Error('insert ignored but no existing bookmark found');
	return { bookmark: (await getBookmark(db, existing))!, alreadyExists: true };
}

export async function updateBookmark(db: D1Database, patch: UpdateBookmark, now = Date.now()): Promise<Bookmark> {
	const current = await mustGetBookmark(db, patch.bookmarkId);
	const sets: string[] = [];
	const values: (string | number | null)[] = [];
	const set = (column: string, value: string | number | null) => (sets.push(`${column} = ?`), values.push(value));
	if (patch.title !== undefined) set('title', patch.title || null);
	if (patch.note !== undefined) set('note', patch.note || null);
	if (patch.summary !== undefined) set('summary', patch.summary || null);
	if (patch.archived !== undefined) set('archived', patch.archived ? 1 : 0);
	if (patch.favourited !== undefined) set('favourited', patch.favourited ? 1 : 0);
	if (patch.createdAt !== undefined) set('created_at', patch.createdAt.getTime());
	const link = current.content.type === 'link';
	if (link && patch.url !== undefined) set('url', patch.url);
	if (link && patch.description !== undefined) set('description', patch.description || null);
	if (link && patch.author !== undefined) set('author', patch.author || null);
	if (link && patch.publisher !== undefined) set('publisher', patch.publisher || null);
	if (current.content.type === 'text' && patch.text) set('text', patch.text);
	if (sets.length) {
		try {
			await db
				.prepare(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
				.bind(...values, now, patch.bookmarkId)
				.run();
		} catch (err) {
			if (isUniqueViolation(err)) throw new DomainError('CONFLICT', 'Another bookmark already has this URL.');
			throw err;
		}
	}
	return mustGetBookmark(db, patch.bookmarkId);
}

/** Returns the ids of the bookmark's assets (their R2 objects are the caller's to delete), or null if missing. */
export async function deleteBookmark(db: D1Database, id: string, now = Date.now()): Promise<string[] | null> {
	const { results: assets } = await db.prepare('SELECT id FROM assets WHERE bookmark_id = ?').bind(id).all<{ id: string }>();
	// Counts first, while the memberships still exist; the cascade then removes them.
	const res = await db.batch([
		db.prepare('UPDATE lists SET item_count = item_count - 1 WHERE id IN (SELECT list_id FROM bookmarks_in_lists WHERE bookmark_id = ?)').bind(id),
		db.prepare(`UPDATE tags SET human_count = human_count - 1 WHERE id IN (SELECT tag_id FROM tags_on_bookmarks WHERE bookmark_id = ? AND attached_by = 'human')`).bind(id),
		db.prepare(`UPDATE tags SET ai_count = ai_count - 1 WHERE id IN (SELECT tag_id FROM tags_on_bookmarks WHERE bookmark_id = ? AND attached_by = 'ai')`).bind(id),
		db.prepare('DELETE FROM assets WHERE bookmark_id = ?').bind(id),
		db.prepare('INSERT INTO tombstones (deleted_at, id) SELECT ?, id FROM bookmarks WHERE id = ?').bind(now, id),
		db.prepare('DELETE FROM bookmarks WHERE id = ?').bind(id),
	]);
	return res[res.length - 1].meta.changes > 0 ? assets.map((a) => a.id) : null;
}

// ---- link previews (crawl) ----

export const CRAWL_MAX_ATTEMPTS = 3;
export const CRAWL_RETRY_AFTER_MS = 2 * 60 * 1000;

/** Fill page metadata; fields the page doesn't declare keep their current values. */
export async function applyCrawl(db: D1Database, id: string, og: OgData, now = Date.now()): Promise<void> {
	await db
		.prepare(
			`UPDATE bookmarks SET
				link_title = COALESCE(?, link_title), description = COALESCE(?, description), image_url = COALESCE(?, image_url),
				publisher = COALESCE(?, publisher), favicon = COALESCE(?, favicon), author = COALESCE(?, author),
				crawl_status = 'success', crawled_at = ?, updated_at = ?
			 WHERE id = ? AND type = 'link'`,
		)
		.bind(og.title ?? null, og.description ?? null, og.imageUrl ?? null, og.siteName ?? null, og.faviconUrl ?? null, og.author ?? null, now, now, id)
		.run();
}

/** A failed fetch: retried by the cron until CRAWL_MAX_ATTEMPTS, then marked failed. */
export async function markCrawlFailed(db: D1Database, id: string, now = Date.now()): Promise<void> {
	// Right-hand sides see the old row, so `crawl_attempts + 1` is the new attempt count.
	await db
		.prepare(
			`UPDATE bookmarks SET crawl_attempts = crawl_attempts + 1,
				crawl_status = CASE WHEN crawl_attempts + 1 >= ? THEN 'failure' ELSE 'pending' END, updated_at = ?
			 WHERE id = ? AND crawl_status = 'pending'`,
		)
		.bind(CRAWL_MAX_ATTEMPTS, now, id)
		.run();
}

export async function recrawl(db: D1Database, id: string, now = Date.now()): Promise<void> {
	const res = await db
		.prepare(`UPDATE bookmarks SET crawl_status = 'pending', crawl_attempts = 0, updated_at = ? WHERE id = ? AND type = 'link'`)
		.bind(now, id)
		.run();
	if (!res.meta.changes) throw notFound('Link bookmark');
}

/** Pending links whose immediate fetch failed (or never ran), oldest first. */
export async function pendingCrawls(db: D1Database, limit: number, now = Date.now()): Promise<{ id: string; url: string }[]> {
	const { results } = await db
		.prepare(`SELECT id, url FROM bookmarks WHERE crawl_status = 'pending' AND updated_at < ? ORDER BY created_at LIMIT ?`)
		.bind(now - CRAWL_RETRY_AFTER_MS, limit)
		.all<{ id: string; url: string }>();
	return results;
}

// ---- delta sync ----

export const SYNC_LIMIT = 100; // more changes than this: the client reloads instead
// The cursor trails "now" by a minute, so the next call re-sends that minute: covers writes
// stamped just before this read but committed after it, and clock skew between Workers.
export const SYNC_OVERLAP_MS = 60_000;
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function changesSince(
	db: D1Database,
	since: number | undefined,
	now = Date.now(),
): Promise<{ bookmarks: Bookmark[]; deleted: string[]; cursor: number; reset: boolean }> {
	const cursor = now - SYNC_OVERLAP_MS;
	const reset = { bookmarks: [], deleted: [], cursor, reset: true };
	if (since === undefined || since < now - TOMBSTONE_TTL_MS) return reset;
	// Both are index range scans: rows read = rows changed.
	const [changed, gone] = await Promise.all([
		db.prepare(`SELECT ${COLUMNS} FROM bookmarks b WHERE b.updated_at > ? ORDER BY b.updated_at LIMIT ?`).bind(since, SYNC_LIMIT + 1).all<Row>(),
		db.prepare('SELECT id FROM tombstones WHERE deleted_at > ? LIMIT ?').bind(since, SYNC_LIMIT + 1).all<{ id: string }>(),
	]);
	if (changed.results.length > SYNC_LIMIT || gone.results.length > SYNC_LIMIT) return reset;
	return { bookmarks: changed.results.map(toBookmark), deleted: gone.results.map((r) => r.id), cursor, reset: false };
}

/** Clients that last synced before the TTL get `reset`, so older tombstones can go. */
export async function purgeTombstones(db: D1Database, now = Date.now()): Promise<void> {
	await db.prepare('DELETE FROM tombstones WHERE deleted_at < ?').bind(now - TOMBSTONE_TTL_MS).run();
}

// ---- AI ----

/** Mark AI work as queued, so clients show it as in progress. */
export async function markAiPending(db: D1Database, ids: string[], tag: boolean, summarize: boolean, now = Date.now()): Promise<void> {
	await db
		.prepare(
			`UPDATE bookmarks SET tagging_status = CASE WHEN ? THEN 'pending' ELSE tagging_status END,
				summarization_status = CASE WHEN ? THEN 'pending' ELSE summarization_status END, updated_at = ? WHERE id IN (${marks(ids.length)})`,
		)
		.bind(tag ? 1 : 0, summarize ? 1 : 0, now, ...ids)
		.run();
}

/** Record an AI outcome. A summary is written only when given (and never over the user's own). */
export async function finishAi(
	db: D1Database,
	id: string,
	r: { tagging?: Status; summarization?: Status; summary?: string },
	now = Date.now(),
): Promise<void> {
	await db
		.prepare(
			`UPDATE bookmarks SET tagging_status = COALESCE(?, tagging_status), summarization_status = COALESCE(?, summarization_status),
				summary = CASE WHEN ? IS NOT NULL AND (summary IS NULL OR summary = '') THEN ? ELSE summary END, updated_at = ? WHERE id = ?`,
		)
		.bind(r.tagging ?? null, r.summarization ?? null, r.summary ?? null, r.summary ?? null, now, id)
		.run();
}
