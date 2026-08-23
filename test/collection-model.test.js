import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionGroups,
  collectionShareText,
  emptyCollectionRoots,
  mergeCollectionRecords,
  positionBetween,
  validateCollectionChange,
} from "../extension/shared/collection-model.js";

const collections = [
  { id: "unsorted", name: "未分类", parentId: null, position: 0 },
  { id: "one", name: "One", parentId: null, position: 0, revision: 1 },
  { id: "two", name: "Two", parentId: null, position: 1, revision: 1 },
  { id: "child", name: "Child", parentId: "one", position: 0, revision: 1 },
];

test("collection changes reject missing parents and cycles", () => {
  assert.throws(() => validateCollectionChange(collections, { id: "one", name: "One", parentId: "missing" }), /父收藏夹不存在/);
  assert.throws(() => validateCollectionChange(collections, { id: "one", name: "One", parentId: "child" }), /子级/);
  assert.throws(() => validateCollectionChange(collections, { id: "unsorted", name: "Renamed" }, collections[0]), /不可修改/);
  assert.equal(validateCollectionChange(collections, { id: "two", name: "Renamed", parentId: null, position: 2 }).name, "Renamed");
  assert.throws(() => validateCollectionChange(collections, { id: "two", name: "Two", icon: "javascript:alert(1)" }), /图标无效/);
});

test("collection ordering uses sibling positions and empty cleanup keeps only roots", () => {
  assert.equal(positionBetween(collections, "two", "one", true), 0);
  assert.deepEqual(emptyCollectionRoots(collections, [{ id: "bookmark", collectionId: "child" }]).map((item) => item.id), ["two"]);
  assert.deepEqual(emptyCollectionRoots(collections, []).map((item) => item.id), ["one", "two"]);
});

test("collection merge moves bookmarks and children while preserving target", () => {
  const result = mergeCollectionRecords(
    collections,
    [{ id: "bookmark", collectionId: "two", title: "Keep", link: "https://example.com" }],
    ["one", "two"],
    "one",
    "2026-08-23T00:00:00.000Z",
  );
  assert.equal(result.movedBookmarks, 1);
  assert.equal(result.collections.find((item) => item.id === "child").parentId, "one");
  assert.equal(result.bookmarks[0].collectionId, "one");
  assert.equal(result.collections.find((item) => item.id === "two").deletedAt, "2026-08-23T00:00:00.000Z");
});

test("collection groups and sharing normalize preferences without dropping records", () => {
  assert.deepEqual(collectionGroups({}).map((item) => item.id), ["default"]);
  assert.equal(collectionShareText({ name: "Reading" }, [{ title: "Example", link: "https://example.com" }]), "Reading（1）\n\nExample\nhttps://example.com");
});
