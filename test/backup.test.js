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
  const remoteFiles = new Map();
  let uploadedBytes;
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes("oauth2/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "files" });
    if (String(url).includes("get_current_account")) return Response.json({ account_id: "account", name: { display_name: "Tester" }, email: "tester@example.com" });
    if (String(url).includes("files/upload")) {
      uploadedBytes = new Uint8Array(init.body);
      const name = JSON.parse(init.headers["dropbox-api-arg"]).path.split("/").pop();
      remoteFiles.set("remote", { id: "remote", name, size: uploadedBytes.byteLength, server_modified: "2026-08-08T01:00:00.000Z", bytes: uploadedBytes });
      return Response.json({ id: "remote", name, size: uploadedBytes.byteLength, server_modified: "2026-08-08T01:00:00.000Z" });
    }
    if (String(url).includes("files/list_folder")) {
      return Response.json({ entries: [...remoteFiles.values()].map(({ bytes, ...file }) => ({ ".tag": "file", ...file })), has_more: false });
    }
    if (String(url).includes("files/download")) {
      const id = JSON.parse(init.headers["dropbox-api-arg"]).path;
      const file = remoteFiles.get(id);
      return file ? new Response(file.bytes) : Response.json({ error: "missing" }, { status: 409 });
    }
    if (String(url).includes("files/delete_v2")) {
      remoteFiles.delete(JSON.parse(await new Response(init.body).text()).path);
      return Response.json({ ok: true });
    }
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
  const uploadedPayload = await uploaded.json();
  assert.equal(uploadedPayload.remote.id, "remote");
  assert.equal(uploadedPayload.name.endsWith(".pbk"), true);
  assert.equal(uploadedPayload.encrypted, true);
  assert.equal(uploadedPayload.bytes, uploadedBytes.byteLength);
  assert.deepEqual([...uploadedBytes.slice(0, 8)], [...new TextEncoder().encode("PBKENC01")]);
  assert.equal(new TextDecoder().decode(uploadedBytes).includes("library.json"), false);
  assert.equal(calls.some((url) => url.includes("files/upload")), true);

  const listed = await api.fetch(request("/v1/cloud/dropbox/backups"));
  assert.deepEqual((await listed.json()).backups.map((item) => ({ id: item.id, encrypted: item.encrypted })), [{ id: "remote", encrypted: true }]);
  const downloaded = await api.fetch(request("/v1/cloud/dropbox/backups/remote/download"));
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/zip");
  assert.equal((await downloaded.arrayBuffer()).byteLength > 30, true);
  const restored = await api.fetch(request("/v1/cloud/dropbox/backups/remote/restore", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(restored.status, 200);
  assert.equal(store.restored.format, "private-bookmarks/v1");
  const deleted = await api.fetch(request("/v1/cloud/dropbox/backups/remote", { method: "DELETE" }));
  assert.equal(deleted.status, 200);
  assert.equal(remoteFiles.has("remote"), false);
  const disconnected = await api.fetch(request("/v1/cloud/dropbox/disconnect", { method: "POST", body: "{}" }));
  assert.equal(disconnected.status, 200);
});

test("remote cloud backups keep legacy plaintext ZIPs readable and reject damaged ciphertext", async () => {
  const store = new CloudMemoryStore();
  const bucket = new MemoryBucket();
  const remoteFiles = new Map();
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("oauth2/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    if (String(url).includes("get_current_account")) return Response.json({ account_id: "account" });
    if (String(url).includes("files/list_folder")) return Response.json({ entries: [...remoteFiles.values()].map(({ bytes, ...file }) => ({ ".tag": "file", ...file })), has_more: false });
    if (String(url).includes("files/download")) return new Response(remoteFiles.get(JSON.parse(init.headers["dropbox-api-arg"]).path)?.bytes || new Uint8Array());
    throw new Error(`unexpected cloud request ${url}`);
  };
  const api = createApi({ key: KEY, store, backupBucket: bucket, fetchImpl, oauth: { encryptionKey: "oauth-secret", dropbox: { clientId: "client", clientSecret: "secret" } } });
  const authorized = await api.fetch(request("/v1/cloud/dropbox/authorize"));
  const state = new URL((await authorized.json()).authorizationUrl).searchParams.get("state");
  await api.fetch(new Request(`https://private-bookmarks.test/v1/cloud/dropbox/callback?state=${encodeURIComponent(state)}&code=one-time-code`));
  const created = await (await api.fetch(request("/v1/backups", { method: "POST", body: "{}" }))).json();
  const legacy = await api.fetch(request(`/v1/backups/${created.id}/download?format=zip`));
  remoteFiles.set("legacy", { id: "legacy", name: "private-bookmarks-legacy.zip", size: 0, server_modified: "2026-08-08T00:00:00.000Z", bytes: new Uint8Array(await legacy.arrayBuffer()) });
  const legacyDownload = await api.fetch(request("/v1/cloud/dropbox/backups/legacy/download"));
  assert.equal(legacyDownload.status, 200);
  const legacyRestore = await api.fetch(request("/v1/cloud/dropbox/backups/legacy/restore", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(legacyRestore.status, 200);

  remoteFiles.set("damaged", { id: "damaged", name: "private-bookmarks-damaged.pbk", size: 8, bytes: new TextEncoder().encode("PBKENC01") });
  const damaged = await api.fetch(request("/v1/cloud/dropbox/backups/damaged/download"));
  assert.equal(damaged.status, 409);
  assert.equal((await damaged.json()).code, "cloud_backup_decrypt_failed");

  remoteFiles.set("broken-zip", { id: "broken-zip", name: "private-bookmarks-broken.zip", size: 2, bytes: new Uint8Array([1, 2]) });
  const brokenZip = await api.fetch(request("/v1/cloud/dropbox/backups/broken-zip/restore", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(brokenZip.status, 409);
  assert.equal((await brokenZip.json()).code, "cloud_backup_invalid");

  const mediaId = "33333333-3333-4333-8333-333333333333";
  store.exportData = async () => ({
    format: "private-bookmarks/v1",
    collections: [{ id: "unsorted", parentId: null, name: "Unsorted" }],
    bookmarks: [{ id: "bookmark-1", link: "https://example.com", collectionId: "unsorted", cover: `https://private-bookmarks.test/v1/media/${mediaId}?token=test` }],
    preferences: {},
  });
  await bucket.put(`covers/${mediaId}`, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  const mediaBackup = await (await api.fetch(request("/v1/backups", { method: "POST", body: JSON.stringify({ includeMedia: true }) }))).json();
  const mediaZipResponse = await api.fetch(request(`/v1/backups/${mediaBackup.id}/download?format=zip`));
  const mediaZip = new Uint8Array(await mediaZipResponse.arrayBuffer());
  const mediaOffset = mediaZip.findIndex((value, index) => value === 1 && mediaZip[index + 1] === 2 && mediaZip[index + 2] === 3);
  assert.notEqual(mediaOffset, -1);
  mediaZip[mediaOffset] ^= 1;
  remoteFiles.set("broken-media", { id: "broken-media", name: "private-bookmarks-broken-media.zip", size: mediaZip.byteLength, bytes: mediaZip });
  const brokenMedia = await api.fetch(request("/v1/cloud/dropbox/backups/broken-media/restore", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.equal(brokenMedia.status, 409);
  assert.equal((await brokenMedia.json()).code, "cloud_backup_checksum_mismatch");
});
