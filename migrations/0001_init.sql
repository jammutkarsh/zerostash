-- Zerostash v2 schema: Karakeep-compatible data on D1's free tier.
-- Every index costs one extra row written per insert/update (100k writes/day), so only
-- indexes that back a real query exist. Counts (tags, lists) are kept in step inside the
-- same batch as the membership change, so nothing ever runs COUNT(*) over a join.

CREATE TABLE feeds (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL UNIQUE,
  enabled              INTEGER NOT NULL DEFAULT 1,
  import_tags          INTEGER NOT NULL DEFAULT 0,
  etag                 TEXT,
  last_modified        TEXT,
  last_fetched_at      INTEGER,
  last_fetched_status  TEXT CHECK (last_fetched_status IN ('pending', 'success', 'failure')),
  last_success_at      INTEGER,
  created_at           INTEGER NOT NULL
);

-- One table for every bookmark type (Karakeep splits link/text/asset; one row = one read).
CREATE TABLE bookmarks (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL CHECK (type IN ('link', 'text', 'asset')),
  title                 TEXT,             -- set by the user/client; Karakeep's bookmark.title
  note                  TEXT,
  summary               TEXT,
  archived              INTEGER NOT NULL DEFAULT 0,
  favourited            INTEGER NOT NULL DEFAULT 0,
  source                TEXT CHECK (source IN ('api', 'web', 'cli', 'mobile', 'extension', 'singlefile', 'rss', 'import')),
  feed_id               TEXT REFERENCES feeds (id) ON DELETE SET NULL,
  tagging_status        TEXT CHECK (tagging_status IN ('pending', 'success', 'failure')),
  summarization_status  TEXT CHECK (summarization_status IN ('pending', 'success', 'failure')),
  -- link
  url                   TEXT,
  link_title            TEXT,             -- from the page (OpenGraph); Karakeep's content.title
  description           TEXT,
  image_url             TEXT,
  favicon               TEXT,
  publisher             TEXT,
  author                TEXT,
  crawl_status          TEXT CHECK (crawl_status IN ('pending', 'success', 'failure')),
  crawled_at            INTEGER,
  crawl_attempts        INTEGER NOT NULL DEFAULT 0,
  -- text
  text                  TEXT,
  source_url            TEXT,
  -- asset (the file itself is a row in `assets`, bytes in R2)
  asset_id              TEXT,
  asset_type            TEXT CHECK (asset_type IN ('image', 'pdf')),
  file_name             TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX bookmarks_home ON bookmarks (archived, created_at DESC, id DESC);
CREATE INDEX bookmarks_fav ON bookmarks (created_at DESC, id DESC) WHERE favourited = 1;
CREATE UNIQUE INDEX bookmarks_url ON bookmarks (url) WHERE type = 'link';
CREATE INDEX bookmarks_updated ON bookmarks (updated_at);          -- delta sync
CREATE INDEX bookmarks_crawl_todo ON bookmarks (created_at) WHERE crawl_status = 'pending';

CREATE TABLE tags (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  human_count  INTEGER NOT NULL DEFAULT 0,
  ai_count     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX tags_usage ON tags ((human_count + ai_count) DESC);

CREATE TABLE tags_on_bookmarks (
  bookmark_id  TEXT NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  attached_by  TEXT NOT NULL CHECK (attached_by IN ('ai', 'human')),
  PRIMARY KEY (bookmark_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX tags_on_bookmarks_tag ON tags_on_bookmarks (tag_id);

CREATE TABLE lists (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT NOT NULL,
  parent_id    TEXT REFERENCES lists (id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual', 'smart')),
  query        TEXT,                     -- smart lists: search query (Karakeep syntax)
  item_count   INTEGER NOT NULL DEFAULT 0, -- bookmarks added by hand
  created_at   INTEGER NOT NULL
);

CREATE TABLE bookmarks_in_lists (
  bookmark_id  TEXT NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  list_id      TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, list_id)
) WITHOUT ROWID;
CREATE INDEX bookmarks_in_lists_list ON bookmarks_in_lists (list_id);

CREATE TABLE assets (
  id            TEXT PRIMARY KEY,         -- R2 key: assets/<id>
  bookmark_id   TEXT REFERENCES bookmarks (id) ON DELETE SET NULL,
  asset_type    TEXT NOT NULL,            -- Karakeep asset type (bookmarkAsset, userUploaded, ...)
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  file_name     TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX assets_bookmark ON assets (bookmark_id);

CREATE TABLE rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  event        TEXT NOT NULL,   -- JSON, Karakeep's rule event shape
  condition    TEXT NOT NULL,   -- JSON
  actions      TEXT NOT NULL,   -- JSON array
  created_at   INTEGER NOT NULL
);

CREATE TABLE webhooks (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  events      TEXT NOT NULL,    -- JSON array of event names
  token       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL          -- JSON
);

-- Delta sync: "deleted since X" and the 30-day purge are both range scans.
CREATE TABLE tombstones (
  deleted_at  INTEGER NOT NULL,
  id          TEXT NOT NULL,
  PRIMARY KEY (deleted_at, id)
) WITHOUT ROWID;
