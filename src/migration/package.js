const FORMAT = "private-bookmarks/migration";
const VERSION = 1;
const DATABASE = "private-bookmarks-local";
const DATABASE_VERSION = 2;
const STORES = ["bookmarks", "collections", "settings", "outbox", "conflicts"];
const EXCLUDED_STORAGE = ["chrome.storage.session"];
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

function persistentStorage(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sessionKey.test(key))
    .map(([key, item]) => [key, key === "privateBookmarksLock" ? safeLockConfig(item) : safeValue(item)])
    .filter(([, item]) => item !== undefined));
}

function safeSettings(value) {
  return isObject(value) ? safeValue(value) : {};
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

function sourceMetadata(value = {}) {
  return {
    extensionId: typeof value.extensionId === "string" ? value.extensionId : "",
    extensionVersion: typeof value.extensionVersion === "string" ? value.extensionVersion : "",
    databaseName: typeof value.databaseName === "string" ? value.databaseName : DATABASE,
    databaseVersion: Number(value.databaseVersion) || DATABASE_VERSION,
  };
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

function normalizeSnapshot(value = {}) {
  const bookmarks = Array.isArray(value.bookmarks) ? clone(value.bookmarks) : [];
  const collections = Array.isArray(value.collections) ? clone(value.collections) : [];
  const settings = safeSettings(value.settings);
  const outbox = Array.isArray(value.outbox) ? clone(value.outbox) : [];
  const conflicts = Array.isArray(value.conflicts) ? clone(value.conflicts) : [];
  const browserStorage = persistentStorage(value.browserStorage || value.persistentStorage || value.storage);
  const derivedTombstones = [...tombstones(bookmarks, "bookmark"), ...tombstones(collections, "collection")];
  const explicitTombstones = Array.isArray(value.tombstones) ? clone(value.tombstones) : [];
  const tombstoneMap = new Map(derivedTombstones.map((item) => [`${item.entity}:${item.id}`, item]));
  for (const item of explicitTombstones) if (item?.entity && item?.id) tombstoneMap.set(`${item.entity}:${item.id}`, item);
  const cursor = typeof value.cursor === "string" ? value.cursor : (typeof settings.sync?.cursor === "string" ? settings.sync.cursor : "");
  return { bookmarks, collections, settings, outbox, conflicts, browserStorage, tombstones: [...tombstoneMap.values()], cursor };
}

function counts(snapshot) {
  return {
    bookmarks: snapshot.bookmarks.length,
    collections: snapshot.collections.length,
    settings: Object.keys(snapshot.settings).length,
    outbox: snapshot.outbox.length,
    conflicts: snapshot.conflicts.length,
    tombstones: snapshot.tombstones.length,
    persistentStorage: Object.keys(snapshot.browserStorage).length,
  };
}

function validateRecords(value, requireMetadata = true) {
  if (!Array.isArray(value.bookmarks) || !Array.isArray(value.collections) || !isObject(value.settings) || !Array.isArray(value.outbox) || !Array.isArray(value.conflicts)) fail("invalid_migration_package");
  if (value.bookmarks.some((item) => !isObject(item) || typeof item.id !== "string")) fail("invalid_migration_package");
  if (value.collections.some((item) => !isObject(item) || typeof item.id !== "string")) fail("invalid_migration_package");
  if (value.outbox.some((item) => !isObject(item) || !Number.isFinite(Number(item.id)))) fail("invalid_migration_package");
  if (value.conflicts.some((item) => !isObject(item) || typeof item.key !== "string")) fail("invalid_migration_package");
  if (!isObject(value.browserStorage) || !Array.isArray(value.tombstones) || typeof value.cursor !== "string") fail("invalid_migration_package");
  if (!requireMetadata) return;
  if (!isObject(value.source) || !isObject(value.compatibility) || !Array.isArray(value.compatibility.stores) || !isObject(value.counts) || !Array.isArray(value.settingsCategories) || !Array.isArray(value.persistentStorageCategories) || !Array.isArray(value.excludedStorage)) fail("invalid_migration_package");
  if (value.excludedStorage.length !== 1 || value.excludedStorage[0] !== EXCLUDED_STORAGE[0]) fail("invalid_migration_package");
  const expected = counts(value);
  for (const key of Object.keys(expected)) if (Number(value.counts[key]) !== expected[key]) fail("invalid_migration_package");
  if (stableStringify(value.settingsCategories) !== stableStringify(Object.keys(value.settings).sort())) fail("invalid_migration_package");
  if (stableStringify(value.persistentStorageCategories) !== stableStringify(Object.keys(value.browserStorage).sort())) fail("invalid_migration_package");
}

function validateSnapshot(snapshot) {
  validateRecords({ ...snapshot, browserStorage: snapshot.browserStorage, tombstones: snapshot.tombstones, cursor: snapshot.cursor }, false);
}

function containsSessionKey(value) {
  if (Array.isArray(value)) return value.some(containsSessionKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, item]) => sessionKey.test(key) || containsSessionKey(item));
}

export async function createMigrationPackage(snapshot, options = {}) {
  const normalized = normalizeSnapshot(snapshot);
  const settingsCategories = Object.keys(normalized.settings).sort();
  const value = {
    format: FORMAT,
    version: VERSION,
    exportedAt: options.exportedAt || new Date().toISOString(),
    source: sourceMetadata({ ...snapshot?.source, ...options.source }),
    compatibility: {
      databaseName: options.databaseName || snapshot?.databaseName || DATABASE,
      databaseVersion: Number(options.databaseVersion || snapshot?.databaseVersion) || DATABASE_VERSION,
      stores: [...STORES],
    },
    bookmarks: normalized.bookmarks,
    collections: normalized.collections,
    settings: normalized.settings,
    outbox: normalized.outbox,
    conflicts: normalized.conflicts,
    browserStorage: normalized.browserStorage,
    tombstones: normalized.tombstones,
    cursor: normalized.cursor,
    counts: counts(normalized),
    settingsCategories,
    persistentStorageCategories: Object.keys(normalized.browserStorage).sort(),
    excludedStorage: [...EXCLUDED_STORAGE],
  };
  value.checksum = await digest(value, options.cryptoImpl);
  return value;
}

export function serializeMigrationPackage(value) {
  return JSON.stringify(value);
}

function decode(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { fail("invalid_migration_package"); }
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    try { return JSON.parse(new TextDecoder().decode(value)); } catch { fail("invalid_migration_package"); }
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

export async function previewMigrationPackage(value, options = {}) {
  const parsed = await parseMigrationPackage(value, options);
  return {
    format: parsed.format,
    version: parsed.version,
    exportedAt: parsed.exportedAt,
    source: sourceMetadata(parsed.source),
    compatibility: { ...parsed.compatibility, stores: [...parsed.compatibility.stores] },
    checksum: parsed.checksum,
    counts: { ...parsed.counts },
    settingsCategories: [...parsed.settingsCategories],
    persistentStorageCategories: [...parsed.persistentStorageCategories],
    excludedStorage: [...EXCLUDED_STORAGE],
  };
}

function recoveryId(id, used) {
  let suffix = 1;
  let next = `${id}~migration-${suffix}`;
  while (used.has(next)) next = `${id}~migration-${++suffix}`;
  return next;
}

function mergeRecords(current, incoming, entity) {
  // ponytail: O(n²) merge keeps this one-shot migration path small; use indexed maps if packages become large.
  const result = clone(current);
  const used = new Set(result.map((item) => item.id));
  const collectionMap = new Map();
  for (const item of incoming) {
    const existing = result.find((candidate) => candidate.id === item.id);
    if (!existing) { result.push(clone(item)); used.add(item.id); continue; }
    if (stableStringify(existing) === stableStringify(item)) continue;
    const id = recoveryId(item.id, used);
    const copy = { ...clone(item), id };
    if (entity === "collection") {
      copy.parentId = null;
      copy.name = `${item.name || "收藏夹"}（迁移副本）`;
      collectionMap.set(item.id, id);
    } else copy.title = `${item.title || "书签"}（迁移副本）`;
    result.push(copy);
    used.add(id);
  }
  return { result, collectionMap };
}

function mergeArrays(current, incoming, key) {
  const result = clone(current);
  const seen = new Set(result.map((item) => stableStringify(key ? item[key] : item)));
  for (const item of incoming) {
    const marker = stableStringify(key ? item[key] : item);
    if (!seen.has(marker)) { result.push(clone(item)); seen.add(marker); }
  }
  return result;
}

function mergeSnapshots(current, incoming) {
  const mergedCollections = mergeRecords(current.collections, incoming.collections, "collection");
  const remappedBookmarks = incoming.bookmarks.map((item) => {
    const collectionId = mergedCollections.collectionMap.get(item.collectionId);
    return collectionId ? { ...item, collectionId } : item;
  });
  const mergedBookmarks = mergeRecords(current.bookmarks, remappedBookmarks, "bookmark");
  return normalizeSnapshot({
    bookmarks: mergedBookmarks.result,
    collections: mergedCollections.result,
    settings: { ...incoming.settings, ...current.settings },
    outbox: mergeArrays(current.outbox, incoming.outbox, "id"),
    conflicts: mergeArrays(current.conflicts, incoming.conflicts, "key"),
    browserStorage: { ...incoming.browserStorage, ...current.browserStorage },
    tombstones: mergeArrays(current.tombstones, incoming.tombstones),
    cursor: current.cursor || incoming.cursor,
  });
}

export async function importMigrationPackage(value, options = {}) {
  const parsed = await parseMigrationPackage(value, options);
  const mode = options.mode || "import";
  if (!["import", "replace", "merge", "cancel"].includes(mode)) fail("invalid_migration_mode");
  if (mode === "cancel") return { mode: "cancel", checksum: parsed.checksum, counts: { ...parsed.counts } };
  const incoming = normalizeSnapshot(parsed);
  const readSnapshot = options.readSnapshot || (() => readMigrationSnapshot(options));
  const writeSnapshot = options.writeSnapshot || ((snapshot) => writeMigrationSnapshot(snapshot, options));
  const next = mode === "merge" ? mergeSnapshots(await readSnapshot(), incoming) : incoming;
  await writeSnapshot(next);
  return { mode, checksum: parsed.checksum, counts: counts(next) };
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("迁移写入失败"));
  });
}

function openDatabase(options = {}) {
  const indexedDBImpl = options.indexedDB || globalThis.indexedDB;
  if (!indexedDBImpl?.open) fail("migration_storage_unavailable");
  return new Promise((resolve, reject) => {
    let opening;
    try { opening = indexedDBImpl.open(options.databaseName || DATABASE, Number(options.databaseVersion) || DATABASE_VERSION); } catch (error) { reject(error); return; }
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("bookmarks")) db.createObjectStore("bookmarks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("collections")) db.createObjectStore("collections", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "key" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
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

async function readDatabaseSnapshot(options) {
  const db = await openDatabase(options);
  const transaction = db.transaction(STORES, "readonly");
  const entries = await Promise.all(STORES.map((name) => readEntries(transaction.objectStore(name))));
  const values = Object.fromEntries(STORES.map((name, index) => [name, entries[index]]));
  const databaseVersion = db.version;
  db.close();
  return {
    bookmarks: values.bookmarks.map(([, value]) => value),
    collections: values.collections.map(([, value]) => value),
    settings: Object.fromEntries(values.settings),
    outbox: values.outbox.map(([, value]) => value),
    conflicts: values.conflicts.map(([, value]) => value),
    databaseVersion,
  };
}

function storageObject(options = {}) {
  if (options.storage) return options.storage;
  return globalThis.chrome?.storage?.local || null;
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
      else if (storage.get.length < 2) finish({});
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
    else if (storage.set.length < 2) finish();
  });
}

export async function readMigrationSnapshot(options = {}) {
  const database = await readDatabaseSnapshot(options);
  return {
    ...normalizeSnapshot({ ...database, browserStorage: await readPersistentStorage(storageObject(options)) }),
    databaseName: options.databaseName || DATABASE,
    databaseVersion: database.databaseVersion,
  };
}

export async function writeMigrationSnapshot(value, options = {}) {
  const snapshot = normalizeSnapshot(value);
  validateSnapshot(snapshot);
  const db = await openDatabase(options);
  const transaction = db.transaction(STORES, "readwrite");
  for (const name of STORES) transaction.objectStore(name).clear();
  for (const record of snapshot.bookmarks) transaction.objectStore("bookmarks").put(record);
  for (const record of snapshot.collections) transaction.objectStore("collections").put(record);
  for (const [key, record] of Object.entries(snapshot.settings)) transaction.objectStore("settings").put(record, key);
  for (const record of snapshot.outbox) transaction.objectStore("outbox").put(record);
  for (const record of snapshot.conflicts) transaction.objectStore("conflicts").put(record);
  await transactionDone(transaction);
  db.close();
  await setPersistentStorage(storageObject(options), snapshot.browserStorage);
  return snapshot;
}

export async function exportMigrationPackage(options = {}) {
  const snapshot = options.snapshot || await readMigrationSnapshot(options);
  const runtime = globalThis.chrome?.runtime;
  const manifest = runtime?.getManifest?.() || {};
  return createMigrationPackage(snapshot, {
    ...options,
    databaseName: options.databaseName || DATABASE,
    databaseVersion: options.databaseVersion || DATABASE_VERSION,
    source: {
      extensionId: runtime?.id || "",
      extensionVersion: manifest.version || "",
      databaseName: options.databaseName || DATABASE,
      databaseVersion: options.databaseVersion || DATABASE_VERSION,
      ...options.source,
    },
  });
}

export const migrationFormat = FORMAT;
export const migrationVersion = VERSION;
