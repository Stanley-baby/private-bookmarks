import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createMigrationPackage,
  exportMigrationPackage,
  importMigrationPackage,
  parseMigrationPackage,
} from "../extension/migration-package.js";

class FakeRequest {
  onsuccess = null;
  onerror = null;
  result = undefined;

  resolve(value) {
    this.result = value;
    this.onsuccess?.({ target: this });
  }
}

class FakeCursor {
  constructor(key, value, next) {
    this.key = key;
    this.value = value;
    this.next = next;
  }

  continue() {
    queueMicrotask(this.next);
  }
}

class FakeStore {
  constructor({ keyPath = null, autoIncrement = false } = {}) {
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.nextKey = 1;
    this.records = new Map();
  }

  openCursor() {
    const request = new FakeRequest();
    const entries = [...this.records.entries()];
    let index = 0;
    const emit = () => {
      request.result = index < entries.length
        ? new FakeCursor(entries[index][0], entries[index][1], () => { index += 1; emit(); })
        : null;
      request.onsuccess?.({ target: request });
    };
    queueMicrotask(emit);
    return request;
  }

  clear() {
    const request = new FakeRequest();
    queueMicrotask(() => { this.records.clear(); request.resolve(undefined); });
    return request;
  }

  put(value, key) {
    const request = new FakeRequest();
    const record = structuredClone(value);
    const recordKey = key ?? record[this.keyPath] ?? (this.autoIncrement ? this.nextKey++ : undefined);
    if (recordKey === undefined) throw new TypeError("missing key");
    if (this.keyPath && record[this.keyPath] === undefined) record[this.keyPath] = recordKey;
    queueMicrotask(() => { this.records.set(recordKey, record); request.resolve(recordKey); });
    return request;
  }
}

class FakeDatabase {
  constructor(version) {
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name, options) {
    const store = new FakeStore(options);
    this.stores.set(name, store);
    return store;
  }

  transaction(names) {
    return new FakeTransaction(this, names);
  }

  close() {}
}

class FakeTransaction {
  constructor(database, names) {
    this.database = database;
    this.names = Array.isArray(names) ? names : [names];
    this.oncomplete = null;
    this.onerror = null;
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(name) {
    if (!this.names.includes(name)) throw new TypeError(`store not in transaction: ${name}`);
    return this.database.stores.get(name);
  }
}

class FakeIndexedDB {
  databases = new Map();

  open(name, version) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const upgrade = !database;
      if (!database) {
        database = new FakeDatabase(version);
        this.databases.set(name, database);
      }
      request.result = database;
      if (upgrade) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

class FakeStorage {
  constructor(values = {}) {
    this.values = structuredClone(values);
  }

  get(_keys, callback) {
    queueMicrotask(() => callback({ ...this.values }));
  }

  set(values, callback) {
    Object.assign(this.values, structuredClone(values));
    queueMicrotask(callback);
  }
}

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
  tombstones: [{ entity: "bookmark", id: "orphan", revision: 2, deletedAt: "2026-08-22T00:00:03.000Z" }],
  browserStorage: {
    privateBookmarksLock: { version: 1, iterations: 210000, autoLock: "15", salt: "salt-value", verifier: "verifier-value", ciphertext: "ciphertext-value" },
    instanceConnection: { endpoint: "https://private.example", key: "do-not-export" },
    instanceConnectionBackground: { endpoint: "https://private.example", key: "do-not-export" },
    privateBookmarksUnlocked: { unlocked: true, connection: { key: "do-not-export" } },
  },
};

test("migration package preserves durable records and redacts session/secrets", async () => {
  const value = await createMigrationPackage(snapshot, {
    cryptoImpl: webcrypto,
    exportedAt: "2026-08-22T01:00:00.000Z",
    source: { extensionId: "legacy-id", extensionVersion: "0.1.0" },
  });

  assert.equal(value.format, "private-bookmarks/migration");
  assert.equal(value.version, 1);
  assert.equal(value.source.extensionId, "legacy-id");
  assert.equal(value.cursor, "cursor-7");
  assert.deepEqual(value.settings.migrationTombstones, [{ entity: "bookmark", id: "orphan", revision: 2, deletedAt: "2026-08-22T00:00:03.000Z" }]);
  assert.deepEqual(value.browserStorage.instanceConnection, { endpoint: "https://private.example" });
  assert.deepEqual(value.browserStorage.privateBookmarksLock, { version: 1, iterations: 210000, autoLock: "15", salt: "salt-value", verifier: "verifier-value", ciphertext: "ciphertext-value" });
  assert.equal(value.browserStorage.privateBookmarksUnlocked, undefined);
  assert.equal(JSON.stringify(value).includes("do-not-export"), false);
  assert.match(value.checksum, /^[0-9a-f]{64}$/);

  assert.equal((await parseMigrationPackage(JSON.stringify(value), { cryptoImpl: webcrypto })).checksum, value.checksum);
});

test("corrupt and unsupported migration packages do not open or write storage", async () => {
  const value = await createMigrationPackage(snapshot, { cryptoImpl: webcrypto });
  const indexedDB = new FakeIndexedDB();
  const storage = new FakeStorage();
  const corrupted = { ...value, bookmarks: [{ ...value.bookmarks[0], title: "tampered" }] };
  await assert.rejects(
    () => importMigrationPackage(corrupted, { cryptoImpl: webcrypto, indexedDB, storage, databaseName: "unused" }),
    (error) => error.code === "migration_checksum_mismatch",
  );
  await assert.rejects(
    () => importMigrationPackage({ ...value, version: 99 }, { cryptoImpl: webcrypto, indexedDB, storage, databaseName: "unused" }),
    (error) => error.code === "unsupported_migration_version",
  );
  assert.equal(indexedDB.databases.size, 0);
  assert.deepEqual(storage.values, {});
});

test("default persistence adapter round-trips a package across database names", async () => {
  const oldIndexedDB = new FakeIndexedDB();
  const oldStorage = new FakeStorage(snapshot.browserStorage);
  const seed = await createMigrationPackage(snapshot, { cryptoImpl: webcrypto });
  await importMigrationPackage(seed, { indexedDB: oldIndexedDB, storage: oldStorage, databaseName: "legacy-origin", cryptoImpl: webcrypto });
  const exported = await exportMigrationPackage({ indexedDB: oldIndexedDB, storage: oldStorage, databaseName: "legacy-origin", cryptoImpl: webcrypto, exportedAt: "2026-08-22T01:00:00.000Z", source: { extensionId: "legacy-id" } });

  const newIndexedDB = new FakeIndexedDB();
  const newStorage = new FakeStorage();
  await importMigrationPackage(JSON.stringify(exported), { indexedDB: newIndexedDB, storage: newStorage, databaseName: "react-origin", cryptoImpl: webcrypto });
  const reexported = await exportMigrationPackage({ indexedDB: newIndexedDB, storage: newStorage, databaseName: "react-origin", cryptoImpl: webcrypto, exportedAt: exported.exportedAt, source: { extensionId: exported.source.extensionId } });

  for (const field of ["bookmarks", "collections", "settings", "outbox", "conflicts", "browserStorage", "tombstones", "cursor"]) assert.deepEqual(reexported[field], exported[field], field);
  assert.equal(newStorage.values.instanceConnection.key, undefined);
  assert.equal(newStorage.values.privateBookmarksUnlocked, undefined);
  assert.equal(reexported.settings.sync.cursor, "cursor-7");
  assert.deepEqual(reexported.settings.migrationTombstones, exported.settings.migrationTombstones);
});

test("verified import preserves IDs and durable fields", async () => {
  const value = await createMigrationPackage(snapshot, { cryptoImpl: webcrypto });
  let applied;
  const result = await importMigrationPackage(JSON.stringify(value), {
    cryptoImpl: webcrypto,
    writeSnapshot: async (next) => { applied = next; },
  });

  assert.equal(result.checksum, value.checksum);
  assert.equal(applied.bookmarks[0].id, "bookmark-1");
  assert.equal(applied.bookmarks[0].revision, 4);
  assert.equal(applied.bookmarks[0].deletedAt, "2026-08-22T00:00:02.000Z");
  assert.equal(applied.settings.sync.cursor, "cursor-7");
  assert.equal(applied.outbox[0].id, 8);
  assert.equal(applied.conflicts[0].key, "bookmark:bookmark-2");
  assert.deepEqual(applied.browserStorage.instanceConnection, { endpoint: "https://private.example" });
  assert.equal(await parseMigrationPackage(value, { cryptoImpl: webcrypto }).then((parsed) => parsed.checksum), value.checksum);
});
