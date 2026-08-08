import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/core.js";
import { runScheduledTasks } from "../worker.js";

const KEY = "test-key";
const BACKUP_ID = "11111111-1111-4111-8111-111111111111";

class MemoryBucket {
  objects = new Map();

  async put(key, value, options = {}) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new TextEncoder().encode(String(value));
    this.objects.set(key, { bytes: new Uint8Array(bytes), ...options.httpMetadata });
  }

  async get(key) {
    const item = this.objects.get(key);
    return item ? { body: item.bytes } : null;
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

class MemoryStore {
  backups = new Map();
  restored = null;
  purgeCalls = 0;
  healthCalls = 0;

  async exportData() {
    return {
      format: "private-bookmarks/v1",
      exportedAt: "2026-08-08T00:00:00.000Z",
      collections: [{ id: "unsorted", parentId: null, name: "Unsorted", position: 0, revision: 1 }],
      bookmarks: [{ id: "bookmark-1", link: "https://example.com", collectionId: "unsorted", title: "Example" }],
      preferences: {},
    };
  }

  async createBackup(input) {
    const metadata = {
      id: input.id,
      kind: input.kind || "manual",
      includeMedia: Boolean(input.includeMedia),
      mediaCopied: Boolean(input.mediaCopied),
      mediaCount: input.mediaCount || 0,
      libraryBytes: input.libraryBytes || 0,
      librarySha256: input.librarySha256 || "",
      manifestSha256: input.manifestSha256 || "",
      createdAt: input.createdAt,
    };
    this.backups.set(metadata.id, metadata);
    return metadata;
  }

  async getBackup(id) {
    return this.backups.get(id) || null;
  }

  async listBackups({ kind = null } = {}) {
    return [...this.backups.values()]
      .filter((item) => !kind || item.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteBackup(id) {
    return this.backups.delete(id);
  }

  async replaceData(backup) {
    this.restored = backup;
  }

  async getPreferences() {
    this.healthCalls += 1;
    return { brokenLevel: "off" };
  }

  async healthCandidates() {
    return [];
  }

  async purgeTrash() {
    this.purgeCalls += 1;
  }
}

class CloudMemoryStore extends MemoryStore {
  connections = new Map();

  async saveCloudConnection(connection) {
    const saved = { ...connection, connectedAt: connection.connectedAt || new Date().toISOString() };
    this.connections.set(connection.provider, saved);
    return saved;
  }

  async getCloudConnection(provider) {
    return this.connections.get(provider) || null;
  }

  async listCloudConnections() {
    return [...this.connections.values()];
  }

  async deleteCloudConnection(provider) {
    return this.connections.delete(provider);
  }
}

function request(path, init = {}) {
  return new Request(`https://private-bookmarks.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-private-bookmarks-key": KEY, ...init.headers },
  });
}

test("backup routes require auth and create/list/download metadata", async () => {
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const api = createApi({ key: KEY, store, backupBucket: bucket });
  const unauthorized = await api.fetch(new Request("https://private-bookmarks.test/v1/backups", { method: "GET" }));
  assert.equal(unauthorized.status, 401);

  const created = await api.fetch(request("/v1/backups", { method: "POST", body: JSON.stringify({ includeMedia: false }) }));
  assert.equal(created.status, 201);
  const metadata = await created.json();
  assert.equal(metadata.includeMedia, false);
  assert.equal(metadata.mediaCopied, false);
  assert.match(metadata.librarySha256, /^[0-9a-f]{64}$/);
  assert.equal(bucket.objects.size, 2);

  const listed = await api.fetch(request("/v1/backups"));
  assert.deepEqual((await listed.json()).map((item) => item.id), [metadata.id]);
  const downloaded = await api.fetch(request(`/v1/backups/${metadata.id}/download`));
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  const payload = await downloaded.json();
  assert.equal(payload.backup.format, "private-bookmarks/v1");
  assert.equal(payload.manifest.backupId, metadata.id);
});

test("media backups copy, archive, and restore instance media", async () => {
  const mediaId = "22222222-2222-4222-8222-222222222222";
  const store = new MemoryStore();
  store.exportData = async () => ({
    format: "private-bookmarks/v1",
    collections: [{ id: "unsorted", parentId: null, name: "Unsorted", position: 0, revision: 1 }],
    bookmarks: [{ id: "bookmark-1", link: "https://example.com", collectionId: "unsorted", title: "Example", cover: `https://private-bookmarks.test/v1/media/${mediaId}?token=test`, media: [] }],
    preferences: {},
  });
  const bucket = new MemoryBucket();
  await bucket.put(`covers/${mediaId}`, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  const api = createApi({ key: KEY, store, backupBucket: bucket });
  const response = await api.fetch(request("/v1/backups", { method: "POST", body: JSON.stringify({ includeMedia: true }) }));
  assert.equal(response.status, 201);
  const metadata = await response.json();
  assert.equal(metadata.includeMedia, true);
  assert.equal(metadata.mediaCopied, true);
  assert.equal(metadata.mediaCount, 1);
  assert.deepEqual([...bucket.objects.keys()].filter((key) => key.includes("/media/")), [`backups/${metadata.id}/media/${mediaId}`]);
  const archive = await api.fetch(request(`/v1/backups/${metadata.id}/download?format=zip`));
  assert.equal(archive.status, 200);
  assert.equal((await archive.arrayBuffer()).byteLength > 3, true);
  await bucket.delete(`covers/${mediaId}`);
  store.exportData = async () => ({ format: "private-bookmarks/v1", collections: [{ id: "unsorted", parentId: null, name: "Unsorted" }], bookmarks: [], preferences: {} });
  const restored = await api.fetch(request(`/v1/backups/${metadata.id}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(restored.status, 200);
  assert.ok(bucket.objects.has(`covers/${mediaId}`));
  assert.equal(store.restored.bookmarks[0].cover.includes(mediaId), true);
});

test("backup creation rejects libraries larger than the atomic D1 restore budget", async () => {
  const store = new MemoryStore();
  store.exportData = async () => ({
    format: "private-bookmarks/v1",
    collections: [{ id: "unsorted", parentId: null, name: "Unsorted" }],
    bookmarks: Array.from({ length: 86 }, (_, index) => ({ id: `bookmark-${index}`, link: `https://example.com/${index}`, collectionId: "unsorted", tags: [] })),
    preferences: {},
  });
  const api = createApi({ key: KEY, store, backupBucket: new MemoryBucket() });
  const response = await api.fetch(request("/v1/backups", { method: "POST", body: "{}" }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "backup_too_large");
});

test("backup routes report missing R2 storage", async () => {
  const api = createApi({ key: KEY, store: new MemoryStore() });
  const response = await api.fetch(request("/v1/backups"));
  assert.equal(response.status, 501);
  assert.equal((await response.json()).code, "not_available");
});

test("backup download reports missing metadata as not found", async () => {
  const api = createApi({ key: KEY, store: new MemoryStore(), backupBucket: new MemoryBucket() });
  const response = await api.fetch(request(`/v1/backups/${BACKUP_ID}/download`));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "not_found");
});

test("backup restore validates checksums and snapshots the current data", async () => {
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const api = createApi({ key: KEY, store, backupBucket: bucket });
  const created = await (await api.fetch(request("/v1/backups", { method: "POST", body: "{}" }))).json();
  const libraryKey = `backups/${created.id}/library.json`;
  bucket.objects.get(libraryKey).bytes[0] ^= 1;
  const invalid = await api.fetch(request(`/v1/backups/${created.id}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(invalid.status, 409);
  assert.equal((await invalid.json()).code, "backup_checksum_mismatch");

  const repaired = await api.fetch(request("/v1/backups", { method: "POST", body: "{}" }));
  const metadata = await repaired.json();
  const restored = await api.fetch(request(`/v1/backups/${metadata.id}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(restored.status, 200);
  const result = await restored.json();
  assert.equal(result.id, metadata.id);
  assert.ok(store.backups.has(result.preRestoreBackupId));
  assert.equal(store.restored.format, "private-bookmarks/v1");
});

test("deleting a backup removes metadata and both R2 objects", async () => {
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const api = createApi({ key: KEY, store, backupBucket: bucket });
  const metadata = await (await api.fetch(request("/v1/backups", { method: "POST", body: "{}" }))).json();
  const deleted = await api.fetch(request(`/v1/backups/${metadata.id}`, { method: "DELETE" }));
  assert.deepEqual(await deleted.json(), { ok: true, id: metadata.id });
  assert.equal(store.backups.size, 0);
  assert.equal(bucket.objects.size, 0);
});

test("scheduled backup keeps seven recent daily and four weekly automatic snapshots", async () => {
  const store = new MemoryStore();
  const bucket = new MemoryBucket();
  const day = 24 * 60 * 60 * 1_000;
  const now = new Date("2026-08-08T03:00:00.000Z");
  for (let index = 0; index < 40; index += 1) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    await store.createBackup({ id, kind: "automatic", createdAt: new Date(now.getTime() - (index + 1) * day).toISOString() });
  }
  await runScheduledTasks({ store, bucket, now });
  const automatic = await store.listBackups({ kind: "automatic" });
  assert.equal(automatic.length, 11);
  assert.equal(store.purgeCalls, 1);
});

test("scheduled backup failure does not skip health or trash maintenance", async () => {
  const store = new MemoryStore();
  const bucket = { put: async () => { throw new Error("R2 unavailable"); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await runScheduledTasks({ store, bucket, now: new Date("2026-08-08T03:00:00.000Z") });
  } finally {
    console.error = originalError;
  }
  assert.equal(store.healthCalls, 1);
  assert.equal(store.purgeCalls, 1);
});

test("cloud OAuth connects, reports status, and uploads a ZIP backup", async () => {
  const store = new CloudMemoryStore();
  const bucket = new MemoryBucket();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("oauth2/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "files" });
    if (String(url).includes("get_current_account")) return Response.json({ account_id: "account", name: { display_name: "Tester" }, email: "tester@example.com" });
    if (String(url).includes("files/upload")) return Response.json({ id: "remote" });
    throw new Error(`unexpected OAuth request ${url}`);
  };
  const api = createApi({ key: KEY, store, backupBucket: bucket, fetchImpl, oauth: { encryptionKey: "oauth-secret", dropbox: { clientId: "client", clientSecret: "secret" } } });
  const authorized = await api.fetch(request("/v1/cloud/dropbox/authorize", { method: "GET" }));
  assert.equal(authorized.status, 200);
  const authorizationUrl = new URL((await authorized.json()).authorizationUrl);
  const callback = await api.fetch(new Request(`https://private-bookmarks.test/v1/cloud/dropbox/callback?state=${encodeURIComponent(authorizationUrl.searchParams.get("state"))}&code=one-time-code`));
  assert.equal(callback.status, 200);
  assert.equal((await api.fetch(request("/v1/cloud/connections"))).json instanceof Function, true);
  const status = await (await api.fetch(request("/v1/cloud/connections"))).json();
  assert.equal(status.find((item) => item.provider === "dropbox").connected, true);
  const uploaded = await api.fetch(request("/v1/cloud/dropbox/backups", { method: "POST", body: JSON.stringify({ includeMedia: false }) }));
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).remote.id, "remote");
  assert.equal(calls.some((url) => url.includes("files/upload")), true);
  const disconnected = await api.fetch(request("/v1/cloud/dropbox/disconnect", { method: "POST", body: "{}" }));
  assert.equal(disconnected.status, 200);
});
