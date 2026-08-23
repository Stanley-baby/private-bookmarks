import assert from "node:assert/strict";
import test from "node:test";
import { collectionPath, descendantCollectionIds, flattenCollections } from "../src/react/collection-navigation.js";
import { libraryRouteHref, navigateLibraryRoute, readLibraryRoute } from "../src/react/library-route.js";
import { classifyLibraryError, loadErrorMessage } from "../src/react/library-status.js";

const collections = [
  { id: "1", name: "Reading", parentId: null, position: 0 },
  { id: "22", name: "Work", parentId: "1", position: 0 },
  { id: "33", name: "React", parentId: "22", position: 0 },
];

test("library routes round-trip collection, filter, and trash state", () => {
  const route = readLibraryRoute("https://example.test/library.html?collection=22&search=react%20hooks&tag=frontend");
  assert.deepEqual(route, { view: "all", collectionId: "22", query: "react hooks", tag: "frontend" });
  assert.equal(libraryRouteHref(route, "https://example.test/library.html?settings=ai"), "/library.html?settings=ai&collection=22&search=react+hooks&tag=frontend");
  assert.deepEqual(readLibraryRoute("https://example.test/library.html?view=trash"), { view: "trash", collectionId: null, query: "", tag: "" });
});

test("collection navigation keeps nested paths and descendant scope", () => {
  assert.deepEqual(flattenCollections(collections).map(({ collection, depth }) => [collection.id, depth]), [["1", 0], ["22", 1], ["33", 2]]);
  assert.deepEqual(flattenCollections(collections, new Set(["22"])).map(({ collection, depth }) => [collection.id, depth]), [["1", 0], ["22", 1]]);
  assert.deepEqual([...descendantCollectionIds(collections, "1")], ["1", "22", "33"]);
  assert.deepEqual([...descendantCollectionIds([...collections].reverse(), "1")].sort(), ["1", "22", "33"]);
  assert.equal(collectionPath(collections, "33"), "Reading / Work / React");
});

test("navigation uses history state without document navigation", () => {
  const calls = [];
  const target = { pushState: (...args) => calls.push(args) };
  const href = navigateLibraryRoute({ view: "all", collectionId: "33", query: "", tag: "" }, "push", target, "https://example.test/library.html");
  assert.equal(href, "/library.html?collection=33");
  assert.deepEqual(calls, [[{}, "", "/library.html?collection=33"]]);
});

test("library load states distinguish permission denial from ordinary errors", () => {
  assert.equal(classifyLibraryError({ code: "permission_denied" }), "permission-denied");
  assert.equal(classifyLibraryError(new DOMException("The user denied permission", "NotAllowedError")), "permission-denied");
  assert.equal(classifyLibraryError(new Error("database unavailable")), "error");
  assert.equal(loadErrorMessage({ code: "permission_denied" }), "未获得必要权限，请允许后重试。");
  assert.equal(loadErrorMessage(new Error("database unavailable")), "database unavailable");
});
