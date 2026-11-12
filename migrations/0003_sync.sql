-- Delta sync (GET /api/v1/changes): clients ask for what changed since their last sync
-- instead of re-reading whole pages. Every write that changes what a client shows bumps
-- bookmarks.updated_at; a delete leaves a tombstone, which the cron purges after 30 days.
CREATE INDEX bookmarks_updated ON bookmarks (updated_at);

-- Keyed by time first so "deleted since X" and the purge are both range scans.
CREATE TABLE tombstones (
	deleted_at INTEGER NOT NULL,
	id TEXT NOT NULL,
	PRIMARY KEY (deleted_at, id)
) WITHOUT ROWID;
