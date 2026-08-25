import { applyBookmarkBatch, conflictRecoveryCopies, mergeBookmarkConflict, normalizeBookmark } from "./local-model.js";
import { updateConflictBadge } from "./conflict-badge.js";
import { collectionShareText, collectionSubtreeIds, emptyCollectionRoots, mergeCollectionRecords, positionBetween, validateCollectionChange } from "./collection-model.js";
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
  layoutByScope: {},
  collectionGroups: [{ id: "default", title: "收藏", hidden: false }],
  collectionGroupByCollectionId: {}
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
  return items.filter((item) => trash ? Boolean(item.deletedAt) && !item.purgedAt && !item.permanentDeletedAt : !item.deletedAt && !item.purgedAt && !item.permanentDeletedAt).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
async function healthCandidates(before, scope = null) {
  const value = typeof scope === "string" ? { collectionId: scope } : scope || {};
  const ids = Array.isArray(value.ids) ? new Set(value.ids) : null;
  let collectionIds = null;
  if (value.collectionId) collectionIds = collectionSubtreeIds(await listCollections(), value.collectionId);
  return (await listBookmarks()).filter((item) =>
    (value.force || !item.health?.checkedAt || item.health.checkedAt < before)
    && (!ids || ids.has(item.id))
    && (!value.favorite || item.favorite)
    && (!collectionIds || collectionIds.has(item.collectionId))
  );
}
async function updateHealth(id, health) {
  const item = await request((await store("bookmarks")).get(id));
  if (!item || item.deletedAt || item.purgedAt || item.permanentDeletedAt) return null;
  return saveBookmark({ ...item, health: { ...item.health, ...health, checkedAt: new Date().toISOString() } });
}
async function listCollections({ trash = false } = {}) {
  const items = await request((await store("collections")).getAll());
  if (trash) {
    const deleted = new Set(items.filter((item) => item.deletedAt).map((item) => item.id));
    return items.filter((item) => item.deletedAt && !deleted.has(item.parentId || "")).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }
  return items.filter((item) => !item.deletedAt).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
}
async function getPreferences() {
  const value = await request((await store("settings")).get("preferences"));
  return { ...DEFAULT_PREFERENCES, ...value || {}, revision: Number(value?.revision) || 0 };
}
async function updatePreferences(expectedRevision, changes) {
  await assertEditable();
  const current = await getPreferences();
  if (current.revision !== Number(expectedRevision)) return { conflict: current };
  const next = { ...current, ...changes };
  delete next.revision;
  const preferences = { ...next, revision: current.revision + 1 };
  await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  return { preferences };
}
async function saveBookmark(input, { enqueueSync = true, recovery = false } = {}) {
  await assertEditable(recovery);
  await ensureDefaults();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = input.id ? await request((await store("bookmarks")).get(input.id)) : void 0;
  const item = normalizeBookmark(input, existing, now);
  item.revision = existing ? Number(existing.revision || 0) + 1 : Math.max(1, Number(item.revision) || 1);
  await request((await store("bookmarks", "readwrite")).put(item));
  if (enqueueSync) await enqueueLatest({ entity: "bookmark", id: item.id, baseRevision: Number(existing?.revision || 0), record: item });
  return item;
}
async function saveBookmarkWithCollection(input, collection) {
  await assertEditable();
  await ensureDefaults();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const db = await database();
  const existing = input.id ? await request(db.transaction("bookmarks").objectStore("bookmarks").get(input.id)) : void 0;
  const existingCollection = collection?.id ? await request(db.transaction("collections").objectStore("collections").get(collection.id)) : void 0;
  const knownCollections = collection ? await request(db.transaction("collections").objectStore("collections").getAll()) : [];
  const validatedCollection = collection ? validateCollectionChange(knownCollections, collection, existingCollection) : null;
  const item = normalizeBookmark(input, existing, now);
  const collectionItem = collection ? {
    id: validatedCollection.id || crypto.randomUUID(),
    name: validatedCollection.name,
    parentId: validatedCollection.parentId,
    createdAt: existingCollection?.createdAt || collection.createdAt || now,
    updatedAt: existingCollection ? now : collection.updatedAt || now,
    position: validatedCollection.position,
    ...(validatedCollection.icon ? { icon: validatedCollection.icon } : {}),
    ...(collection.source !== undefined || existingCollection?.source !== undefined ? { source: collection.source ?? existingCollection?.source } : {}),
    ...(collection.deletedAt || existingCollection?.deletedAt ? { deletedAt: collection.deletedAt ?? existingCollection?.deletedAt } : {}),
    ...(collection.deletedByCollectionId || existingCollection?.deletedByCollectionId ? { deletedByCollectionId: collection.deletedByCollectionId ?? existingCollection?.deletedByCollectionId } : {}),
    revision: existingCollection ? Number(existingCollection.revision || 0) + 1 : Math.max(1, Number(collection.revision) || 1)
  } : null;
  item.revision = existing ? Number(existing.revision || 0) + 1 : Math.max(1, Number(item.revision) || 1);
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
  await assertEditable();
  const target = await request((await store("bookmarks")).get(id));
  if (!target || target.purgedAt || target.permanentDeletedAt) return null;
  if (target.deletedAt) return target;
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
  await assertEditable();
  const target = await request((await store("bookmarks")).get(id));
  if (!target || target.permanentDeletedAt) return null;
  if (!target.deletedAt) return target;
  delete target.deletedAt;
  delete target.purgedAt;
  target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const baseRevision = Number(target.revision || 0);
  target.revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueueLatest({ entity: "bookmark", id, baseRevision, record: target });
  return target;
}
async function permanentDeleteBookmark(id) {
  return batchBookmark(id, { type: "permanentDelete" });
}
async function batchBookmark(id, action) {
  await assertEditable();
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
  if (action.type === "permanentDelete" && target.permanentDeletedAt) return target;
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
async function saveCollection(input, { enqueueSync = true, expectedRevision, allowDeletedParent = false, allowUnsorted = false, recovery = false } = {}) {
  await assertEditable(recovery);
  const raw = input && typeof input === "object" ? input : {};
  const id = raw.id || crypto.randomUUID();
  const collectionStore = await store("collections");
  const existing = await request(collectionStore.get(id));
  if (expectedRevision != null && existing && Number(existing.revision || 0) !== Number(expectedRevision)) {
    const error = new Error("收藏夹已被其他操作修改，请刷新后重试");
    error.code = "editing_conflict";
    throw error;
  }
  const collections = await request(collectionStore.getAll());
  const validated = validateCollectionChange(collections, { ...raw, id }, existing, { allowDeletedParent, allowUnsorted });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const position = raw.position === undefined && !existing
    ? Math.max(-1, ...collections.filter((item) => !item.deletedAt && (item.parentId || null) === validated.parentId).map((item) => Number(item.position) || 0)) + 1
    : validated.position;
  const item = {
    id,
    name: validated.name,
    parentId: validated.parentId,
    position,
    ...(validated.icon ? { icon: validated.icon } : {}),
    ...(raw.source !== undefined || existing?.source !== undefined ? { source: raw.source ?? existing?.source } : {}),
    ...(raw.deletedAt || existing?.deletedAt ? { deletedAt: raw.deletedAt ?? existing?.deletedAt } : {}),
    ...(raw.deletedByCollectionId || existing?.deletedByCollectionId ? { deletedByCollectionId: raw.deletedByCollectionId ?? existing?.deletedByCollectionId } : {}),
    createdAt: existing?.createdAt || raw.createdAt || now,
    updatedAt: existing ? now : raw.updatedAt || now,
    revision: existing ? Number(existing.revision || 0) + 1 : Math.max(1, Number(raw.revision) || 1)
  };
  await request((await store("collections", "readwrite")).put(item));
  if (enqueueSync) await enqueueLatest({ entity: "collection", id: item.id, baseRevision: Number(existing?.revision || 0), record: item });
  return item;
}
async function trashCollection(id, expectedRevision) {
  await assertEditable();
  const target = await request((await store("collections")).get(id));
  if (!target || target.deletedAt || id === "unsorted") return null;
  if (expectedRevision != null && Number(target.revision || 0) !== Number(expectedRevision)) {
    const error = new Error("收藏夹已被其他操作修改，请刷新后重试");
    error.code = "editing_conflict";
    throw error;
  }
  const all = await request((await store("collections")).getAll());
  const ids = collectionSubtreeIds(all, id);
  const deletedAt = (/* @__PURE__ */ new Date()).toISOString();
  const bookmarks = await request((await store("bookmarks")).getAll());
  for (const item of all) if (ids.has(item.id) && !item.deletedAt) {
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
  await assertEditable();
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

async function moveCollection(id, { parentId, targetId, before = true, expectedRevision } = {}) {
  const collectionStore = await store("collections");
  const all = await request(collectionStore.getAll());
  const current = all.find((item) => item.id === id);
  if (!current || current.deletedAt || id === "unsorted") return null;
  if (expectedRevision != null && Number(current.revision || 0) !== Number(expectedRevision)) {
    const error = new Error("收藏夹已被其他操作修改，请刷新后重试");
    error.code = "editing_conflict";
    throw error;
  }
  const nextParentId = parentId === undefined ? current.parentId || null : parentId || null;
  if (targetId && targetId !== id && parentId === undefined) {
    const target = all.find((item) => item.id === targetId && !item.deletedAt);
    if (!target || (target.parentId || null) !== nextParentId) throw new TypeError("排序目标必须是同级收藏夹");
  }
  const position = targetId && targetId !== id
    ? positionBetween(all, id, targetId, before, nextParentId)
    : positionBetween(all, id, null, true, nextParentId);
  return saveCollection({ ...current, parentId: nextParentId, position }, { expectedRevision });
}

async function previewCollectionMerge(sourceIds, targetId) {
  const collections = await request((await store("collections")).getAll());
  const bookmarks = await request((await store("bookmarks")).getAll());
  const plan = mergeCollectionRecords(collections, bookmarks, sourceIds, targetId);
  return {
    target: plan.target,
    sourceIds: plan.removedIds,
    movedBookmarks: plan.movedBookmarks,
    movedCollections: plan.movedCollections,
  };
}

async function mergeCollections(sourceIds, targetId) {
  const db = await database();
  const collections = await request(db.transaction("collections").objectStore("collections").getAll());
  const bookmarks = await request(db.transaction("bookmarks").objectStore("bookmarks").getAll());
  const plan = mergeCollectionRecords(collections, bookmarks, sourceIds, targetId);
  const collectionById = new Map(collections.map((item) => [item.id, item]));
  const bookmarkById = new Map(bookmarks.map((item) => [item.id, item]));
  for (const item of plan.collections) {
    if (JSON.stringify(item) !== JSON.stringify(collectionById.get(item.id))) await saveCollection(item);
  }
  for (const item of plan.bookmarks) {
    if (JSON.stringify(item) !== JSON.stringify(bookmarkById.get(item.id))) await saveBookmark(item);
  }
  return { target: await request((await store("collections")).get(targetId)), sourceIds: plan.removedIds, movedBookmarks: plan.movedBookmarks, movedCollections: plan.movedCollections };
}

async function sortCollections() {
  const items = await request((await store("collections")).getAll());
  const groups = new Map();
  for (const item of items) if (!item.deletedAt && item.id !== "unsorted") {
    const key = item.parentId || null;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  let changed = 0;
  for (const siblings of groups.values()) {
    siblings.sort((left, right) => String(left.name).localeCompare(String(right.name), "zh-CN") || left.id.localeCompare(right.id));
    for (let position = 0; position < siblings.length; position += 1) {
      if (siblings[position].position === position) continue;
      await saveCollection({ ...siblings[position], position });
      changed += 1;
    }
  }
  return { changed };
}

async function cleanEmptyCollections() {
  const collections = await request((await store("collections")).getAll());
  const bookmarks = await request((await store("bookmarks")).getAll());
  const roots = emptyCollectionRoots(collections, bookmarks);
  for (const root of roots) await trashCollection(root.id);
  return { removedIds: roots.flatMap((root) => [...collectionSubtreeIds(collections, root.id)]), removed: roots.length };
}

async function shareCollection(id) {
  const collections = await request((await store("collections")).getAll());
  const collection = collections.find((item) => item.id === id && !item.deletedAt);
  if (!collection) return null;
  const ids = collectionSubtreeIds(collections, id);
  const bookmarks = (await request((await store("bookmarks")).getAll())).filter((item) => ids.has(item.collectionId) && !item.deletedAt);
  return collectionShareText(collection, bookmarks);
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
async function recoveryState() {
  return (await request((await store("settings")).get("recovery"))) === true;
}
async function setRecoveryState(value) {
  await request((await store("settings", "readwrite")).put(Boolean(value), "recovery"));
  return Boolean(value);
}
async function assertEditable(recovery = false) {
  if (!recovery && await recoveryState()) throw Object.assign(new Error("恢复期间不能编辑资料库"), { code: "recovery_in_progress" });
}
async function healthProgress() {
  return (await request((await store("settings")).get("healthProgress"))) || { status: "idle", checked: 0, total: 0, errors: 0, updatedAt: "" };
}
async function setHealthProgress(value) {
  const next = { ...await healthProgress(), ...value, updatedAt: new Date().toISOString() };
  await request((await store("settings", "readwrite")).put(next, "healthProgress"));
  return next;
}
async function listConflicts() {
  return request((await store("conflicts")).getAll());
}
async function resolveConflict(key, choice) {
  await assertEditable();
  const db = await database();
  const result = await new Promise((resolve, reject) => {
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
      const recoveries = conflictRecoveryCopies(conflict, choice);
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
        for (const recovery of recoveries) {
          entityStore.put(recovery);
          outboxStore.add({ entity: conflict.entity, id: recovery.id, baseRevision: 0, record: recovery, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "pending" });
        }
        tx.objectStore("conflicts").delete(key);
      };
    };
  });
  await updateConflictBadge((await listConflicts()).length);
  return result;
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
  await updateConflictBadge((await listConflicts()).length);
}
async function importLibrary(data, { recovery = false } = {}) {
  await assertEditable(recovery);
  await ensureDefaults();
  const collections = Array.isArray(data.collections) ? [...data.collections] : [];
  const collectionCount = collections.length;
  const bookmarks = data.bookmarks || data.items || [];
  const known = await request((await store("collections")).getAll());
  const savedIds = new Set(known.map((item) => item.id));
  const orderedCollections = [];
  while (collections.length) {
    const index = collections.findIndex((item) => !item.parentId || savedIds.has(item.parentId));
    if (index < 0) throw new TypeError("收藏夹层级无效");
    const [collection] = collections.splice(index, 1);
    if (!collection.name) continue;
    orderedCollections.push(collection);
    savedIds.add(collection.id);
 }
  for (const collection of orderedCollections) await saveCollection(collection, { enqueueSync: false, allowDeletedParent: true, allowUnsorted: true, recovery });
  for (const bookmark of bookmarks) if (bookmark.link) await saveBookmark(bookmark, { enqueueSync: false, recovery });
  await initialize();
  return { bookmarks: bookmarks.length, collections: collectionCount };
}
async function exportLibrary() {
  return { format: "private-bookmarks/v1", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), bookmarks: await request((await store("bookmarks")).getAll()), collections: await request((await store("collections")).getAll()), preferences: await getPreferences() };
}
async function replaceLibrary(data, { recovery = false } = {}) {
  await assertEditable(recovery);
  await request((await store("bookmarks", "readwrite")).clear());
  await request((await store("collections", "readwrite")).clear());
  await request((await store("settings", "readwrite")).delete("preferences"));
  await importLibrary(data, { recovery });
  if (data.preferences) {
    const preferences = { ...DEFAULT_PREFERENCES, ...data.preferences };
    await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  }
}
async function mergeLibrary(data, { recovery = false } = {}) {
  await assertEditable(recovery);
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
    if (!current) await saveBookmark({ ...incoming, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId }, { enqueueSync: false, recovery });
    else if (JSON.stringify(current) !== JSON.stringify(incoming)) await saveBookmark({ ...incoming, id: crypto.randomUUID(), title: `${incoming.title}\uFF08\u6062\u590D\u526F\u672C\uFF09`, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId }, { enqueueSync: true, recovery });
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
  healthProgress,
  healthCandidates,
  getPreferences,
  cleanEmptyCollections,
  importLibrary,
  importMigrationPackage,
  initialize,
  initialized,
  listBookmarks,
  listCollections,
  listConflicts,
  mergeLibrary,
  mergeCollections,
  moveCollection,
  outboxFor,
  outboxItems,
  previewMigrationPackage,
  previewCollectionMerge,
  recoveryState,
  removeOutbox,
  replaceLibrary,
  resolveConflict,
  restoreBookmark,
  restoreCollection,
  saveBookmark,
  saveBookmarkWithCollection,
  saveCollection,
  shareCollection,
  sortCollections,
  saveConflict,
  setActionMode,
  setHealthProgress,
  setRecoveryState,
  setSyncSettings,
  setWebdavSettings,
  syncSettings,
  trashBookmark,
  permanentDeleteBookmark,
  trashCollection,
  updatePreferences,
  updateHealth,
  webdavSettings
};
