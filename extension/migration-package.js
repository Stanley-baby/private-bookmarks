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

async function readMigrationSnapshot(options = {}) {
  const database = await readDatabaseSnapshot(options);
  return normalizeSnapshot({ ...database, browserStorage: await readPersistentStorage(storageObject(options)) });
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
  await setPersistentStorage(storageObject(options), snapshot.browserStorage);
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

export async function importMigrationPackage(value, options = {}) {
  const parsed = await parseMigrationPackage(value, options);
  const snapshot = normalizeSnapshot(parsed);
  await (options.writeSnapshot || ((next) => writeMigrationSnapshot(next, options)))(snapshot);
  return { checksum: parsed.checksum };
}
