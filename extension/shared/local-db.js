import { applyBookmarkBatch, mergeBookmarkConflict, normalizeBookmark } from "./local-model.js";
import { LOCAL_DATABASE, LOCAL_DATABASE_VERSION, openLocalDatabase } from "../local-storage.js";
import {
  applyMigrationPackage,
  exportMigrationPackage,
  importMigrationPackage,
  previewMigrationPackage
} from "../migration-package.js";
const DEFAULT_PREFERENCES = {
  language: "zh-Hans",
  instanceName: "\u79C1\u6709\u4E66\u7B7E",
  theme: "auto",
  defaultCollectionId: "unsorted",
  sort: "manual",
  layout: "list",
  defaultView: "list",
  buttonGroup: { select: true, current_tab: false, new_tab: true, preview: false, web: false, copy: false, ask: false, important: false, tags: false, edit: true, remove: true },
  searchRelevance: true,
  recommendCollectionsTags: false,
  aiRecommendations: false,
  aiProvider: "cloudflare",
  aiModel: "",
  aiThinkingEnabled: false,
  aiMaxTokens: 300,
  aiBaseUrl: "https://api.openai.com/v1",
  aiExternalModel: "gpt-4o-mini",
  aiPrompt: "",
  brokenLevel: "default",
  nestedViewLegacy: false,
  layoutByScope: {}
};
function request(value) {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function database() {
  return openLocalDatabase({ databaseName: LOCAL_DATABASE, version: LOCAL_DATABASE_VERSION });
}
async function store(name, mode = "readonly") {
  return (await database()).transaction(name, mode).objectStore(name);
}
async function initialized() {
  return Boolean(await request((await store("settings")).get("initialized")));
}
async function initialize() {
  await request((await store("settings", "readwrite")).put(true, "initialized"));
}
async function ensureDefaults() {
  const current = await request((await store("collections")).get("unsorted"));
  if (!current) {
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    await request((await store("collections", "readwrite")).put({ id: "unsorted", name: "\u672A\u5206\u7C7B", parentId: null, position: 0, createdAt, updatedAt: createdAt, revision: 1 }));
  }
  await initialize();
}
async function getActionMode() {
  const value = await request((await store("settings")).get("actionMode"));
  return value === "popup" || value === "sidepanel" ? value : null;
}
async function setActionMode(mode) {
  if (mode !== "popup" && mode !== "sidepanel") throw new TypeError("\u65E0\u6548\u7684\u64CD\u4F5C\u6A21\u5F0F");
  await request((await store("settings", "readwrite")).put(mode, "actionMode"));
  return mode;
}
async function listBookmarks({ trash = false } = {}) {
  const items = await request((await store("bookmarks")).getAll());
  return items.filter((item) => trash ? Boolean(item.deletedAt) && !item.purgedAt && !item.permanentDeletedAt : !item.deletedAt && !item.purgedAt && !item.permanentDeletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function listCollections({ trash = false } = {}) {
  const items = await request((await store("collections")).getAll());
  if (trash) {
    const deleted = new Set(items.filter((item) => item.deletedAt).map((item) => item.id));
    return items.filter((item) => item.deletedAt && !deleted.has(item.parentId || "")).sort((a, b) => a.name.localeCompare(b.name));
  }
  return items.filter((item) => !item.deletedAt).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
}
async function getPreferences() {
  const value = await request((await store("settings")).get("preferences"));
  return { ...DEFAULT_PREFERENCES, ...value || {}, revision: Number(value?.revision) || 0 };
}
async function updatePreferences(expectedRevision, changes) {
  const current = await getPreferences();
  if (current.revision !== Number(expectedRevision)) return { conflict: current };
  const next = { ...current, ...changes };
  delete next.revision;
  const preferences = { ...next, revision: current.revision + 1 };
  await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  return { preferences };
}
async function saveBookmark(input, { enqueueSync = true } = {}) {
  await ensureDefaults();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = input.id ? await request((await store("bookmarks")).get(input.id)) : void 0;
  const item = normalizeBookmark(input, existing, now);
  item.revision = Number(existing?.revision || 0) + 1;
  await request((await store("bookmarks", "readwrite")).put(item));
  if (enqueueSync) await enqueueLatest({ entity: "bookmark", id: item.id, baseRevision: Number(existing?.revision || 0), record: item });
  return item;
}
async function saveBookmarkWithCollection(input, collection) {
  await ensureDefaults();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const db = await database();
  const existing = input.id ? await request(db.transaction("bookmarks").objectStore("bookmarks").get(input.id)) : void 0;
  const item = normalizeBookmark(input, existing, now);
  const collectionItem = collection ? {
    id: collection.id || crypto.randomUUID(),
    name: collection.name.trim(),
    parentId: collection.parentId || null,
    createdAt: collection.createdAt || now,
    updatedAt: now,
    revision: Number(collection.revision || 0) + 1
  } : null;
  item.revision = Number(existing?.revision || 0) + 1;
  const tx = db.transaction(["bookmarks", "collections", "outbox"], "readwrite");
  tx.objectStore("bookmarks").put(item);
  if (collectionItem) tx.objectStore("collections").put(collectionItem);
  const outbox = tx.objectStore("outbox");
  outbox.add({ entity: "bookmark", id: item.id, baseRevision: Number(existing?.revision || 0), record: item, createdAt: now, status: "pending" });
  if (collectionItem) outbox.add({ entity: "collection", id: collectionItem.id, baseRevision: 0, record: collectionItem, createdAt: now, status: "pending" });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("\u4FDD\u5B58\u5EFA\u8BAE\u5931\u8D25"));
  });
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
  return { bookmark: item, collection: collectionItem };
}
async function trashBookmark(id) {
  const target = await request((await store("bookmarks")).get(id));
  if (!target) return null;
  target.deletedAt = target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  delete target.purgedAt;
  delete target.permanentDeletedAt;
  const baseRevision = Number(target.revision || 0);
  target.revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueueLatest({ entity: "bookmark", id, baseRevision, record: target });
  return target;
}
async function restoreBookmark(id) {
  const target = await request((await store("bookmarks")).get(id));
  if (!target || target.permanentDeletedAt) return null;
  delete target.deletedAt;
  delete target.purgedAt;
  target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const baseRevision = Number(target.revision || 0);
  target.revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueueLatest({ entity: "bookmark", id, baseRevision, record: target });
  return target;
}
async function batchBookmark(id, action) {
  const target = await request((await store("bookmarks")).get(id));
  if (!target) return null;
  if (action.type === "move" && action.collectionId !== "unsorted") {
    const destination = await request((await store("collections")).get(action.collectionId));
    if (!destination || destination.deletedAt) throw new TypeError("\u6536\u85CF\u5939\u4E0D\u5B58\u5728");
  }
  if (action.type === "trash") {
    await trashBookmark(id);
    return request((await store("bookmarks")).get(id));
  }
  if (action.type === "restore") {
    await restoreBookmark(id);
    return request((await store("bookmarks")).get(id));
  }
  if (action.type === "screenshot") {
    const media = Array.isArray(target.media) ? [...target.media] : [];
    if (!media.some((value) => value === "<screenshot>" || value && typeof value === "object" && value.link === "<screenshot>")) media.push("<screenshot>");
    const next2 = { ...target, cover: "<screenshot>", media, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), revision: Number(target.revision || 0) + 1 };
    await request((await store("bookmarks", "readwrite")).put(next2));
    await enqueueLatest({ entity: "bookmark", id, baseRevision: Number(target.revision || 0), record: next2 });
    return next2;
  }
  const next = applyBookmarkBatch(target, action, (/* @__PURE__ */ new Date()).toISOString());
  await request((await store("bookmarks", "readwrite")).put(next));
  await enqueueLatest({ entity: "bookmark", id, baseRevision: Number(target.revision || 0), record: next });
  return next;
}
async function batchBookmarks(ids, action) {
  const changed = [];
  for (const id of [...new Set(ids)]) {
    const item = await batchBookmark(id, action);
    if (item) changed.push(item);
  }
  return changed;
}
async function saveCollection(input, { enqueueSync = true } = {}) {
  const id = input.id || crypto.randomUUID();
  const existing = await request((await store("collections")).get(id));
  const item = { id, name: input.name.trim(), parentId: input.parentId || null, position: input.position ?? existing?.position ?? 0, createdAt: existing?.createdAt || input.createdAt || (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString(), revision: Number(existing?.revision || 0) + 1 };
  await request((await store("collections", "readwrite")).put(item));
  if (enqueueSync) await enqueueLatest({ entity: "collection", id: item.id, baseRevision: Number(existing?.revision || 0), record: item });
  return item;
}
async function trashCollection(id) {
  const target = await request((await store("collections")).get(id));
  if (!target || target.deletedAt || id === "unsorted") return null;
  const all = await request((await store("collections")).getAll());
  const ids = /* @__PURE__ */ new Set([id]);
  for (const item of all) if (item.parentId && ids.has(item.parentId)) ids.add(item.id);
  const deletedAt = (/* @__PURE__ */ new Date()).toISOString();
  const bookmarks = await request((await store("bookmarks")).getAll());
  for (const item of all) if (ids.has(item.id)) {
    item.deletedAt = deletedAt;
    item.deletedByCollectionId = id;
    item.updatedAt = deletedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("collections", "readwrite")).put(item));
    await enqueueLatest({ entity: "collection", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  for (const item of bookmarks.filter((bookmark) => ids.has(bookmark.collectionId) && !bookmark.deletedAt)) {
    item.deletedAt = deletedAt;
    item.deletedByCollectionId = id;
    item.updatedAt = deletedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("bookmarks", "readwrite")).put(item));
    await enqueue({ entity: "bookmark", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  return target;
}
async function restoreCollection(id, expectedRevision) {
  const target = await request((await store("collections")).get(id));
  if (!target || !target.deletedAt) return null;
  if (expectedRevision != null && Number(target.revision || 0) !== Number(expectedRevision)) return null;
  const source = target.deletedByCollectionId || id;
  const collections = await request((await store("collections")).getAll());
  const bookmarks = await request((await store("bookmarks")).getAll());
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  for (const item of collections.filter((entry) => entry.deletedAt && (entry.deletedByCollectionId || entry.id) === source)) {
    delete item.deletedAt;
    delete item.deletedByCollectionId;
    item.updatedAt = updatedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("collections", "readwrite")).put(item));
    await enqueueLatest({ entity: "collection", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  for (const item of bookmarks.filter((entry) => entry.deletedAt && entry.deletedByCollectionId === source)) {
    delete item.deletedAt;
    delete item.deletedByCollectionId;
    item.updatedAt = updatedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("bookmarks", "readwrite")).put(item));
    await enqueue({ entity: "bookmark", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  return request((await store("collections")).get(id));
}
async function enqueue(value) {
  await request((await store("outbox", "readwrite")).add({ ...value, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "pending" }));
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
}
async function enqueueLatest(value) {
  const db = await database();
  const tx = db.transaction("outbox", "readwrite");
  const outbox = tx.objectStore("outbox");
  const cursor = outbox.openCursor();
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (current) {
      if (current.value?.entity === value.entity && current.value?.id === value.id) current.delete();
      current.continue();
      return;
    }
    outbox.add({ ...value, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "pending" });
  };
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("\u4FDD\u5B58\u540C\u6B65\u961F\u5217\u5931\u8D25"));
  });
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
}
async function syncSettings() {
  const value = await request((await store("settings")).get("sync"));
  return { enabled: value?.enabled === true, intervalMinutes: Math.max(1, Number(value?.intervalMinutes) || 15), cursor: value?.cursor || "" };
}
async function setSyncSettings(input) {
  const current = await syncSettings();
  const value = { ...current, ...input, intervalMinutes: Math.max(1, Number(input.intervalMinutes ?? current.intervalMinutes) || 15) };
  await request((await store("settings", "readwrite")).put(value, "sync"));
  return value;
}
async function listConflicts() {
  return request((await store("conflicts")).getAll());
}
async function resolveConflict(key, choice) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const conflictStore = db.transaction("conflicts").objectStore("conflicts");
    const read = conflictStore.get(key);
    read.onerror = () => reject(read.error);
    read.onsuccess = () => {
      const conflict = read.result;
      if (!conflict) return resolve(null);
      const entityStoreName = conflict.entity === "bookmark" ? "bookmarks" : "collections";
      const tx = db.transaction([entityStoreName, "outbox", "conflicts"], "readwrite");
      const entityStore = tx.objectStore(entityStoreName);
      const outboxStore = tx.objectStore("outbox");
      const selected = typeof choice === "string" ? choice === "cloud" ? conflict.remote : conflict.local : conflict.entity === "bookmark" ? mergeBookmarkConflict(conflict.local, conflict.remote, choice) : conflict.local;
      if (!selected) {
        tx.abort();
        resolve(null);
        return;
      }
      const baseRevision = Number(conflict.remote?.revision || 0);
      const record = { ...selected, id: conflict.id, revision: baseRevision + 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      let result = record;
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(result);
      const cursor = outboxStore.openCursor();
      cursor.onerror = () => tx.abort();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (current) {
          if (current.value?.entity === conflict.entity && current.value?.id === conflict.id) current.delete();
          current.continue();
          return;
        }
        entityStore.put(record);
        outboxStore.add({ entity: conflict.entity, id: conflict.id, baseRevision, record, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "pending" });
        tx.objectStore("conflicts").delete(key);
      };
    };
  });
}
async function outboxItems() {
  return request((await store("outbox")).getAll());
}
async function applyRemoteRecord(entity, record) {
  await request((await store(entity === "bookmark" ? "bookmarks" : "collections", "readwrite")).put(record));
}
async function outboxFor(entity, recordId) {
  return (await outboxItems()).filter((item) => item.entity === entity && item.id === recordId);
}
async function removeOutbox(id) {
  await request((await store("outbox", "readwrite")).delete(id));
}
async function saveConflict(value) {
  await request((await store("conflicts", "readwrite")).put({ ...value, key: `${value.entity}:${value.id}` }));
}
async function importLibrary(data) {
  await ensureDefaults();
  const collections = data.collections || [];
  const bookmarks = data.bookmarks || data.items || [];
  for (const collection of collections) if (collection.name) await saveCollection(collection, { enqueueSync: false });
  for (const bookmark of bookmarks) if (bookmark.link) await saveBookmark(bookmark, { enqueueSync: false });
  await initialize();
  return { bookmarks: bookmarks.length, collections: collections.length };
}
async function exportLibrary() {
  return { format: "private-bookmarks/v1", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), bookmarks: await request((await store("bookmarks")).getAll()), collections: await request((await store("collections")).getAll()), preferences: await getPreferences() };
}
async function replaceLibrary(data) {
  await request((await store("bookmarks", "readwrite")).clear());
  await request((await store("collections", "readwrite")).clear());
  await request((await store("settings", "readwrite")).delete("preferences"));
  await importLibrary(data);
  if (data.preferences) {
    const preferences = { ...DEFAULT_PREFERENCES, ...data.preferences };
    await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  }
}
async function mergeLibrary(data) {
  const currentBookmarks = new Map((await request((await store("bookmarks")).getAll())).map((item) => [item.id, item]));
  const currentCollections = new Map((await request((await store("collections")).getAll())).map((item) => [item.id, item]));
  const collectionIds = /* @__PURE__ */ new Map();
  for (const incoming of data.collections || []) {
    const current = currentCollections.get(incoming.id);
    if (!current) {
      await request((await store("collections", "readwrite")).put(incoming));
      collectionIds.set(incoming.id, incoming.id);
    } else if (JSON.stringify(current) !== JSON.stringify(incoming)) {
      const copy = { ...incoming, id: crypto.randomUUID(), name: `${incoming.name}\uFF08\u6062\u590D\u526F\u672C\uFF09`, parentId: null };
      await request((await store("collections", "readwrite")).put(copy));
      collectionIds.set(incoming.id, copy.id);
    } else collectionIds.set(incoming.id, incoming.id);
  }
  for (const incoming of data.bookmarks || []) {
    const current = currentBookmarks.get(incoming.id);
    if (!current) await saveBookmark({ ...incoming, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId }, { enqueueSync: false });
    else if (JSON.stringify(current) !== JSON.stringify(incoming)) await saveBookmark({ ...incoming, id: crypto.randomUUID(), title: `${incoming.title}\uFF08\u6062\u590D\u526F\u672C\uFF09`, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId }, { enqueueSync: true });
  }
  await initialize();
}
async function webdavSettings() {
  const value = await request((await store("settings")).get("webdav"));
  return { enabled: value?.enabled === true, endpoint: value?.endpoint || "", username: value?.username || "", password: value?.password || "", encryptionPassword: value?.encryptionPassword || "", retention: Math.max(3, Math.min(50, Number(value?.retention) || 10)), lastBackupAt: value?.lastBackupAt || "", lastError: value?.lastError || "" };
}
async function setWebdavSettings(input) {
  const value = { ...await webdavSettings(), ...input };
  value.retention = Math.max(3, Math.min(50, Number(value.retention) || 10));
  await request((await store("settings", "readwrite")).put(value, "webdav"));
  return value;
}
export {
  DEFAULT_PREFERENCES,
  applyMigrationPackage,
  applyRemoteRecord,
  batchBookmark,
  batchBookmarks,
  ensureDefaults,
  exportLibrary,
  exportMigrationPackage,
  getActionMode,
  getPreferences,
  importLibrary,
  importMigrationPackage,
  initialize,
  initialized,
  listBookmarks,
  listCollections,
  listConflicts,
  mergeLibrary,
  outboxFor,
  outboxItems,
  previewMigrationPackage,
  removeOutbox,
  replaceLibrary,
  resolveConflict,
  restoreBookmark,
  restoreCollection,
  saveBookmark,
  saveBookmarkWithCollection,
  saveCollection,
  saveConflict,
  setActionMode,
  setSyncSettings,
  setWebdavSettings,
  syncSettings,
  trashBookmark,
  trashCollection,
  updatePreferences,
  webdavSettings
};
