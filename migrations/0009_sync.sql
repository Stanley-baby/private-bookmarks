-- Incremental sync uses the existing record revisions and updated_at values.
-- Tombstones are retained by the scheduled purge for at least 90 days.
CREATE INDEX IF NOT EXISTS bookmarks_sync_updated ON bookmarks (updated_at, id);
CREATE INDEX IF NOT EXISTS collections_sync_updated ON collections (updated_at, id);
