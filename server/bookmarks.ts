// Bookmark persistence. All list queries are index-backed and cursor-paginated
// (no OFFSET, no COUNT) to stay inside the Free plan's 5M rows read/day.
import type { OgData, OgSource } from '../shared/og';
import type { Bookmark, BookmarkPage, CreateBookmark, PatchBookmark } from '../shared/schemas';

interface BookmarkRow {
	id: string;
	type: 'link' | 'text';
	url: string | null;
	title: string | null;
	description: string | null;
	image_url: string | null;
	site_name: string | null;
	favicon_url: string | null;
	text: string | null;
	note: string | null;
	summary: string | null;
	favourited: number;
	archived: number;
	source: Bookmark['source'];
	ai_status: Bookmark['aiStatus'];
	og_status: Bookmark['ogStatus'];
	og_source: Bookmark['ogSource'];
	created_at: number;
	updated_at: number;
	list_ids: string; // JSON array
}

// Always selected FROM bookmarks b. list_ids reads bookmark_lists by its primary-key prefix.
const COLUMNS = `b.id, b.type, b.url, b.title, b.description, b.image_url, b.site_name, b.favicon_url, b.text, b.note,
	b.summary, b.favourited, b.archived, b.source, b.ai_status, b.og_status, b.og_source, b.created_at, b.updated_at,
	(SELECT json_group_array(list_id) FROM bookmark_lists WHERE bookmark_id = b.id) AS list_ids`;

// Must mirror OG_SOURCE_RANK in shared/og.ts.
const OG_RANK_SQL = `CASE og_source WHEN 'server' THEN 1 WHEN 'feed' THEN 2 WHEN 'extension' THEN 3
	WHEN 'bookmarklet' THEN 4 WHEN 'tab' THEN 5 ELSE 0 END`;
const OG_RANK: Record<OgSource, number> = { server: 1, feed: 2, extension: 3, bookmarklet: 4, tab: 5 };

export const OG_MAX_ATTEMPTS = 3;
export const OG_SERVER_GRACE_MS = 2 * 60 * 1000;

function toBookmark(r: BookmarkRow): Bookmark {
	return {
		id: r.id,
		type: r.type,
		url: r.url,
		title: r.title,
		description: r.description,
		imageUrl: r.image_url,
		siteName: r.site_name,
		faviconUrl: r.favicon_url,
		text: r.text,
		note: r.note,
		summary: r.summary,
		favourited: r.favourited === 1,
		archived: r.archived === 1,
		source: r.source,
		aiStatus: r.ai_status,
		ogStatus: r.og_status,
		ogSource: r.og_source,
		listIds: JSON.parse(r.list_ids ?? '[]') as string[],
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

function encodeCursor(r: Pick<BookmarkRow, 'created_at' | 'id'>): string {
	return `${r.created_at}_${r.id}`;
}

function decodeCursor(cursor: string | undefined): [number, string] {
	if (!cursor) return [Number.MAX_SAFE_INTEGER, ''];
	const i = cursor.indexOf('_');
	const at = Number(cursor.slice(0, i));
	return Number.isFinite(at) && i > 0 ? [at, cursor.slice(i + 1)] : [Number.MAX_SAFE_INTEGER, ''];
}

export async function getBookmark(db: D1Database, id: string): Promise<Bookmark | null> {
	const row = await db.prepare(`SELECT ${COLUMNS} FROM bookmarks b WHERE b.id = ?`).bind(id).first<BookmarkRow>();
	return row ? toBookmark(row) : null;
}

const SEARCH_COLUMNS = ['title', 'url', 'description', 'site_name', 'note', 'text', 'summary'];

export async function listBookmarks(
	db: D1Database,
	q: { cursor?: string; limit: number; view: 'home' | 'archive' | 'favourites'; q?: string; list?: { id: string; kind: 'manual' | 'smart'; query: string | null } },
): Promise<BookmarkPage> {
	const [at, id] = decodeCursor(q.cursor);
	let from = 'bookmarks b';
	let where: string;
	const params: (string | number)[] = [];
	const search = q.list?.kind === 'smart' ? q.list.query : q.q;
	if (q.list?.kind === 'manual') {
		// Rows read = members of the list, via the bookmark_lists_list index.
		from = 'bookmark_lists bl JOIN bookmarks b ON b.id = bl.bookmark_id';
		where = 'bl.list_id = ?';
		params.push(q.list.id);
	} else if (search) {
		// Search covers every bookmark, archived included (Karakeep behaviour). Full scan by
		// design: ~1 row read per bookmark per search, fine at personal scale.
		const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where = `(${SEARCH_COLUMNS.map((c) => `b.${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
		params.push(...SEARCH_COLUMNS.map(() => like));
	} else {
		// Each branch matches an index exactly: bookmarks_home / bookmarks_fav.
		where = q.view === 'favourites' ? 'b.favourited = 1' : `b.archived = ${q.view === 'archive' ? 1 : 0}`;
	}
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM ${from} WHERE ${where} AND (b.created_at, b.id) < (?, ?)
			 ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
		)
		.bind(...params, at, id, q.limit + 1)
		.all<BookmarkRow>();
	const page = results.slice(0, q.limit);
	return {
		items: page.map(toBookmark),
		nextCursor: results.length > q.limit ? encodeCursor(page[page.length - 1]) : null,
	};
}

export async function createBookmark(
	db: D1Database,
	input: Omit<CreateBookmark, 'type' | 'source'> & { type: 'link' | 'text'; source: Bookmark['source'] },
	now = Date.now(),
): Promise<{ bookmark: Bookmark; alreadyExists: boolean }> {
	const id = crypto.randomUUID();
	const og = input.og;
	const isLink = input.type === 'link';
	const title = input.title || og?.title || null;
	const ogStatus = !isLink || og ? 'done' : 'pending';
	const inserted = await db
		.prepare(
			`INSERT INTO bookmarks (id, type, url, title, title_locked, description, image_url, site_name, favicon_url,
				text, note, source, og_status, og_source, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (url) WHERE type = 'link' DO NOTHING`,
		)
		.bind(
			id,
			input.type,
			isLink ? input.url : null,
			title,
			input.title ? 1 : 0,
			og?.description ?? null,
			og?.imageUrl ?? null,
			og?.siteName ?? null,
			og?.faviconUrl ?? null,
			isLink ? null : input.text,
			input.note || null,
			input.source,
			ogStatus,
			og ? og.source : null,
			now,
			now,
		)
		.run();

	if (inserted.meta.changes === 1) {
		return { bookmark: (await getBookmark(db, id))!, alreadyExists: false };
	}
	// Duplicate URL: return the existing bookmark, upgrading its OG if this save carries better data.
	const existing = await db.prepare(`SELECT id FROM bookmarks WHERE url = ? AND type = 'link'`).bind(input.url).first<{ id: string }>();
	if (!existing) throw new Error('insert ignored but no existing bookmark found');
	if (og) await applyOg(db, existing.id, og, og.source, now);
	return { bookmark: (await getBookmark(db, existing.id))!, alreadyExists: true };
}

export async function patchBookmark(db: D1Database, id: string, patch: PatchBookmark, now = Date.now()): Promise<Bookmark | null> {
	const sets: string[] = [];
	const values: (string | number | null)[] = [];
	if (patch.title !== undefined) sets.push('title = ?', 'title_locked = 1'), values.push(patch.title || null);
	if (patch.note !== undefined) sets.push('note = ?'), values.push(patch.note || null);
	if (patch.text !== undefined) sets.push('text = ?'), values.push(patch.text);
	if (patch.favourited !== undefined) sets.push('favourited = ?'), values.push(patch.favourited ? 1 : 0);
	if (patch.archived !== undefined) sets.push('archived = ?'), values.push(patch.archived ? 1 : 0);
	if (sets.length) {
		await db
			.prepare(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
			.bind(...values, now, id)
			.run();
	}
	return getBookmark(db, id);
}

export async function deleteBookmark(db: D1Database, id: string): Promise<boolean> {
	// Keep list counts right: decrement before the cascade removes the memberships.
	const [, res] = await db.batch([
		db.prepare('UPDATE lists SET item_count = item_count - 1 WHERE id IN (SELECT list_id FROM bookmark_lists WHERE bookmark_id = ?)').bind(id),
		db.prepare('DELETE FROM bookmarks WHERE id = ?').bind(id),
	]);
	return res.meta.changes > 0;
}

/**
 * Write OG data unless the bookmark already holds data from a higher-ranked source.
 * Missing fields keep their current values; a user-edited title is never replaced.
 */
export async function applyOg(db: D1Database, id: string, og: OgData, source: OgSource, now = Date.now()): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE bookmarks SET
				title = CASE WHEN title_locked = 1 THEN title ELSE COALESCE(?, title) END,
				description = COALESCE(?, description),
				image_url = COALESCE(?, image_url),
				site_name = COALESCE(?, site_name),
				favicon_url = COALESCE(?, favicon_url),
				og_source = ?, og_status = 'done', updated_at = ?
			 WHERE id = ? AND ${OG_RANK_SQL} <= ?`,
		)
		.bind(
			og.title ?? null,
			og.description ?? null,
			og.imageUrl ?? null,
			og.siteName ?? null,
			og.faviconUrl ?? null,
			source,
			now,
			id,
			OG_RANK[source],
		)
		.run();
	return res.meta.changes > 0;
}

/** Record a failed OG fetch. Server failures leave the bookmark for the extension to retry. */
export async function markOgFailed(db: D1Database, id: string, source: 'extension' | 'server', now = Date.now()): Promise<void> {
	// Right-hand sides see the old row, so `og_attempts + 1` is the new attempt count.
	const status = source === 'server' ? `'server_failed'` : 'og_status';
	await db
		.prepare(
			`UPDATE bookmarks SET og_attempts = og_attempts + 1,
				og_status = CASE WHEN og_attempts + 1 >= ? THEN 'failed' ELSE ${status} END,
				updated_at = ?
			 WHERE id = ? AND og_status IN ('pending', 'server_failed')`,
		)
		.bind(OG_MAX_ATTEMPTS, now, id)
		.run();
}

/** Bookmarks the extension should fetch OG for (pending, or the server got blocked). */
export async function needsOg(db: D1Database, limit: number): Promise<{ id: string; url: string }[]> {
	const { results } = await db
		.prepare(
			`SELECT id, url FROM bookmarks WHERE og_status IN ('pending', 'server_failed')
			 ORDER BY created_at LIMIT ?`,
		)
		.bind(limit)
		.all<{ id: string; url: string }>();
	return results;
}

/** Pending bookmarks old enough that the extension has had its head start. */
export async function pendingForServerOg(db: D1Database, limit: number, now = Date.now()): Promise<{ id: string; url: string }[]> {
	const { results } = await db
		.prepare(
			// The IN term matches the partial index's WHERE so SQLite can use bookmarks_og_todo.
			`SELECT id, url FROM bookmarks WHERE og_status IN ('pending', 'server_failed') AND og_status = 'pending'
			 AND created_at < ? ORDER BY created_at LIMIT ?`,
		)
		.bind(now - OG_SERVER_GRACE_MS, limit)
		.all<{ id: string; url: string }>();
	return results;
}
