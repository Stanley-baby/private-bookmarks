import assert from "node:assert/strict";
import test from "node:test";
import { applyBookmarkBatch, normalizeBookmark, bytesToCover, fileToCover, filterSyncableOutbox, mergeBookmarkConflict } from "../extension/shared/local-model.js";

test("local bookmarks normalize URLs, tags, defaults, and preserve creation time", () => {
  const item = normalizeBookmark(
    { link: "https://example.com", tags: [" docs ", "docs", ""] },
    { createdAt: "2026-01-01T00:00:00.000Z" },
    "2026-08-12T00:00:00.000Z",
    "bookmark-1",
  );
  assert.deepEqual(item, {
    id: "bookmark-1",
    link: "https://example.com/",
    title: "https://example.com",
    description: "",
    note: "",
    collectionId: "unsorted",
    tags: ["docs"],
    cover: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  });
});

test("bookmark normalization preserves lifecycle and compatibility fields", () => {
  const item = normalizeBookmark({
    id: "bookmark-compat",
    link: "https://example.com/article",
    title: "Article",
    description: "Description",
    note: "**Note**",
    collectionId: "collection-1",
    tags: ["reading"],
    type: "article",
    language: "zh-CN",
    favorite: true,
    reminder: "2026-08-23T09:00:00.000Z",
    cover: "https://example.com/cover.png",
    media: [{ url: "https://example.com/media.png" }],
    highlights: [{ text: "important", position: 2 }],
    health: { status: "ok", checkedAt: "2026-08-23T08:00:00.000Z", finalUrl: "https://example.com/final" },
    position: 7,
    source: "legacy-extension",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-23T08:00:00.000Z",
    revision: 4,
    deletedAt: "2026-08-23T08:30:00.000Z",
    deletedByCollectionId: "collection-1",
    purgedAt: "2026-08-23T08:30:00.000Z",
    permanentDeletedAt: "2026-08-23T08:30:00.000Z",
  }, undefined, "2026-08-23T09:00:00.000Z", "fallback-id");

  assert.deepEqual(item, {
    id: "bookmark-compat",
    link: "https://example.com/article",
    title: "Article",
    description: "Description",
    note: "**Note**",
    collectionId: "collection-1",
    tags: ["reading"],
    type: "article",
    language: "zh-CN",
    favorite: true,
    reminder: "2026-08-23T09:00:00.000Z",
    cover: "https://example.com/cover.png",
    media: [{ url: "https://example.com/media.png" }],
    highlights: [{ text: "important", position: 2 }],
    health: { status: "ok", checkedAt: "2026-08-23T08:00:00.000Z", finalUrl: "https://example.com/final" },
    position: 7,
    source: "legacy-extension",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-23T08:00:00.000Z",
    revision: 4,
    deletedAt: "2026-08-23T08:30:00.000Z",
    deletedByCollectionId: "collection-1",
    purgedAt: "2026-08-23T08:30:00.000Z",
    permanentDeletedAt: "2026-08-23T08:30:00.000Z",
  });
});

test("bookmark normalization rejects unsafe links and malformed compatibility arrays", () => {
  assert.throws(() => normalizeBookmark({ link: "javascript:alert(1)" }), /HTTP\(S\)/);
  assert.throws(() => normalizeBookmark({ link: "https://example.com", media: "not-an-array" }), /媒体/);
});

test("partial health updates keep the existing final URL", () => {
  assert.deepEqual(normalizeBookmark(
    { link: "https://example.com", health: { status: "broken" } },
    { health: { status: "healthy", checkedAt: "2026-08-23T08:00:00.000Z", finalUrl: "https://example.com/final" } },
    "2026-08-23T09:00:00.000Z",
    "bookmark-health",
  ).health, { status: "broken", checkedAt: "2026-08-23T08:00:00.000Z", finalUrl: "https://example.com/final" });
});

test("custom covers stay local and validate image size/type", async () => {
  const cover = bytesToCover(new Uint8Array([1, 2, 3]), "image/png");
  const item = normalizeBookmark({ link: "https://example.com", cover }, undefined, "2026-08-12T00:00:00.000Z", "bookmark-cover");
  assert.equal(item.cover, cover);
  assert.match(item.coverRef.id, /^[0-9a-f-]{36}$/i);
  await assert.rejects(() => fileToCover({ type: "text/plain", arrayBuffer: async () => new ArrayBuffer(1) }), /请选择/);
});

test("batch transforms preserve metadata and create syncable tombstones", () => {
  const input = { id: "bookmark-1", link: "https://example.com/", title: "Example", description: "desc", note: "note", collectionId: "a", tags: ["One"], cover: "data:image/png;base64,AQ==", coverRef: { id: "cover" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", revision: 2 };
  const moved = applyBookmarkBatch(input, { type: "move", collectionId: "b" }, "2026-08-12T00:00:00.000Z");
  assert.equal(moved.collectionId, "b");
  assert.equal(moved.cover, input.cover);
  assert.deepEqual(applyBookmarkBatch(moved, { type: "tags", mode: "add", tags: ["two", "ONE"] }, "2026-08-12T00:00:01.000Z").tags, ["One", "two"]);
  const tombstone = applyBookmarkBatch(moved, { type: "permanentDelete" }, "2026-08-12T00:00:02.000Z");
  assert.equal(tombstone.permanentDeletedAt, "2026-08-12T00:00:02.000Z");
  assert.equal(tombstone.purgedAt, tombstone.permanentDeletedAt);
  assert.equal(tombstone.coverRef.id, "cover");
});

test("bookmark conflict merge selects fields independently and accepts url aliases", () => {
  const merged = mergeBookmarkConflict(
    { title: "local title", link: "https://local.example", description: "local desc", note: "local note", tags: ["one"], collectionId: "local" },
    { title: "cloud title", url: "https://cloud.example", description: "cloud desc", note: "cloud note", tags: ["two"], collectionId: "cloud" },
    { title: "cloud", link: "cloud", description: "local", note: "cloud", tags: "cloud", collectionId: "local" },
  );
  assert.deepEqual(merged, { title: "cloud title", link: "https://cloud.example", description: "local desc", note: "cloud note", tags: ["two"], collectionId: "local" });
});

test("sync leaves conflicted outbox records paused while keeping unrelated records", () => {
  const items = [{ entity: "bookmark", id: "paused" }, { entity: "bookmark", id: "continue" }, { entity: "collection", id: "continue" }];
  assert.deepEqual(filterSyncableOutbox(items, [{ entity: "bookmark", id: "paused" }]), items.slice(1));
});
