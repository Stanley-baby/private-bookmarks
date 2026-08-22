import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createMigrationPackage,
  importMigrationPackage,
  parseMigrationPackage,
  previewMigrationPackage,
  serializeMigrationPackage,
} from "../src/migration/package.js";

const snapshot = {
  bookmarks: [{
    id: "bookmark-1",
    link: "https://example.com",
    title: "Example",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    revision: 4,
    deletedAt: "2026-08-22T00:00:02.000Z",
    purgedAt: "2026-08-22T00:00:02.000Z",
  }],
  collections: [{
    id: "collection-1",
    name: "Reading",
    parentId: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    revision: 3,
  }],
  settings: {
    preferences: { theme: "dark", revision: 2 },
    sync: { enabled: true, cursor: "cursor-7", intervalMinutes: 15 },
    webdav: { endpoint: "https://dav.example", password: "do-not-export" },
  },
  outbox: [{ id: 8, entity: "bookmark", record: { id: "bookmark-1", revision: 4 }, status: "pending" }],
  conflicts: [{ key: "bookmark:bookmark-2", entity: "bookmark", id: "bookmark-2", local: { revision: 1 }, remote: { revision: 2 } }],
  browserStorage: {
    privateBookmarksLock: { version: 1, iterations: 210000, autoLock: "15", salt: "salt-value", verifier: "verifier-value", ciphertext: "ciphertext-value" },
    instanceConnection: { endpoint: "https://private.example", key: "do-not-export" },
    instanceConnectionBackground: { endpoint: "https://private.example", key: "do-not-export" },
    privateBookmarksUnlocked: { unlocked: true, connection: { key: "do-not-export" } },
  },
};

test("migration package preserves durable records and omits session/secrets", async () => {
  const value = await createMigrationPackage(snapshot, {
    cryptoImpl: webcrypto,
    exportedAt: "2026-08-22T01:00:00.000Z",
    source: { extensionId: "legacy-id", extensionVersion: "0.1.0" },
  });

  assert.equal(value.format, "private-bookmarks/migration");
  assert.equal(value.version, 1);
  assert.equal(value.source.extensionId, "legacy-id");
  assert.equal(value.cursor, "cursor-7");
  assert.equal(value.counts.bookmarks, 1);
  assert.equal(value.counts.tombstones, 1);
  assert.deepEqual(value.browserStorage.instanceConnection, { endpoint: "https://private.example" });
  assert.deepEqual(value.browserStorage.privateBookmarksLock, { version: 1, iterations: 210000, autoLock: "15", salt: "salt-value", verifier: "verifier-value", ciphertext: "ciphertext-value" });
  assert.equal(value.browserStorage.privateBookmarksUnlocked, undefined);
  assert.equal(JSON.stringify(value).includes("do-not-export"), false);
  assert.match(value.checksum, /^[0-9a-f]{64}$/);

  const preview = await previewMigrationPackage(await serializeMigrationPackage(value), { cryptoImpl: webcrypto });
  assert.deepEqual(preview.counts, value.counts);
  assert.deepEqual(preview.settingsCategories, ["preferences", "sync", "webdav"]);
  assert.deepEqual(preview.persistentStorageCategories, ["instanceConnection", "instanceConnectionBackground", "privateBookmarksLock"]);
  assert.deepEqual(preview.excludedStorage, ["chrome.storage.session"]);
});

test("migration import validates checksum and version before writing", async () => {
  const value = await createMigrationPackage(snapshot, { cryptoImpl: webcrypto });
  const writes = [];

  const corrupted = { ...value, bookmarks: [{ ...value.bookmarks[0], title: "tampered" }] };
  await assert.rejects(
    () => importMigrationPackage(corrupted, { cryptoImpl: webcrypto, writeSnapshot: async (next) => writes.push(next) }),
    (error) => error.code === "migration_checksum_mismatch",
  );
  await assert.rejects(
    () => importMigrationPackage({ ...value, version: 99 }, { cryptoImpl: webcrypto, writeSnapshot: async (next) => writes.push(next) }),
    (error) => error.code === "unsupported_migration_version",
  );
  assert.equal(writes.length, 0);
});

test("migration import writes a verified snapshot without changing durable fields", async () => {
  const value = await createMigrationPackage(snapshot, { cryptoImpl: webcrypto });
  let applied;
  const result = await importMigrationPackage(await serializeMigrationPackage(value), {
    cryptoImpl: webcrypto,
    mode: "replace",
    writeSnapshot: async (next) => { applied = next; },
  });

  assert.equal(result.mode, "replace");
  assert.equal(applied.bookmarks[0].id, "bookmark-1");
  assert.equal(applied.bookmarks[0].revision, 4);
  assert.equal(applied.bookmarks[0].deletedAt, "2026-08-22T00:00:02.000Z");
  assert.equal(applied.settings.sync.cursor, "cursor-7");
  assert.equal(applied.outbox[0].id, 8);
  assert.equal(applied.conflicts[0].key, "bookmark:bookmark-2");
  assert.deepEqual(applied.browserStorage.instanceConnection, { endpoint: "https://private.example" });
  assert.equal(await parseMigrationPackage(value, { cryptoImpl: webcrypto }).then((parsed) => parsed.checksum), value.checksum);
});
