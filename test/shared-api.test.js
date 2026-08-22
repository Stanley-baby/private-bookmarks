import assert from "node:assert/strict";
import test from "node:test";
import { createLocalApi } from "../extension/shared/local-api.js";
import { createWorkerClient } from "../extension/shared/worker-client.js";

function localFixture() {
  const bookmarks = new Map();
  const collections = new Map([["unsorted", { id: "unsorted", name: "未分类", parentId: null }]]);
  return {
    async ensureDefaults() {},
    async listBookmarks({ trash = false } = {}) {
      return [...bookmarks.values()].filter((item) => trash ? item.deletedAt : !item.deletedAt);
    },
    async listCollections({ trash = false } = {}) { return [...collections.values()].filter((item) => trash ? item.deletedAt : !item.deletedAt); },
    async getPreferences() { return { nestedViewLegacy: false, revision: 0 }; },
    async saveBookmark(input) {
      const current = input.id ? bookmarks.get(input.id) : null;
      const item = { ...current, ...input, id: input.id || "bookmark-1", title: input.title || current?.title || input.link, link: new URL(input.link || current?.link).href, collectionId: input.collectionId || current?.collectionId || "unsorted", tags: input.tags || current?.tags || [], updatedAt: "2026-08-22T00:00:00.000Z" };
      bookmarks.set(item.id, item);
      return item;
    },
    async saveCollection(input) {
      const item = { id: input.id || "collection-1", name: input.name, parentId: input.parentId || null };
      collections.set(item.id, item);
      return item;
    },
    async importLibrary(data) {
      for (const item of data.bookmarks || data.items || []) await this.saveBookmark(item);
      return { bookmarks: (data.bookmarks || data.items || []).length, collections: 0 };
    },
    async exportLibrary() { return { format: "private-bookmarks/v1", bookmarks: [...bookmarks.values()], collections: [...collections.values()] }; },
    async replaceLibrary(data) { bookmarks.clear(); return this.importLibrary(data); },
    async trashBookmark(id) { const item = bookmarks.get(id); if (item) item.deletedAt = "2026-08-22T00:00:01.000Z"; return item || null; },
    async restoreBookmark(id) { const item = bookmarks.get(id); if (item) delete item.deletedAt; return item || null; },
    async batchBookmarks(ids, action) { return { bookmarks: ids.map((id) => bookmarks.get(id)).filter(Boolean).map((item) => ({ ...item, ...action })) }; },
    async trashCollection(id) { const item = collections.get(id); if (item) item.deletedAt = "2026-08-22T00:00:01.000Z"; return item || null; },
    async restoreCollection(id) { const item = collections.get(id); if (item) delete item.deletedAt; return item || null; },
    async updatePreferences() { return { preferences: { revision: 1 } }; },
  };
}

test("local API keeps CRUD, import, restore, and local error semantics without a Worker", async () => {
  const local = createLocalApi({ db: localFixture() });
  assert.deepEqual(await local.health(), { ok: true });
  const created = await local.createBookmark({ link: "https://example.com", title: "Example" });
  assert.equal(created.link, "https://example.com/");
  assert.equal((await local.updateBookmark(created.id, { title: "Updated" })).title, "Updated");
  assert.equal((await local.search("Updated"))[0].id, created.id);
  assert.equal((await local.trashBookmark(created.id)).deletedAt, "2026-08-22T00:00:01.000Z");
  assert.equal((await local.restoreBookmark(created.id)).deletedAt, undefined);
  assert.deepEqual(await local.importLibrary({ items: [{ link: "https://example.com/imported" }] }), { bookmarks: 1, collections: 0 });
  const collection = await local.createCollection({ name: "Reading" });
  assert.equal((await local.updateCollection(collection.id, { name: "Read later" })).name, "Read later");
  assert.equal((await local.getCollection(collection.id)).name, "Read later");
  await local.deleteCollection(collection.id);
  await local.restoreCollection(collection.id);
  assert.equal((await local.getCollection(collection.id)).deletedAt, undefined);
  await assert.rejects(() => local.importLibrary({ items: [] }), (error) => error.status === 400 && error.code === "invalid_import");
  await assert.rejects(() => local.restoreLibrary({ confirm: false, backup: {} }), (error) => error.status === 400 && error.code === "invalid_backup");
  assert.deepEqual(await local.restoreLibrary({ confirm: true, backup: { format: "private-bookmarks/v1", bookmarks: [] } }), { ok: true });
});

function storageFixture() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); },
    async remove(key) { values.delete(key); },
    values,
  };
}

test("Worker client exposes connection, health, search, sync, and media contracts", async () => {
  const storage = storageFixture();
  const requests = [];
  const client = createWorkerClient({
    storage,
    permissions: { async request() { return true; } },
    fetchImpl: async (url, init = {}) => {
      requests.push([url, init]);
      if (url.endsWith("/v1/health")) return Response.json({ ok: true });
      if (url.includes("/v1/bookmarks?")) return Response.json([{ id: "bookmark-1", title: "Found" }]);
      if (url.endsWith("/v1/sync/pull?cursor=c1&limit=20")) return Response.json({ changes: [], cursor: "c2", hasMore: false });
      if (url.endsWith("/v1/sync/push")) return Response.json({ applied: [], conflicts: [] });
      if (url.endsWith("/v1/media")) return Response.json({ id: "media-1", url: "https://worker.example/v1/media/media-1", size: 3 });
      return Response.json({ ok: true });
    },
  });

  assert.deepEqual(await client.connect("https://worker.example/path", "secret"), { endpoint: "https://worker.example", key: "secret" });
  assert.deepEqual(await client.health(), { ok: true });
  assert.deepEqual(await client.search("Found"), [{ id: "bookmark-1", title: "Found" }]);
  assert.deepEqual(await client.sync.pull({ cursor: "c1", limit: 20 }), { changes: [], cursor: "c2", hasMore: false });
  assert.deepEqual(await client.sync.push([{ entity: "bookmark", id: "bookmark-1" }]), { applied: [], conflicts: [] });
  assert.equal((await client.media.upload(new Uint8Array([1, 2, 3]), "image/png")).id, "media-1");
  assert.match(requests.at(-1)[1].headers["content-type"], /image\/png/);
});

test("Worker client distinguishes unconfigured, permission, network, and server failures", async () => {
  const unconfigured = createWorkerClient({ storage: storageFixture(), fetchImpl: async () => Response.json({ ok: true }) });
  await assert.rejects(() => unconfigured.health(), (error) => error.code === "not_configured");

  let fetchCalls = 0;
  const configuredStorage = Object.assign(storageFixture(), { async get() { return { endpoint: "https://worker.example", key: "secret" }; } });
  const sameOrigin = createWorkerClient({ storage: configuredStorage, fetchImpl: async () => { fetchCalls += 1; return Response.json({ ok: true }); } });
  await assert.rejects(() => sameOrigin.request("https://attacker.example/v1/health"), (error) => error.code === "invalid_path");
  assert.equal(fetchCalls, 0);

  const deniedStorage = storageFixture();
  const denied = createWorkerClient({ storage: deniedStorage, permissions: { async request() { return false; } }, fetchImpl: async () => Response.json({ ok: true }) });
  await assert.rejects(() => denied.connect("https://worker.example", "secret"), (error) => error.code === "permission_denied");
  assert.equal(deniedStorage.values.size, 0);

  const network = createWorkerClient({ storage: Object.assign(storageFixture(), { async get() { return { endpoint: "https://worker.example", key: "secret" }; } }), fetchImpl: async () => { throw new Error("offline"); } });
  await assert.rejects(() => network.health(), (error) => error.code === "network_error");

  const server = createWorkerClient({ storage: Object.assign(storageFixture(), { async get() { return { endpoint: "https://worker.example", key: "secret" }; } }), fetchImpl: async () => new Response(JSON.stringify({ code: "service_down", message: "Worker unavailable" }), { status: 503, headers: { "content-type": "application/json" } }) });
  await assert.rejects(() => server.health(), (error) => error.status === 503 && error.code === "service_down" && error.message === "Worker unavailable");
});

test("Worker client uses the background connection when the primary key is absent", async () => {
  const storage = storageFixture();
  storage.values.set("instanceConnectionBackground", { endpoint: "https://background.example", key: "background-secret" });
  const requests = [];
  const client = createWorkerClient({
    storage,
    fetchImpl: async (url, init = {}) => {
      requests.push([url, init]);
      return url.endsWith("/v1/health")
        ? Response.json({ ok: true })
        : Response.json({ changes: [], cursor: "c2", hasMore: false });
    },
  });

  assert.deepEqual(await client.health(), { ok: true });
  assert.deepEqual(await client.sync.pull({ cursor: "c1", limit: 20 }), { changes: [], cursor: "c2", hasMore: false });
  assert.equal(storage.values.has("instanceConnection"), false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0][0], "https://background.example/v1/health");
  assert.equal(requests[1][0], "https://background.example/v1/sync/pull?cursor=c1&limit=20");
  assert.equal(requests[0][1].headers["x-private-bookmarks-key"], "background-secret");
  assert.equal(requests[1][1].headers["x-private-bookmarks-key"], "background-secret");
});

test("Worker client rejects connection mutation while the background connection exists", async () => {
  const storage = storageFixture();
  const background = { endpoint: "https://background.example", key: "background-secret" };
  storage.values.set("instanceConnectionBackground", background);
  let permissionRequests = 0;
  let fetchCalls = 0;
  const client = createWorkerClient({
    storage,
    permissions: { async request() { permissionRequests += 1; return true; } },
    fetchImpl: async () => { fetchCalls += 1; return Response.json({ ok: true }); },
  });

  await assert.rejects(() => client.connect("https://next.example", "new-secret"), (error) => error.status === 423 && error.code === "connection_locked");
  assert.equal(permissionRequests, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(storage.values.has("instanceConnection"), false);
  assert.deepEqual(storage.values.get("instanceConnectionBackground"), background);
  await assert.rejects(() => client.disconnect(), (error) => error.status === 423 && error.code === "connection_locked");
  assert.deepEqual(storage.values.get("instanceConnectionBackground"), background);
});

test("Worker client disconnect removes an ordinary primary connection", async () => {
  const storage = storageFixture();
  const primary = { endpoint: "https://worker.example", key: "secret" };
  storage.values.set("instanceConnection", primary);
  const client = createWorkerClient({ storage });

  await client.disconnect();
  assert.equal(await client.connection(), null);
  await assert.rejects(() => client.health(), (error) => error.status === 503 && error.code === "not_configured");
});
