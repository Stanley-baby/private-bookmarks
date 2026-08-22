import assert from "node:assert/strict";
import test from "node:test";
import { applyBookmarkBatch, normalizeBookmark, bytesToCover, fileToCover, filterSyncableOutbox, mergeBookmarkConflict } from "../src/local/model.js";

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
