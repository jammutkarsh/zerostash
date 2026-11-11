-- Zerostash schema. Every index costs one extra row written per insert/update on the
-- free tier's 100k writes/day, so only indexes that back a real query exist.

CREATE TABLE bookmarks (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('link', 'text')),
  url           TEXT,
  title         TEXT,
  title_locked  INTEGER NOT NULL DEFAULT 0,   -- 1 once the user edits the title; OG never overwrites it
  description   TEXT,
  image_url     TEXT,
  site_name     TEXT,
  favicon_url   TEXT,
  text          TEXT,                       -- body of text/note bookmarks
  note          TEXT,                       -- user's note on any bookmark
  summary       TEXT,                       -- AI summary
  favourited    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('extension', 'web', 'bookmarklet', 'import', 'rss', 'api')),
  feed_id       TEXT,
  ai_status     TEXT NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none', 'pending', 'done', 'failed', 'skipped')),
  ai_error      TEXT,
  -- OpenGraph provenance: higher-ranked sources are never overwritten by lower ones
  -- (tab > bookmarklet > extension > feed > server). See shared/og.ts OG_SOURCE_RANK.
  og_status     TEXT NOT NULL DEFAULT 'done' CHECK (og_status IN ('pending', 'done', 'server_failed', 'failed')),
  og_source     TEXT CHECK (og_source IN ('tab', 'bookmarklet', 'extension', 'feed', 'server')),
  og_attempts   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX bookmarks_home ON bookmarks (archived, created_at DESC, id DESC);
CREATE INDEX bookmarks_fav ON bookmarks (created_at DESC, id DESC) WHERE favourited = 1;
CREATE UNIQUE INDEX bookmarks_url ON bookmarks (url) WHERE type = 'link';
CREATE INDEX bookmarks_ai_pending ON bookmarks (created_at) WHERE ai_status = 'pending';
CREATE INDEX bookmarks_og_todo ON bookmarks (created_at) WHERE og_status IN ('pending', 'server_failed');

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  human_count INTEGER NOT NULL DEFAULT 0,     -- maintained in the same batch as attach/detach,
  ai_count    INTEGER NOT NULL DEFAULT 0,     -- so tag pages never scan bookmark_tags
  created_at  INTEGER NOT NULL
);
CREATE INDEX tags_usage ON tags ((human_count + ai_count) DESC);

CREATE TABLE bookmark_tags (
  bookmark_id TEXT NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  attached_by TEXT NOT NULL CHECK (attached_by IN ('ai', 'human')),
  PRIMARY KEY (bookmark_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX bookmark_tags_tag ON bookmark_tags (tag_id);

CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  parent_id  TEXT REFERENCES lists (id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'smart')),
  query      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE bookmark_lists (
  bookmark_id TEXT NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, list_id)
) WITHOUT ROWID;
CREATE INDEX bookmark_lists_list ON bookmark_lists (list_id);

CREATE TABLE feeds (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 1,
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE rules (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  event      TEXT NOT NULL,
  condition  TEXT NOT NULL,   -- JSON
  actions    TEXT NOT NULL,   -- JSON
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL         -- JSON
);
