import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  applyMigrationPackage,
  createMigrationPackage,
  previewMigrationPackage,
} from "../extension/migration-package.js";

const current = {
  bookmarks: [{ id: "same", link: "https://local.example", title: "Local", collectionId: "local", createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:01.000Z", revision: 2 }],
  collections: [{ id: "local", name: "Local", parentId: null, createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:01.000Z", revision: 1 }],
  settings: { preferences: { theme: "dark" }, sync: { cursor: "local-cursor" } },
  browserStorage: { instanceConnection: { endpoint: "https://local.example" }, privateBookmarksLock: { version: 1, autoLock: "15", salt: "local-salt" } },
  outbox: [{ id: 1, entity: "bookmark", status: "pending", record: { id: "same" } }],
  conflicts: [{ key: "bookmark:local-conflict", entity: "bookmark", id: "local-conflict", local: {}, remote: {} }],
  tombstones: [{ entity: "bookmark", id: "local-deleted", revision: 3, deletedAt: "2026-08-22T00:00:02.000Z" }],
  cursor: "local-cursor",
};

const incoming = {
  source: { extensionId: "legacy-id", extensionVersion: "1.2.3" },
  bookmarks: [{ id: "same", link: "https://legacy.example", title: "Legacy", collectionId: "legacy", createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:01.000Z", revision: 4 }],
  collections: [{ id: "legacy", name: "Legacy", parentId: null, createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:01.000Z", revision: 2 }],
  settings: { preferences: { theme: "light" }, sync: { cursor: "legacy-cursor" }, webdav: { endpoint: "https://legacy.example" } },
  browserStorage: { instanceConnection: { endpoint: "https://legacy.example" }, privateBookmarksLock: { version: 2, autoLock: "30", salt: "legacy-salt" } },
  outbox: [{ id: 1, entity: "bookmark", status: "pending", record: { id: "same", revision: 4 } }],
  conflicts: [{ key: "bookmark:legacy-conflict", entity: "bookmark", id: "legacy-conflict", local: {}, remote: {} }],
  tombstones: [{ entity: "bookmark", id: "legacy-deleted", revision: 5, deletedAt: "2026-08-21T00:00:02.000Z" }],
  cursor: "legacy-cursor",
};

async function packageFor(snapshot) {
  return createMigrationPackage(snapshot, { cryptoImpl: webcrypto, exportedAt: "2026-08-22T02:00:00.000Z" });
}

test("migration preview exposes source, checksum, counts, categories, and sync summaries", async () => {
  const value = await packageFor(incoming);
  const preview = await previewMigrationPackage(value, { cryptoImpl: webcrypto });

  assert.deepEqual(preview.source, value.source);
  assert.equal(preview.version, 1);
  assert.equal(preview.checksum, value.checksum);
  assert.deepEqual(preview.recordCounts, { bookmarks: 1, collections: 1, settings: 3, outbox: 1, conflicts: 1, tombstones: 1 });
  assert.deepEqual(preview.settingsCategories, ["preferences", "sync", "webdav"]);
  assert.equal(preview.outboxCount, 1);
  assert.equal(preview.conflictsCount, 1);
  assert.equal(preview.cursor, "legacy-cursor");
});

test("migration decisions remain distinct and cancel never writes", async () => {
  const value = await packageFor(incoming);
  const writes = [];
  const readSnapshot = async () => current;
  const writeSnapshot = async (snapshot) => writes.push(snapshot);

  const cancelled = await applyMigrationPackage(value, "cancel", { cryptoImpl: webcrypto, readSnapshot, writeSnapshot });
  assert.deepEqual(cancelled, { status: "cancelled", mode: "cancel", checksum: value.checksum });
  assert.equal(writes.length, 0);

  const rejected = await applyMigrationPackage(value, "import", { cryptoImpl: webcrypto, readSnapshot, writeSnapshot });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.mode, "import");
  assert.equal(rejected.reason, "library_not_empty");
  assert.equal(writes.length, 0);
});

test("replace verifies a safety package and rolls current data back after a write failure", async () => {
  const value = await packageFor(incoming);
  const writes = [];
  let failed = false;
  const result = await applyMigrationPackage(value, "replace", {
    cryptoImpl: webcrypto,
    readSnapshot: async () => current,
    writeSnapshot: async (snapshot) => {
      writes.push(snapshot);
      if (!failed) {
        failed = true;
        throw new Error("simulated write failure");
      }
    },
  });

  assert.equal(result.status, "rolled_back");
  assert.equal(result.mode, "replace");
  assert.equal(result.checksum, value.checksum);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].bookmarks[0].link, "https://local.example");
  assert.match(result.safetySnapshot.checksum, /^[0-9a-f]{64}$/);
});

test("merge keeps collisions recoverable and invalidates divergent cursors", async () => {
  const value = await packageFor(incoming);
  let applied;
  const result = await applyMigrationPackage(value, "merge", {
    cryptoImpl: webcrypto,
    readSnapshot: async () => current,
    writeSnapshot: async (snapshot) => { applied = snapshot; },
  });

  assert.equal(result.status, "applied");
  assert.equal(result.mode, "merge");
  assert.ok(result.recoveryCopies >= 2);
  assert.equal(applied.bookmarks.length, 2);
  assert.equal(applied.collections.length, 2);
  assert.equal(applied.cursor, "");
  assert.equal(applied.outbox.length, 2);
  assert.equal(applied.conflicts.length, 2);
  assert.equal(applied.settings.sync.cursor, "");
  assert.equal(applied.settings.preferences.theme, "dark");
  assert.equal(applied.browserStorage.instanceConnection.endpoint, "https://local.example");
  assert.equal(applied.browserStorage.privateBookmarksLock.autoLock, "15");
  assert.equal(applied.settings.migrationRecovery[0].settings[0].key, "preferences");
  assert.equal(applied.tombstones.length, 2);
});
