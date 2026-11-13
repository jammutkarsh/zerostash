// Usage stats (Karakeep's users.stats shape). Occasional screen, so plain aggregates.
// ponytail: each call scans bookmarks once (~1 read per bookmark); per-day activity charts and
// top domains are left empty. Cache in settings if a client starts polling this.
const DAY = 86_400_000;

export async function userStats(db: D1Database, now = Date.now()) {
	const [totals, counts, bySource, topTags, assets] = await db.batch<Record<string, number | string | null>>([
		db
			.prepare(
				`SELECT COUNT(*) AS n, COALESCE(SUM(favourited), 0) AS fav, COALESCE(SUM(archived), 0) AS arch,
					COALESCE(SUM(type = 'link'), 0) AS link, COALESCE(SUM(type = 'text'), 0) AS text, COALESCE(SUM(type = 'asset'), 0) AS asset,
					COALESCE(SUM(created_at > ?1), 0) AS week, COALESCE(SUM(created_at > ?2), 0) AS month, COALESCE(SUM(created_at > ?3), 0) AS year
				 FROM bookmarks`,
			)
			.bind(now - 7 * DAY, now - 30 * DAY, now - 365 * DAY),
		db.prepare('SELECT (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(*) FROM lists) AS lists'),
		db.prepare('SELECT source, COUNT(*) AS count FROM bookmarks GROUP BY source'),
		db.prepare('SELECT name, human_count + ai_count AS count FROM tags ORDER BY count DESC LIMIT 10'),
		db.prepare('SELECT asset_type AS type, COUNT(*) AS count, COALESCE(SUM(size), 0) AS totalSize FROM assets GROUP BY asset_type'),
	]);
	const t = totals.results[0] as Record<string, number>;
	const c = counts.results[0] as Record<string, number>;
	const assetRows = assets.results as { type: string; count: number; totalSize: number }[];
	return {
		numBookmarks: t.n,
		numFavorites: t.fav,
		numArchived: t.arch,
		numTags: c.tags,
		numLists: c.lists,
		numHighlights: 0,
		bookmarksByType: { link: t.link, text: t.text, asset: t.asset },
		topDomains: [] as { domain: string; count: number }[],
		totalAssetSize: assetRows.reduce((n, a) => n + a.totalSize, 0),
		assetsByType: assetRows,
		bookmarkingActivity: { thisWeek: t.week, thisMonth: t.month, thisYear: t.year, byHour: [], byDayOfWeek: [] },
		tagUsage: topTags.results as { name: string; count: number }[],
		bookmarksBySource: bySource.results as { source: string | null; count: number }[],
	};
}
