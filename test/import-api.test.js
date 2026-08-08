import assert from "node:assert/strict";
import test from "node:test";
import { createApi, MAX_IMPORT_ITEMS } from "../src/core.js";

class MemoryStore {
  constructor() {
    this.collections = new Map([["unsorted", { id: "unsorted", deletedAt: null }]]);
    this.bookmarks = [];
    this.importCalls = 0;
    this.restoreCalls = 0;
  }

  async getCollection(id) {
    return this.collections.get(id) || null;
  }

  async createBookmark(item) {
    const bookmark = { ...item, id: `bookmark-${this.bookmarks.length + 1}`, revision: 1 };
    this.bookmarks.push(bookmark);
    return bookmark;
  }

  async importBookmarks(items) {
    this.importCalls += 1;
    if (items.some((item) => !this.collections.has(item.collectionId))) throw new TypeError("Collection not found");
    const bookmarks = items.map((item, index) => ({ ...item, id: `import-${this.bookmarks.length + index + 1}`, revision: 1 }));
    this.bookmarks.push(...bookmarks);
    return { bookmarks };
  }

  async replaceData() {
    this.restoreCalls += 1;
  }
}

function request(path, init = {}) {
  return new Request(`https://private-bookmarks.test${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-private-bookmarks-key": "test-key",
      ...init.headers,
    },
  });
}

function item(link, overrides = {}) {
  return { link, collectionId: "unsorted", ...overrides };
}

test("import API normalizes items and uses one bulk store call", async () => {
  const store = new MemoryStore();
  const api = createApi({ key: "test-key", store });
  const response = await api.fetch(request("/v1/import", {
    method: "POST",
    body: JSON.stringify({ items: [
      item("https://example.com/a?utm_source=test", { title: "  Alpha  ", tags: ["Read", "read", "Beta"], language: "zh-CN", createdAt: "2024-01-02T03:04:05.000Z" }),
      item("https://example.com/b", { type: "article" }),
    ] }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 2 });
  assert.equal(store.importCalls, 1);
  assert.equal(store.bookmarks[0].link, "https://example.com/a");
  assert.equal(store.bookmarks[0].title, "Alpha");
  assert.deepEqual(store.bookmarks[0].tags, ["Read", "Beta"]);
  assert.equal(store.bookmarks[0].language, "zh");
  assert.equal(store.bookmarks[0].createdAt, "2024-01-02T03:04:05.000Z");
});

test("import API rejects malformed items and unknown collections atomically", async () => {
  const store = new MemoryStore();
  const api = createApi({ key: "test-key", store });

  const malformed = await api.fetch(request("/v1/import", {
    method: "POST",
    body: JSON.stringify({ items: [item("not-a-url")] }),
  }));
  assert.equal(malformed.status, 400);
  assert.equal(store.bookmarks.length, 0);

  const unknownCollection = await api.fetch(request("/v1/import", {
    method: "POST",
    body: JSON.stringify({ items: [item("https://example.com/missing", { collectionId: "missing" })] }),
  }));
  assert.equal(unknownCollection.status, 400);
  assert.equal(store.bookmarks.length, 0);
});

test("import API enforces non-empty and bounded batches", async () => {
  const store = new MemoryStore();
  const api = createApi({ key: "test-key", store });

  const empty = await api.fetch(request("/v1/import", { method: "POST", body: JSON.stringify({ items: [] }) }));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "invalid_import");

  const oversized = await api.fetch(request("/v1/import", {
    method: "POST",
    body: JSON.stringify({ items: Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, index) => item(`https://example.com/${index}`)) }),
  }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "import_too_large");
  assert.equal(store.importCalls, 0);
});

test("single create and restore routes keep their existing behavior", async () => {
  const store = new MemoryStore();
  const api = createApi({ key: "test-key", store });

  const created = await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify(item("https://example.com/single", { title: "Single" })),
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).title, "Single");

  const restored = await api.fetch(request("/v1/restore", {
    method: "POST",
    body: JSON.stringify({ confirm: true, backup: { format: "private-bookmarks/v1", collections: [], bookmarks: [] } }),
  }));
  assert.equal(restored.status, 200);
  assert.equal(store.restoreCalls, 1);
});
