import { LOCAL_DATABASE, LOCAL_DATABASE_VERSION, LOCAL_STORE_NAMES, openLocalDatabase } from "./local-storage.js";

const FORMAT = "private-bookmarks/migration";
const VERSION = 1;
const TOMBSTONE_SETTING = "migrationTombstones";
const encoder = new TextEncoder();
const sessionKey = /(?:^|[._-])session(?:$|[._-])|privateBookmarksUnlocked|import-progress/i;
const sensitiveKey = /(?:password|passwd|secret|token|api.?key|access.?key|client.?secret|refresh.?token|ciphertext|verifier|salt|private.?key|authorization|^key$)/i;

export class MigrationError extends TypeError {
  constructor(code) {
    super("迁移包无法验证");
    this.name = "MigrationError";
    this.code = code;
  }
}

function fail(code) {
  throw new MigrationError(code);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

function withoutChecksum(value) {
  const copy = { ...value };
  delete copy.checksum;
  return copy;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) fail("migration_crypto_unavailable");
  return hex(await cryptoImpl.subtle.digest("SHA-256", encoder.encode(stableStringify(value))));
}

function safeValue(value, key = "") {
  if (sessionKey.test(key)) return undefined;
  if (sensitiveKey.test(key)) return typeof value === "boolean" || typeof value === "number" ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => safeValue(item)).filter((item) => item !== undefined);
  if (!isObject(value)) return value;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const next = safeValue(childValue, childKey);
    if (next !== undefined) result[childKey] = next;
  }
  return result;
}

function safeLockConfig(value) {
  if (!isObject(value)) return {};
  // Keep the encrypted PIN envelope; plaintext connection credentials are redacted elsewhere.
  const result = {};
  for (const key of ["version", "salt", "verifier", "iterations", "autoLock", "iv", "ciphertext"]) {
    if (value[key] !== undefined) result[key] = clone(value[key]);
  }
  return result;
}

function persistentStorage(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sessionKey.test(key))
    .map(([key, item]) => [key, key === "privateBookmarksLock" ? safeLockConfig(item) : safeValue(item)])
    .filter(([, item]) => item !== undefined));
}

function sourceMetadata(value = {}) {
  return {
    extensionId: typeof value.extensionId === "string" ? value.extensionId : "",
    extensionVersion: typeof value.extensionVersion === "string" ? value.extensionVersion : "",
    databaseName: typeof value.databaseName === "string" ? value.databaseName : LOCAL_DATABASE,
    databaseVersion: Number(value.databaseVersion) || LOCAL_DATABASE_VERSION,
  };
}

function tombstoneKey(value) {
  return value?.entity && value?.id ? `${value.entity}:${value.id}` : "";
}

function tombstones(records, entity) {
  return records.flatMap((record) => {
    if (!record?.deletedAt && !record?.purgedAt && !record?.permanentDeletedAt) return [];
    return [{
      entity,
      id: record.id,
      revision: Number(record.revision) || 0,
      updatedAt: record.updatedAt || "",
      ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
      ...(record.purgedAt ? { purgedAt: record.purgedAt } : {}),
      ...(record.permanentDeletedAt ? { permanentDeletedAt: record.permanentDeletedAt } : {}),
    }];
  });
}

function applyTombstone(record, tombstone) {
  return {
    ...record,
    ...(tombstone.deletedAt ? { deletedAt: tombstone.deletedAt } : {}),
    ...(tombstone.purgedAt ? { purgedAt: tombstone.purgedAt } : {}),
    ...(tombstone.permanentDeletedAt ? { permanentDeletedAt: tombstone.permanentDeletedAt } : {}),
    ...(tombstone.updatedAt ? { updatedAt: tombstone.updatedAt } : {}),
    ...(tombstone.revision != null ? { revision: Math.max(Number(record.revision) || 0, Number(tombstone.revision) || 0) } : {}),
  };
}

function normalizeSnapshot(value = {}) {
  let bookmarks = Array.isArray(value.bookmarks) ? clone(value.bookmarks) : [];
  let collections = Array.isArray(value.collections) ? clone(value.collections) : [];
  const settings = isObject(value.settings) ? safeValue(value.settings) : {};
  const outbox = Array.isArray(value.outbox) ? clone(value.outbox) : [];
  const conflicts = Array.isArray(value.conflicts) ? clone(value.conflicts) : [];
  const browserStorage = persistentStorage(value.browserStorage);
  const explicit = [
    ...(Array.isArray(value.tombstones) ? value.tombstones : []),
    ...(Array.isArray(settings[TOMBSTONE_SETTING]) ? settings[TOMBSTONE_SETTING] : []),
  ].filter((item) => tombstoneKey(item));
  const byKey = new Map(explicit.map((item) => [tombstoneKey(item), item]));
  const apply = (records, entity) => records.map((record) => applyTombstone(record, byKey.get(`${entity}:${record.id}`) || {}));
  bookmarks = apply(bookmarks, "bookmark");
  collections = apply(collections, "collection");
  const allTombstones = [...tombstones(bookmarks, "bookmark"), ...tombstones(collections, "collection")];
  for (const item of explicit) if (!allTombstones.some((current) => tombstoneKey(current) === tombstoneKey(item))) allTombstones.push(clone(item));
  const uniqueTombstones = [...new Map(allTombstones.map((item) => [tombstoneKey(item), item])).values()];
  const recordKeys = new Set([
    ...bookmarks.map((item) => `bookmark:${item.id}`),
    ...collections.map((item) => `collection:${item.id}`),
  ]);
  const standalone = uniqueTombstones.filter((item) => !recordKeys.has(tombstoneKey(item)));
  if (standalone.length) settings[TOMBSTONE_SETTING] = standalone;
  else delete settings[TOMBSTONE_SETTING];
  const cursor = typeof value.cursor === "string" ? value.cursor : (typeof settings.sync?.cursor === "string" ? settings.sync.cursor : "");
  if (cursor || isObject(settings.sync)) settings.sync = { ...(settings.sync || {}), cursor };
  return { bookmarks, collections, settings, outbox, conflicts, browserStorage, tombstones: uniqueTombstones, cursor };
}

function validateRecords(value, requireMetadata = true) {
  if (!Array.isArray(value.bookmarks) || !Array.isArray(value.collections) || !isObject(value.settings) || !Array.isArray(value.outbox) || !Array.isArray(value.conflicts)) fail("invalid_migration_package");
  if (value.bookmarks.some((item) => !isObject(item) || typeof item.id !== "string")) fail("invalid_migration_package");
  if (value.collections.some((item) => !isObject(item) || typeof item.id !== "string")) fail("invalid_migration_package");
  if (value.outbox.some((item) => !isObject(item) || !Number.isFinite(Number(item.id)))) fail("invalid_migration_package");
  if (value.conflicts.some((item) => !isObject(item) || typeof item.key !== "string")) fail("invalid_migration_package");
  if (!isObject(value.browserStorage) || !Array.isArray(value.tombstones) || typeof value.cursor !== "string") fail("invalid_migration_package");
  if (!requireMetadata) return;
  if (!isObject(value.source)) fail("invalid_migration_package");
}

function validateSnapshot(snapshot) {
  validateRecords({ ...snapshot, browserStorage: snapshot.browserStorage, tombstones: snapshot.tombstones, cursor: snapshot.cursor }, false);
}

function snapshotSummary(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const settingsCategories = Object.keys(normalized.settings).filter((key) => key !== TOMBSTONE_SETTING).sort();
  return {
    recordCounts: {
      bookmarks: normalized.bookmarks.length,
      collections: normalized.collections.length,
      settings: settingsCategories.length,
      outbox: normalized.outbox.length,
      conflicts: normalized.conflicts.length,
      tombstones: normalized.tombstones.length,
    },
    settingsCategories,
    browserStorageCategories: Object.keys(normalized.browserStorage).sort(),
    outboxCount: normalized.outbox.length,
    conflictsCount: normalized.conflicts.length,
    tombstoneCount: normalized.tombstones.length,
    cursor: normalized.cursor,
  };
}

function hasLibraryData(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  return normalized.bookmarks.length > 0
    || normalized.collections.some((item) => item.id !== "unsorted")
    || Object.keys(normalized.settings).some((key) => key !== "initialized" && key !== TOMBSTONE_SETTING)
    || Object.keys(normalized.browserStorage).length > 0
    || normalized.outbox.length > 0
    || normalized.conflicts.length > 0
    || normalized.tombstones.length > 0;
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function sameSnapshot(left, right) {
  const comparable = (value) => {
    const snapshot = normalizeSnapshot(value);
    for (const [field, key] of [["bookmarks", "id"], ["collections", "id"], ["outbox", "id"], ["conflicts", "key"], ["tombstones", "entity"]]) {
      snapshot[field].sort((a, b) => `${a[key] || ""}:${a.id || ""}`.localeCompare(`${b[key] || ""}:${b.id || ""}`));
    }
    return snapshot;
  };
  return sameValue(comparable(left), comparable(right));
}

function recoveryId(id, used, label) {
  let suffix = 1;
  let candidate = `${id}-${label}-recovery`;
  while (used.has(candidate)) candidate = `${id}-${label}-recovery-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function mergeSnapshots(currentValue, incomingValue, checksum) {
  const current = normalizeSnapshot(currentValue);
  const incoming = normalizeSnapshot(incomingValue);
  const bookmarks = current.bookmarks.map(clone);
  const collections = current.collections.map(clone);
  const bookmarkIds = new Set([...bookmarks, ...incoming.bookmarks].map((item) => item.id));
  const collectionIds = new Set([...collections, ...incoming.collections].map((item) => item.id));
  const collectionMap = new Map();

  for (const item of incoming.collections) {
    const existing = collections.find((value) => value.id === item.id);
    if (!existing) {
      collectionMap.set(item.id, item.id);
      collectionIds.add(item.id);
      continue;
    }
    if (sameValue(existing, item)) {
      collectionMap.set(item.id, item.id);
      continue;
    }
    const id = recoveryId(item.id, collectionIds, "collection");
    collectionMap.set(item.id, id);
  }
  for (const item of incoming.collections) {
    const existing = collections.find((value) => value.id === item.id);
    if (existing && collectionMap.get(item.id) === item.id) continue;
    const id = collectionMap.get(item.id);
    const copied = id !== item.id;
    collections.push({ ...clone(item), id, ...(copied ? { name: `${item.name || "收藏夹"}（恢复副本）` } : {}), parentId: collectionMap.get(item.parentId) || item.parentId || null });
  }

  for (const item of incoming.bookmarks) {
    const existing = bookmarks.find((value) => value.id === item.id);
    const collectionId = collectionMap.get(item.collectionId) || item.collectionId;
    if (!existing) {
      bookmarks.push({ ...clone(item), collectionId });
      bookmarkIds.add(item.id);
      continue;
    }
    if (sameValue(existing, item)) continue;
    const id = recoveryId(item.id, bookmarkIds, "bookmark");
    bookmarks.push({ ...clone(item), id, title: `${item.title || item.link || "书签"}（恢复副本）`, collectionId });
  }

  const settings = { ...clone(current.settings) };
  const settingRecovery = [];
  for (const [key, value] of Object.entries(incoming.settings)) {
    if (settings[key] === undefined) settings[key] = clone(value);
    else if (key === "sync" && isObject(settings[key]) && isObject(value)) {
      const merged = { ...settings[key] };
      for (const [field, next] of Object.entries(value)) {
        if (merged[field] === undefined) merged[field] = clone(next);
        else if (!sameValue(merged[field], next)) settingRecovery.push({ key: `sync.${field}`, value: clone(next) });
      }
      settings[key] = merged;
    }
    else if (!sameValue(settings[key], value)) settingRecovery.push({ key, value: clone(value) });
  }

  const browserStorage = { ...clone(current.browserStorage) };
  const browserStorageRecovery = [];
  for (const [key, value] of Object.entries(incoming.browserStorage)) {
    if (browserStorage[key] === undefined) browserStorage[key] = clone(value);
    else if (!sameValue(browserStorage[key], value)) browserStorageRecovery.push({ key, value: clone(value) });
  }

  const outbox = current.outbox.map(clone);
  const outboxIds = new Set(outbox.map((item) => Number(item.id)).filter(Number.isFinite));
  let nextOutboxId = Math.max(0, ...outboxIds) + 1;
  for (const item of incoming.outbox) {
    const existing = outbox.find((value) => Number(value.id) === Number(item.id));
    if (!existing) outbox.push(clone(item));
    else if (!sameValue(existing, item)) {
      while (outboxIds.has(nextOutboxId)) nextOutboxId += 1;
      outbox.push({ ...clone(item), id: nextOutboxId });
      outboxIds.add(nextOutboxId);
      nextOutboxId += 1;
    }
  }

  const conflicts = current.conflicts.map(clone);
  const conflictKeys = new Set(conflicts.map((item) => item.key));
  for (const item of incoming.conflicts) {
    const existing = conflicts.find((value) => value.key === item.key);
    if (!existing) conflicts.push(clone(item));
    else if (!sameValue(existing, item)) {
      let key = `${item.key}#recovery`;
      let suffix = 1;
      while (conflictKeys.has(key)) key = `${item.key}#recovery-${suffix++}`;
      conflicts.push({ ...clone(item), key });
      conflictKeys.add(key);
    }
  }

  const tombstonesByKey = new Map([...current.tombstones, ...incoming.tombstones].map((item) => [tombstoneKey(item), clone(item)]));
  for (const item of current.tombstones) {
    const incomingItem = incoming.tombstones.find((value) => tombstoneKey(value) === tombstoneKey(item));
    if (incomingItem) tombstonesByKey.set(tombstoneKey(item), {
      ...item,
      ...clone(incomingItem),
      revision: Math.max(Number(item.revision) || 0, Number(incomingItem.revision) || 0),
    });
  }
  const tombstones = [...tombstonesByKey.values()];
  const cursorsDiffer = current.cursor && incoming.cursor && current.cursor !== incoming.cursor;
  const cursor = cursorsDiffer ? "" : current.cursor || incoming.cursor || "";
  if (isObject(settings.sync) || cursor) settings.sync = { ...(settings.sync || {}), cursor };
  if (settingRecovery.length || browserStorageRecovery.length) {
    const prior = Array.isArray(settings.migrationRecovery) ? settings.migrationRecovery : [];
    settings.migrationRecovery = [...prior, {
      checksum,
      settings: settingRecovery,
      browserStorage: browserStorageRecovery,
    }];
  }

  return { bookmarks, collections, settings, browserStorage, outbox, conflicts, tombstones, cursor };
}

function containsSessionKey(value) {
  if (Array.isArray(value)) return value.some(containsSessionKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, item]) => sessionKey.test(key) || containsSessionKey(item));
}

export async function createMigrationPackage(snapshot, options = {}) {
  const normalized = normalizeSnapshot(snapshot);
  const value = {
    format: FORMAT,
    version: VERSION,
    exportedAt: options.exportedAt || new Date().toISOString(),
    source: sourceMetadata({ ...snapshot?.source, ...options.source }),
    bookmarks: normalized.bookmarks,
    collections: normalized.collections,
    settings: normalized.settings,
    outbox: normalized.outbox,
    conflicts: normalized.conflicts,
    browserStorage: normalized.browserStorage,
    tombstones: normalized.tombstones,
    cursor: normalized.cursor,
  };
  value.checksum = await digest(value, options.cryptoImpl);
  return value;
}

function decode(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { fail("invalid_migration_package"); }
  }
  return value;
}

export async function parseMigrationPackage(value, options = {}) {
  const parsed = decode(value);
  if (!isObject(parsed)) fail("invalid_migration_package");
  if (parsed.format !== FORMAT) fail("unsupported_migration_format");
  if (parsed.version !== VERSION) fail("unsupported_migration_version");
  if (!/^[0-9a-f]{64}$/.test(parsed.checksum || "")) fail("invalid_migration_checksum");
  validateRecords(parsed);
  if (containsSessionKey(parsed)) fail("session_state_forbidden");
  if (await digest(withoutChecksum(parsed), options.cryptoImpl) !== parsed.checksum) fail("migration_checksum_mismatch");
  return parsed;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("迁移写入失败"));
  });
}

function readEntries(store) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const cursor = store.openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      if (!cursor.result) { resolve(entries); return; }
      entries.push([cursor.result.key, clone(cursor.result.value)]);
      cursor.result.continue();
    };
  });
}

async function readDatabaseSnapshot(options = {}) {
  const db = await openLocalDatabase({ ...options, version: options.databaseVersion });
  const transaction = db.transaction(LOCAL_STORE_NAMES, "readonly");
  const entries = await Promise.all(LOCAL_STORE_NAMES.map((name) => readEntries(transaction.objectStore(name))));
  const values = Object.fromEntries(LOCAL_STORE_NAMES.map((name, index) => [name, entries[index]]));
  const databaseVersion = db.version;
  db.close();
  return {
    bookmarks: values.bookmarks.map(([, value]) => value),
    collections: values.collections.map(([, value]) => value),
    settings: Object.fromEntries(values.settings),
    outbox: values.outbox.map(([, value]) => value),
    conflicts: values.conflicts.map(([, value]) => value),
    databaseName: options.databaseName || LOCAL_DATABASE,
    databaseVersion,
  };
}

function storageObject(options = {}) {
  return options.storage || globalThis.chrome?.storage?.local || null;
}

async function readPersistentStorage(storage) {
  if (storage?.get) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value || {}); } };
      let result;
      try { result = storage.get(null, finish); } catch (error) { reject(error); return; }
      if (result?.then) result.then(finish, reject);
      else if (result && typeof result === "object") finish(result);
    });
  }
  if (typeof globalThis.localStorage === "undefined") return {};
  const value = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    try { value[key] = JSON.parse(localStorage.getItem(key)); } catch { value[key] = localStorage.getItem(key); }
  }
  return value;
}

function setPersistentStorage(storage, value) {
  if (!storage?.set || !Object.keys(value).length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    let result;
    try { result = storage.set(value, finish); } catch (error) { reject(error); return; }
    if (result?.then) result.then(finish, reject);
  });
}

function clearPersistentStorage(storage) {
  if (!storage) return Promise.resolve();
  if (storage.clear) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      let result;
      try { result = storage.clear(finish); } catch (error) { reject(error); return; }
      if (result?.then) result.then(finish, reject);
    });
  }
  if (!storage.get || !storage.remove) return Promise.resolve();
  return new Promise((resolve, reject) => {
    storage.get(null, (values = {}) => {
      const keys = Object.keys(values);
      if (!keys.length) return resolve();
      let result;
      try { result = storage.remove(keys, resolve); } catch (error) { reject(error); return; }
      if (result?.then) result.then(resolve, reject);
    });
  });
}

async function readMigrationSnapshot(options = {}) {
  const database = await readDatabaseSnapshot(options);
  return normalizeSnapshot({ ...database, browserStorage: await readPersistentStorage(storageObject(options)) });
}

function emptySnapshot() {
  return { bookmarks: [], collections: [], settings: {}, browserStorage: {}, outbox: [], conflicts: [], tombstones: [], cursor: "" };
}

async function currentSnapshot(options = {}) {
  if (options.readSnapshot) return normalizeSnapshot(await options.readSnapshot());
  if (options.writeSnapshot) return null;
  return readMigrationSnapshot(options);
}

async function writeMigrationSnapshot(value, options = {}) {
  const snapshot = normalizeSnapshot(value);
  validateSnapshot(snapshot);
  const db = await openLocalDatabase({ ...options, version: options.databaseVersion });
  const transaction = db.transaction(LOCAL_STORE_NAMES, "readwrite");
  for (const name of LOCAL_STORE_NAMES) transaction.objectStore(name).clear();
  for (const record of snapshot.bookmarks) transaction.objectStore("bookmarks").put(record);
  for (const record of snapshot.collections) transaction.objectStore("collections").put(record);
  for (const [key, record] of Object.entries(snapshot.settings)) transaction.objectStore("settings").put(record, key);
  for (const record of snapshot.outbox) transaction.objectStore("outbox").put(record);
  for (const record of snapshot.conflicts) transaction.objectStore("conflicts").put(record);
  await transactionDone(transaction);
  db.close();
  const storage = storageObject(options);
  await clearPersistentStorage(storage);
  await setPersistentStorage(storage, snapshot.browserStorage);
  return snapshot;
}

export async function exportMigrationPackage(options = {}) {
  const snapshot = await readMigrationSnapshot(options);
  const runtime = globalThis.chrome?.runtime;
  const manifest = runtime?.getManifest?.() || {};
  return createMigrationPackage(snapshot, {
    ...options,
    databaseName: options.databaseName || LOCAL_DATABASE,
    databaseVersion: options.databaseVersion || LOCAL_DATABASE_VERSION,
    source: {
      extensionId: runtime?.id || "",
      extensionVersion: manifest.version || "",
      databaseName: options.databaseName || LOCAL_DATABASE,
      databaseVersion: options.databaseVersion || LOCAL_DATABASE_VERSION,
      ...options.source,
    },
  });
}

export async function previewMigrationPackage(value, options = {}) {
  const parsed = await parseMigrationPackage(value, options);
  const snapshot = normalizeSnapshot(parsed);
  const summary = snapshotSummary(snapshot);
  const result = {
    status: "preview",
    mode: "preview",
    format: parsed.format,
    version: parsed.version,
    source: clone(parsed.source),
    checksum: parsed.checksum,
    ...summary,
  };
  if (options.includeCurrent || options.readSnapshot) {
    const current = await currentSnapshot(options);
    if (current) result.current = snapshotSummary(current);
  }
  return result;
}

async function safetySnapshot(snapshot, options, source) {
  const value = await createMigrationPackage(snapshot, {
    cryptoImpl: options.cryptoImpl,
    source: source || { extensionId: "", extensionVersion: "" },
  });
  return parseMigrationPackage(value, options);
}

function writerFor(options) {
  return options.writeSnapshot || ((snapshot) => writeMigrationSnapshot(snapshot, options));
}

async function verifySnapshot(snapshot, options, reader, customWriter) {
  if (options.verifySnapshot) return options.verifySnapshot(snapshot);
  if (customWriter || !reader) return true;
  const actual = normalizeSnapshot(await reader());
  if (!sameSnapshot(actual, snapshot)) {
    const expected = normalizeSnapshot(snapshot);
    const error = new MigrationError("migration_validation_failed");
    error.details = {
      expected: snapshotSummary(expected),
      actual: snapshotSummary(actual),
      mismatchedFields: ["bookmarks", "collections", "settings", "browserStorage", "outbox", "conflicts", "tombstones", "cursor"].filter((field) => !sameValue(expected[field], actual[field])),
      recordIds: {
        expectedBookmarks: expected.bookmarks.map((item) => item.id),
        actualBookmarks: actual.bookmarks.map((item) => item.id),
        expectedCollections: expected.collections.map((item) => item.id),
        actualCollections: actual.collections.map((item) => item.id),
      },
    };
    throw error;
  }
  return true;
}

export async function applyMigrationPackage(value, mode = "replace", options = {}) {
  if (isObject(mode)) {
    options = mode;
    mode = options.mode || "replace";
  }
  if (!["import", "replace", "merge", "cancel"].includes(mode)) fail("invalid_migration_action");
  const parsed = await parseMigrationPackage(value, options);
  if (mode === "cancel") return { status: "cancelled", mode, checksum: parsed.checksum };

  const incoming = normalizeSnapshot(parsed);
  const reader = options.readSnapshot || (!options.writeSnapshot ? () => readMigrationSnapshot(options) : null);
  const current = await currentSnapshot(options);
  if (mode === "import" && current && hasLibraryData(current)) return { status: "rejected", mode, reason: "library_not_empty", checksum: parsed.checksum };

  const existing = current || emptySnapshot();
  const desired = mode === "merge" ? mergeSnapshots(existing, incoming, parsed.checksum) : incoming;
  validateSnapshot(desired);
  const writer = writerFor(options);
  const customWriter = Boolean(options.writeSnapshot);
  const safety = mode === "replace" && current ? await safetySnapshot(existing, options, { extensionId: "", extensionVersion: "" }) : null;

  try {
    await writer(desired);
    await verifySnapshot(desired, options, reader, customWriter);
    return {
      status: "applied",
      mode,
      checksum: parsed.checksum,
      recoveryCopies: mode === "merge" ? countRecoveryCopies(existing, desired) : 0,
      ...(safety ? { safetySnapshot: safety } : {}),
    };
  } catch (reason) {
    if (!current) throw reason;
    try {
      await writer(existing);
    } catch {
      const error = new MigrationError("migration_rollback_failed");
      error.cause = reason;
      throw error;
    }
    return {
      status: "rolled_back",
      mode,
      checksum: parsed.checksum,
      errorCode: reason?.code || "migration_write_failed",
      ...(reason?.details ? { validation: reason.details } : {}),
      ...(safety ? { safetySnapshot: safety } : {}),
    };
  }
}

function countRecoveryCopies(current, merged) {
  const currentKeys = new Set([
    ...current.bookmarks.map((item) => item.id),
    ...current.collections.map((item) => item.id),
  ]);
  const settingRecovery = Array.isArray(merged.settings?.migrationRecovery)
    ? merged.settings.migrationRecovery.reduce((total, item) => total + (item.settings?.length || 0) + (item.browserStorage?.length || 0), 0)
    : 0;
  return merged.bookmarks.filter((item) => !currentKeys.has(item.id)).filter((item) => /（恢复副本）$/.test(item.title || "")).length
    + merged.collections.filter((item) => !currentKeys.has(item.id)).filter((item) => /（恢复副本）$/.test(item.name || "")).length
    + settingRecovery;
}

export async function importMigrationPackage(value, options = {}) {
  return applyMigrationPackage(value, options.mode || "replace", options);
}
