import assert from "node:assert/strict";
import test from "node:test";
import { recommendBookmark } from "../extension/recommendations.js";

test("recommendations reuse similar bookmarks' collection and tags", () => {
  const result = recommendBookmark(
    { link: "https://docs.example.test/react-performance", title: "React performance guide" },
    [
      { link: "https://react.dev/learn", title: "React performance patterns", description: "Rendering and performance", collectionId: "frontend", tags: ["React", "performance"] },
      { link: "https://example.test/cooking", title: "Pasta recipe", collectionId: "cooking", tags: ["recipe"] },
    ],
    [{ id: "frontend" }, { id: "cooking" }],
  );

  assert.equal(result.collectionId, "frontend");
  assert.deepEqual(result.tags, ["performance", "React"]);
  assert.equal(result.matches[0].collectionId, "frontend");
});

test("recommendations do not invent a collection or repeat current tags", () => {
  const result = recommendBookmark(
    { link: "https://example.test/new", title: "Unrelated note", tags: ["Existing"] },
    [{ link: "https://example.test/other", title: "Other", collectionId: "missing", tags: ["Existing"] }],
    [],
  );

  assert.equal(result.collectionId, null);
  assert.deepEqual(result.tags, []);
});

test("recommendations exclude the bookmark currently being edited", () => {
  const current = {
    id: "current",
    link: "https://docs.example.test/react-performance",
    title: "React performance guide",
    collectionId: "frontend",
    tags: ["React", "performance"],
  };
  const related = {
    id: "related",
    link: "https://react.dev/learn/performance",
    title: "React performance patterns",
    description: "Rendering and performance",
    collectionId: "frontend",
    tags: ["React", "performance", "reading"],
  };

  const result = recommendBookmark(current, [current, related], [{ id: "frontend" }], current.id);

  assert.deepEqual(result.matches.map(({ link }) => link), [related.link]);
  assert.deepEqual(result.tags, ["reading"]);
});
