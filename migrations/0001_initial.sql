CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES collections(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  link TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  media_json TEXT NOT NULL DEFAULT '[]',
  collection_id TEXT NOT NULL REFERENCES collections(id),
  tags_json TEXT NOT NULL DEFAULT '[]',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  health_checked_at TEXT,
  health_final_url TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tag_names (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX bookmarks_collection_position ON bookmarks (collection_id, position);
CREATE INDEX bookmarks_live_link ON bookmarks (link, deleted_at);
CREATE INDEX collections_parent_position ON collections (parent_id, position);

INSERT INTO collections (id, parent_id, name, position, created_at, updated_at)
VALUES ('unsorted', NULL, 'Unsorted', 0, datetime('now'), datetime('now'));
