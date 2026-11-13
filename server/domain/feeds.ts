// RSS/Atom subscriptions. The cron queues feeds that are due; a queue job fetches one feed and
// saves its newest items as bookmarks (source "rss"), skipping URLs already saved.
import type { FeedItem } from '../../shared/feed';
import type { Feed, Status } from '../../shared/schemas';
import { isUniqueViolation, DomainError, notFound } from './util';

interface Row {
	id: string;
	name: string;
	url: string;
	enabled: number;
	import_tags: number;
	etag: string | null;
	last_modified: string | null;
	last_fetched_at: number | null;
	last_fetched_status: Status | null;
	last_success_at: number | null;
}
export type FeedRow = Row;

const toFeed = (r: Row): Feed => ({
	id: r.id,
	name: r.name,
	url: r.url,
	enabled: r.enabled === 1,
	importTags: r.import_tags === 1,
	lastFetchedStatus: r.last_fetched_status,
	lastFetchedAt: r.last_fetched_at === null ? null : new Date(r.last_fetched_at),
	lastSuccessfulFetchAt: r.last_success_at === null ? null : new Date(r.last_success_at),
});

export const FEED_INTERVAL_MS = 60 * 60 * 1000; // each feed at most hourly
export const FEED_ITEMS_PER_FETCH = 20; // newest first; keeps one job inside D1's 50 queries

export async function allFeeds(db: D1Database): Promise<Feed[]> {
	return (await db.prepare('SELECT * FROM feeds ORDER BY name COLLATE NOCASE').all<Row>()).results.map(toFeed);
}

export async function feedRow(db: D1Database, id: string): Promise<Row> {
	const row = await db.prepare('SELECT * FROM feeds WHERE id = ?').bind(id).first<Row>();
	if (!row) throw notFound('Feed');
	return row;
}

export const getFeed = async (db: D1Database, id: string) => toFeed(await feedRow(db, id));

const conflict = (err: unknown) => {
	if (isUniqueViolation(err)) throw new DomainError('CONFLICT', "You're already subscribed to that feed.");
	throw err;
};

export async function createFeed(db: D1Database, f: { name: string; url: string; enabled: boolean; importTags: boolean }, now = Date.now()): Promise<Feed> {
	const id = crypto.randomUUID();
	await db
		.prepare('INSERT INTO feeds (id, name, url, enabled, import_tags, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, f.name, f.url, f.enabled ? 1 : 0, f.importTags ? 1 : 0, now)
		.run()
		.catch(conflict);
	return getFeed(db, id);
}

export async function updateFeed(db: D1Database, p: { feedId: string; name?: string; url?: string; enabled?: boolean; importTags?: boolean }): Promise<Feed> {
	await feedRow(db, p.feedId);
	const sets: string[] = [];
	const values: (string | number | null)[] = [];
	if (p.name !== undefined) sets.push('name = ?'), values.push(p.name);
	if (p.url !== undefined) sets.push('url = ?, etag = NULL, last_modified = NULL'), values.push(p.url);
	if (p.enabled !== undefined) sets.push('enabled = ?'), values.push(p.enabled ? 1 : 0);
	if (p.importTags !== undefined) sets.push('import_tags = ?'), values.push(p.importTags ? 1 : 0);
	if (sets.length) await db.prepare(`UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`).bind(...values, p.feedId).run().catch(conflict);
	return getFeed(db, p.feedId);
}

/** Unsubscribe; bookmarks it brought in stay (feed_id goes NULL). */
export async function deleteFeed(db: D1Database, id: string): Promise<void> {
	const res = await db.prepare('DELETE FROM feeds WHERE id = ?').bind(id).run();
	if (!res.meta.changes) throw notFound('Feed');
}

/** Feeds due for a fetch, claimed (last_fetched_at = now) so the next cron run doesn't queue them again. */
export async function claimDueFeeds(db: D1Database, limit: number, now = Date.now()): Promise<string[]> {
	const { results } = await db
		.prepare(
			`UPDATE feeds SET last_fetched_at = ?, last_fetched_status = 'pending'
			 WHERE id IN (SELECT id FROM feeds WHERE enabled = 1 AND (last_fetched_at IS NULL OR last_fetched_at < ?) ORDER BY last_fetched_at LIMIT ?)
			 RETURNING id`,
		)
		.bind(now, now - FEED_INTERVAL_MS, limit)
		.all<{ id: string }>();
	return results.map((r) => r.id);
}

export async function recordFetch(
	db: D1Database,
	id: string,
	r: { ok: boolean; etag?: string | null; lastModified?: string | null },
	now = Date.now(),
): Promise<void> {
	await db
		.prepare(
			`UPDATE feeds SET last_fetched_at = ?, last_fetched_status = ?, last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
				etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified) WHERE id = ?`,
		)
		.bind(now, r.ok ? 'success' : 'failure', r.ok ? 1 : 0, now, r.etag ?? null, r.lastModified ?? null, id)
		.run();
}

/**
 * Save new items as bookmarks in one batch. Feed order is kept (newest first) by spacing
 * created_at a millisecond apart. Returns the new bookmarks with their item.
 */
export async function importItems(db: D1Database, feedId: string, items: FeedItem[], now = Date.now()): Promise<{ id: string; item: FeedItem }[]> {
	const rows = items.slice(0, FEED_ITEMS_PER_FETCH).map((item, i) => ({ id: crypto.randomUUID(), item, at: now - i }));
	if (!rows.length) return [];
	const res = await db.batch(
		rows.map((r) =>
			db
				.prepare(
					`INSERT INTO bookmarks (id, type, url, link_title, description, source, feed_id, crawl_status, created_at, updated_at)
					 VALUES (?, 'link', ?, ?, ?, 'rss', ?, 'pending', ?, ?) ON CONFLICT (url) WHERE type = 'link' DO NOTHING`,
				)
				.bind(r.id, r.item.url, r.item.title ?? null, r.item.summary ?? null, feedId, r.at, now),
		),
	);
	return rows.filter((_, i) => res[i].meta.changes === 1).map(({ id, item }) => ({ id, item }));
}
