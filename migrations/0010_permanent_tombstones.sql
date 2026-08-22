ALTER TABLE bookmarks ADD COLUMN permanent_deleted_at TEXT;
CREATE INDEX IF NOT EXISTS bookmarks_permanent_deleted ON bookmarks (permanent_deleted_at);
