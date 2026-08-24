import assert from "node:assert/strict";
import test from "node:test";
import { previewImport } from "../extension/shared/import-preview.js";

test("import preview exposes valid records, duplicates, invalid rows, and media", () => {
  const preview = previewImport("url,title\nhttps://example.com/one,One\nnot-a-url,Bad", { name: "bookmarks.csv" }, ["https://example.com/one"]);
  assert.equal(preview.format, "csv");
  assert.equal(preview.records, 1);
  assert.equal(preview.duplicates, 1);
  assert.deepEqual(preview.invalid, [{ index: 2, reason: "invalid-url", value: "not-a-url" }]);
  assert.equal(preview.media, 0);
});

test("JSON import preview supports portable backup files and preserves their collection path", () => {
  const preview = previewImport(JSON.stringify({ format: "private-bookmarks/v1", collections: [{ id: "parent", name: "Parent", parentId: null }, { id: "child", name: "Child", parentId: "parent" }], bookmarks: [{ link: "https://example.com/one", title: "One", favorite: true, collectionId: "child", media: [{ url: "data:text/plain,hi" }] }] }), { name: "backup.json" });
  assert.equal(preview.format, "json");
  assert.equal(preview.records, 1);
  assert.equal(preview.media, 1);
  assert.equal(preview.favorites, 1);
  assert.deepEqual(preview.items[0].collectionPath, ["Parent", "Child"]);
});
