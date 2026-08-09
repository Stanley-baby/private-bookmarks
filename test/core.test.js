import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, createApi } from "../src/core.js";

class MemoryStore {
  bookmarks = new Map();
  collections = new Map([["unsorted", { id: "unsorted", name: "Unsorted", parentId: null, revision: 1 }]]);
  nextId = 1;
  preferences = { theme: "auto", revision: 0 };

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

  async listBookmarks(options) {
    this.lastListBookmarksOptions = options;
    return [...this.bookmarks.values()];
  }

  async listTags(options) {
    this.lastListTagsOptions = options;
    return [];
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

  async getPreferences({ includeSecrets = false } = {}) {
    const value = { ...this.preferences };
    if (!includeSecrets) {
      value.aiApiKeyConfigured = Boolean(value.aiApiKeyEncrypted);
      delete value.aiApiKeyEncrypted;
    }
    return value;
  }

  async updatePreferences(expectedRevision, preferences) {
    if (expectedRevision !== this.preferences.revision) return { conflict: await this.getPreferences() };
    const value = { ...this.preferences, ...preferences };
    delete value.revision;
    this.preferences = { ...value, revision: expectedRevision + 1 };
    return { preferences: await this.getPreferences() };
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
    this.objects.set(key, { bytes: value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value), ...options.httpMetadata });
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.bytes,
      httpEtag: '"test-etag"',
      writeHttpMetadata(headers) {
        headers.set("content-type", object.contentType);
        if (object.contentDisposition) headers.set("content-disposition", object.contentDisposition);
      },
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

test("AI recommendations return confirmed metadata without exposing provider details", async () => {
  let prompt;
  const api = createApi({
    key: "test-key",
    store: new MemoryStore(),
    ai: {
      async run(model, input) {
        assert.equal(model, "test-model");
        prompt = input.messages[1].content;
        return { response: '{"collectionId":"frontend","tags":["React","performance"],"note":"关于 React 性能优化的参考资料。"}' };
      },
    },
    aiModel: "test-model",
  });
  const response = await api.fetch(request("/v1/ai/recommendations", {
    method: "POST",
    body: JSON.stringify({
      link: "https://example.com/react?utm_source=test",
      title: "React performance",
      collections: [{ id: "frontend", name: "前端" }],
      context: [{ title: "React rendering", collectionId: "frontend", tags: ["React"] }],
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    collectionId: "frontend",
    tags: ["React", "performance"],
    note: "关于 React 性能优化的参考资料。",
  });
  assert.match(prompt, /React performance/);
});

test("AI recommendations report an unavailable optional binding", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const response = await api.fetch(request("/v1/ai/recommendations", { method: "POST", body: JSON.stringify({ link: "https://example.com" }) }));
  assert.equal(response.status, 501);
  assert.equal((await response.json()).code, "ai_not_configured");
});

test("AI settings select an external provider, encrypt its key, and keep the default prompt contract", async () => {
  let externalRequest;
  const store = new MemoryStore();
  const api = createApi({
    key: "test-key",
    store,
    aiModel: "test-model",
    fetchImpl: async (url, init) => {
      externalRequest = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"collectionId":null,"tags":["reading"],"note":"待阅读。"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const saved = await api.fetch(request("/v1/ai/settings", {
    method: "PATCH",
    body: JSON.stringify({ revision: 0, settings: { provider: "openai", baseUrl: "https://api.example/v1", externalModel: "demo-model", prompt: "请用简洁中文整理。" }, apiKey: "secret-key" }),
  }));

  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.ai.provider, "openai");
  assert.equal(savedBody.ai.apiKeyConfigured, true);
  assert.equal(savedBody.preferences.aiApiKeyEncrypted, undefined);
  assert.notEqual(store.preferences.aiApiKeyEncrypted, "secret-key");

  const response = await api.fetch(request("/v1/ai/recommendations", {
    method: "POST",
    body: JSON.stringify({ link: "https://example.com/read", title: "Reading list" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { collectionId: null, tags: ["reading"], note: "待阅读。" });
  assert.equal(externalRequest.url, "https://api.example/v1/chat/completions");
  assert.equal(externalRequest.init.headers.authorization, "Bearer secret-key");
  const payload = JSON.parse(externalRequest.init.body);
  assert.equal(payload.model, "demo-model");
  assert.match(payload.messages[0].content, /请用简洁中文整理/);
  assert.match(payload.messages[0].content, /只返回 JSON/);
});

test("bookmark API creates a bookmark and rejects stale updates", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const created = await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify({
      link: "https://example.com/?utm_campaign=spring",
      language: "zh-CN",
      title: "Example",
      collectionId: "unsorted",
    }),
  }));

  assert.equal(created.status, 201);
  const bookmark = await created.json();
  assert.equal(bookmark.link, "https://example.com/");
  assert.equal(bookmark.language, "zh");
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

test("bookmark reminders are normalized and invalid dates are rejected", async () => {
  const api = createApi({ key: "test-key", store: new MemoryStore() });
  const created = await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify({ link: "https://example.com/reminder", type: "article", reminder: "2026-08-08T17:00:00+08:00" }),
  }));
  const bookmark = await created.json();
  assert.equal(bookmark.reminder, "2026-08-08T09:00:00.000Z");
  assert.equal(bookmark.type, "article");

  const invalid = await api.fetch(request("/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify({ link: "https://example.com/invalid", reminder: "tomorrow maybe" }),
  }));
  assert.equal(invalid.status, 400);
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

test("bookmark and tag list APIs forward reference sorting options", async () => {
  const store = new MemoryStore();
  const api = createApi({ key: "test-key", store });

  const bookmarks = await api.fetch(request("/v1/bookmarks?search=alpha&sort=score"));
  assert.equal(bookmarks.status, 200);
  assert.deepEqual(store.lastListBookmarksOptions, { collectionId: null, view: null, search: "alpha", sort: "score" });

  const tags = await api.fetch(request("/v1/tags?tagsSort=-count"));
  assert.equal(tags.status, 200);
  assert.deepEqual(await tags.json(), []);
  assert.deepEqual(store.lastListTagsOptions, { collectionId: null, view: null, search: null, sort: "-count" });

  store.getPreferences = async () => ({ nestedViewLegacy: true });
  await api.fetch(request("/v1/bookmarks?collection=collection-1"));
  assert.deepEqual(store.lastListBookmarksOptions, { collectionId: "collection-1", view: null, search: null, sort: null, nestedViewLegacy: true });
  await api.fetch(request("/v1/tags?collection=collection-1"));
  assert.deepEqual(store.lastListTagsOptions, { collectionId: "collection-1", view: null, search: null, sort: "_id", nestedViewLegacy: true });
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

test("media API accepts ENEX attachments and stable IDs for retries", async () => {
  const bucket = new MemoryBucket();
  const api = createApi({ key: "test-key", store: new MemoryStore(), mediaBucket: bucket });
  const id = "22222222-2222-4222-8222-222222222222";
  const headers = {
    "content-type": "text/plain",
    "x-private-bookmarks-kind": "attachment",
    "x-private-bookmarks-name": encodeURIComponent("说明.txt"),
    "x-private-bookmarks-id": id,
  };
  const first = await api.fetch(request("/v1/media", { method: "POST", headers, body: "first" }));
  assert.equal(first.status, 201);
  assert.equal((await first.json()).id, id);
  const second = await api.fetch(request("/v1/media", { method: "POST", headers, body: "second" }));
  assert.equal(second.status, 201);
  const uploaded = await second.json();
  assert.equal(uploaded.id, id);
  assert.equal(bucket.objects.size, 1);
  const served = await api.fetch(new Request(uploaded.url));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-disposition"), "attachment; filename*=UTF-8''%E8%AF%B4%E6%98%8E.txt");
  assert.equal(await served.text(), "second");

  const options = await api.fetch(new Request("https://private-bookmarks.test/v1/media", { method: "OPTIONS" }));
  assert.match(options.headers.get("access-control-allow-headers"), /x-private-bookmarks-id/);
});
