import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, createApi } from "../src/core.js";

class MemoryStore {
  bookmarks = new Map();
  collections = new Map([["unsorted", { id: "unsorted", name: "Unsorted", parentId: null, revision: 1 }]]);
  nextId = 1;

  async createBookmark(bookmark) {
    const saved = { ...bookmark, id: String(this.nextId++), revision: 1 };
    this.bookmarks.set(saved.id, saved);
    return saved;
  }

  async getBookmark(id) {
    return this.bookmarks.get(id) ?? null;
  }

  async getBookmarksByLink(link) {
    return [...this.bookmarks.values()].filter((bookmark) => bookmark.link === link);
  }

  async updateBookmark(id, expectedRevision, changes) {
    const current = await this.getBookmark(id);
    if (!current) return { missing: true };
    if (current.revision !== expectedRevision) return { conflict: current };

    const saved = { ...current, ...changes, revision: current.revision + 1 };
    this.bookmarks.set(id, saved);
    return { bookmark: saved };
  }

  async listCollections() {
    return [...this.collections.values()];
  }

  async listCollectionCounts() {
    return Object.fromEntries([...this.collections.keys()].map((id) => [id, [...this.bookmarks.values()].filter((bookmark) => bookmark.collectionId === id).length]));
  }

  async getTrashCount() {
    return 0;
  }

  async createCollection({ name, parentId = null }) {
    const saved = { id: `collection-${this.collections.size}`, name, parentId, revision: 1 };
    this.collections.set(saved.id, saved);
    return saved;
  }

  async getPreferences() {
    return { theme: "auto", revision: 0 };
  }

  async batchBookmarks(items, action) {
    const current = items.map(({ id }) => this.bookmarks.get(id));
    if (current.some((item, index) => !item || item.revision !== items[index].revision)) return { conflict: true };
    const bookmarks = current.map((item) => ({ ...item, favorite: action.favorite, revision: item.revision + 1 }));
    bookmarks.forEach((item) => this.bookmarks.set(item.id, item));
    return { bookmarks };
  }

  async exportData() {
    return { format: "private-bookmarks/v1", bookmarks: [...this.bookmarks.values()] };
  }
}

class MemoryBucket {
  objects = new Map();

  async put(key, value, options) {
    this.objects.set(key, { bytes: value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value), contentType: options.httpMetadata.contentType });
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.bytes,
      httpEtag: '"test-etag"',
      writeHttpMetadata(headers) { headers.set("content-type", object.contentType); },
    };
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

test("canonicalizeUrl removes tracking parameters and normalizes path/query order", () => {
  assert.equal(
    canonicalizeUrl("https://user:pass@example.com/articles/?z=2&utm_source=newsletter&a=1#:~:text=clip"),
    "https://example.com/articles?a=1&z=2",
  );
});

test("bookmark API creates a bookmark and rejects stale updates", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const created = await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify({
      link: "https://example.com/?utm_campaign=spring",
      title: "Example",
      collectionId: "unsorted",
    }),
  }));

  assert.equal(created.status, 201);
  const bookmark = await created.json();
  assert.equal(bookmark.link, "https://example.com/");
  assert.equal(bookmark.revision, 1);

  const updated = await api.fetch(request(`/v1/bookmarks/${bookmark.id}`, {
    method: "PATCH",
    body: JSON.stringify({ revision: 1, note: "Read later" }),
  }));
  assert.equal(updated.status, 200);

  const stale = await api.fetch(request(`/v1/bookmarks/${bookmark.id}`, {
    method: "PATCH",
    body: JSON.stringify({ revision: 1, note: "Stale edit" }),
  }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "editing_conflict");

  const forced = await api.fetch(request(`/v1/bookmarks/${bookmark.id}`, {
    method: "PATCH",
    body: JSON.stringify({ revision: 1, note: "Owner override", force: true }),
  }));
  assert.equal(forced.status, 200);
  assert.equal((await forced.json()).note, "Owner override");
});

test("bookmarks by link keeps duplicate URLs distinct", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  for (const title of ["First", "Second"]) await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify({ link: "https://example.com/article", title, collectionId: "unsorted" }),
  }));

  const response = await api.fetch(request("/v1/bookmarks/by-link?link=https%3A%2F%2Fexample.com%2Farticle"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((bookmark) => bookmark.title), ["First", "Second"]);
});

test("collection API creates nested collections and bootstrap returns preferences", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const created = await api.fetch(request("/v1/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Reading", parentId: "unsorted" }),
  }));

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    id: "collection-1",
    name: "Reading",
    parentId: "unsorted",
    revision: 1,
  });

  const bootstrap = await api.fetch(request("/v1/bootstrap"));
  assert.equal(bootstrap.status, 200);
  const data = await bootstrap.json();
  assert.equal(data.preferences.theme, "auto");
  assert.deepEqual(data.collectionCounts, { unsorted: 0, "collection-1": 0 });
  assert.equal(data.trashCount, 0);
});

test("batch API changes every bookmark or reports one conflict", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const create = (link) => api.fetch(request("/v1/bookmarks", { method: "POST", body: JSON.stringify({ link, collectionId: "unsorted" }) }));
  const first = await (await create("https://example.com/one")).json();
  const second = await (await create("https://example.com/two")).json();

  const changed = await api.fetch(request("/v1/bookmarks/batch", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: first.id, revision: 1 }, { id: second.id, revision: 1 }], action: { type: "favorite", favorite: true } }),
  }));

  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).bookmarks.every((item) => item.favorite), true);
});

test("export API returns a portable backup", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const response = await api.fetch(request("/v1/export"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).format, "private-bookmarks/v1");
});

test("media API stores validated images and serves them with a signed URL", async () => {
  const bucket = new MemoryBucket();
  const api = createApi({ key: "test-key", store: new MemoryStore(), mediaBucket: bucket });
  const upload = await api.fetch(request("/v1/media", {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array([137, 80, 78, 71]),
  }));
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  const image = await api.fetch(new Request(uploaded.url));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [137, 80, 78, 71]);

  const invalid = await api.fetch(request("/v1/media", { method: "POST", headers: { "content-type": "text/plain" }, body: "not an image" }));
  assert.equal(invalid.status, 400);
});
