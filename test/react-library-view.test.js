import assert from "node:assert/strict";
import test from "node:test";
import { filterBookmarks, reorderVisibleIds, searchSuggestions, sortBookmarks, visibleSelection } from "../src/react/library-view.js";

const bookmark = (id, changes = {}) => ({
  id,
  link: `https://example.com/${id}`,
  title: id,
  description: "",
  note: "",
  tags: [],
  highlights: [],
  favorite: false,
  reminder: "",
  health: { status: "unknown" },
  collectionId: "unsorted",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...changes,
});

test("React library composes full text, advanced syntax, quick filters, and collection scope", () => {
  const items = [
    bookmark("guide", { title: "React guide", type: "document", language: "zh-CN", tags: ["work"], collectionId: "child" }),
    bookmark("later", { title: "React later", type: "document", language: "zh", tags: ["later"], collectionId: "child" }),
    bookmark("outside", { title: "React guide", type: "document", language: "zh", tags: ["work"], collectionId: "other" }),
  ];
  const result = filterBookmarks(items, {
    query: "React type:document lang:zh -#later created:2026-08",
    tag: "work",
    scope: new Set(["parent", "child"]),
  });
  assert.deepEqual(result.map((item) => item.id), ["guide"]);
});

test("search suggestions combine history and predictable syntax choices", () => {
  assert.deepEqual(searchSuggestions("ty", ["old query", "type:image"]), ["type:image", "type:"]);
  assert.deepEqual(searchSuggestions("", ["latest", "older"]), ["latest", "older"]);
});

test("sorting and selection operate only on currently visible records", () => {
  const items = [bookmark("b", { title: "Beta", createdAt: "2026-08-02" }), bookmark("a", { title: "Alpha", createdAt: "2026-08-01" })];
  assert.deepEqual(sortBookmarks(items, "title").map((item) => item.id), ["a", "b"]);
  assert.deepEqual(sortBookmarks(items, "-created").map((item) => item.id), ["b", "a"]);
  assert.deepEqual(sortBookmarks(items, "manual", ["a", "b"]).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(reorderVisibleIds(["hidden", "a", "b"], ["a", "b"], "b", -1), ["hidden", "b", "a"]);
  assert.deepEqual(sortBookmarks(items, "unsupported").map((item) => item.id), ["b", "a"]);
  assert.deepEqual(visibleSelection(["a", "hidden"], items).sort(), ["a"]);
});
