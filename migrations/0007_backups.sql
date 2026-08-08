CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'automatic', 'pre_restore')),
  include_media INTEGER NOT NULL DEFAULT 0,
  media_copied INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  library_bytes INTEGER NOT NULL DEFAULT 0,
  library_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX backups_kind_created_at ON backups (kind, created_at DESC);
