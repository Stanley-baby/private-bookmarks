export type CoverRef = { id?: string; url?: string; contentType?: string; size?: number };
export type Bookmark = {
  id: string;
  link: string;
  title: string;
  description: string;
  note: string;
  collectionId: string;
  tags: string[];
  cover?: string;
  coverRef?: CoverRef;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  purgedAt?: string;
  permanentDeletedAt?: string;
  revision?: number;
};

export type Collection = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt?: string; deletedAt?: string; revision?: number };
export type ActionMode = "popup" | "sidepanel";
import { applyBookmarkBatch, mergeBookmarkConflict, normalizeBookmark } from "./model.js";

declare const chrome: any;

const DATABASE = "private-bookmarks-local";
const VERSION = 2;

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, VERSION);
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

async function store(name: "bookmarks" | "collections" | "settings" | "outbox" | "conflicts", mode: IDBTransactionMode = "readonly") {
  return (await database()).transaction(name, mode).objectStore(name);
}

export async function initialized() {
  return Boolean(await request((await store("settings")).get("initialized")));
}

export async function initialize() {
  await request((await store("settings", "readwrite")).put(true, "initialized"));
}

export async function getActionMode(): Promise<ActionMode | null> {
  const value = await request<unknown>((await store("settings")).get("actionMode"));
  return value === "popup" || value === "sidepanel" ? value : null;
}

export async function setActionMode(mode: ActionMode) {
  if (mode !== "popup" && mode !== "sidepanel") throw new TypeError("无效的操作模式");
  await request((await store("settings", "readwrite")).put(mode, "actionMode"));
  return mode;
}

export async function listBookmarks({ trash = false } = {}) {
  const items = await request<Bookmark[]>((await store("bookmarks")).getAll());
  return items.filter((item) => trash ? Boolean(item.deletedAt) && !item.purgedAt && !item.permanentDeletedAt : !item.deletedAt && !item.purgedAt && !item.permanentDeletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listCollections() {
  const items = await request<Collection[]>((await store("collections")).getAll());
  return items.filter((item) => !item.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveBookmark(input: Partial<Bookmark> & { link: string }, { enqueueSync = true } = {}) {
  const now = new Date().toISOString();
  const existing = input.id ? await request<Bookmark | undefined>((await store("bookmarks")).get(input.id)) : undefined;
  const item: Bookmark = normalizeBookmark(input, existing, now);
  (item as Bookmark & { revision?: number }).revision = Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0) + 1;
  await request((await store("bookmarks", "readwrite")).put(item));
  if (enqueueSync) await enqueue({ entity: "bookmark", id: item.id, baseRevision: Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0), record: item });
  return item;
}

export async function saveBookmarkWithCollection(
  input: Partial<Bookmark> & { link: string },
  collection?: Partial<Collection> & { name: string },
) {
  const now = new Date().toISOString();
  const db = await database();
  const existing = input.id ? await request<Bookmark | undefined>(db.transaction("bookmarks").objectStore("bookmarks").get(input.id)) : undefined;
  const item = normalizeBookmark(input, existing, now);
  const collectionItem = collection ? {
    id: collection.id || crypto.randomUUID(),
    name: collection.name.trim(),
    parentId: collection.parentId || null,
    createdAt: collection.createdAt || now,
    updatedAt: now,
    revision: Number(collection.revision || 0) + 1,
  } as Collection : null;
  (item as Bookmark & { revision?: number }).revision = Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0) + 1;

  const tx = db.transaction(["bookmarks", "collections", "outbox"], "readwrite");
  tx.objectStore("bookmarks").put(item);
  if (collectionItem) tx.objectStore("collections").put(collectionItem);
  const outbox = tx.objectStore("outbox");
  outbox.add({ entity: "bookmark", id: item.id, baseRevision: Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0), record: item, createdAt: now, status: "pending" });
  if (collectionItem) outbox.add({ entity: "collection", id: collectionItem.id, baseRevision: 0, record: collectionItem, createdAt: now, status: "pending" });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存建议失败"));
  });
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
  return { bookmark: item, collection: collectionItem };
}

export async function trashBookmark(id: string) {
  const target = await request<Bookmark | undefined>((await store("bookmarks")).get(id));
  if (!target) return;
  target.deletedAt = target.updatedAt = new Date().toISOString();
  delete target.purgedAt;
  delete target.permanentDeletedAt;
  const baseRevision = Number((target as Bookmark & { revision?: number }).revision || 0);
  (target as Bookmark & { revision?: number }).revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueue({ entity: "bookmark", id, baseRevision, record: target });
}

export async function restoreBookmark(id: string) {
  const target = await request<Bookmark | undefined>((await store("bookmarks")).get(id));
  if (!target || target.permanentDeletedAt) return;
  delete target.deletedAt;
  delete target.purgedAt;
  target.updatedAt = new Date().toISOString();
  const baseRevision = Number((target as Bookmark & { revision?: number }).revision || 0);
  (target as Bookmark & { revision?: number }).revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueue({ entity: "bookmark", id, baseRevision, record: target });
}

export type BookmarkBatchAction =
  | { type: "move"; collectionId: string }
  | { type: "tags"; mode: "add" | "remove"; tags: string[] }
  | { type: "trash" }
  | { type: "restore" }
  | { type: "permanentDelete" };

export async function batchBookmark(id: string, action: BookmarkBatchAction) {
  const target = await request<Bookmark | undefined>((await store("bookmarks")).get(id));
  if (!target) return null;
  if (action.type === "move" && action.collectionId !== "unsorted") {
    const destination = await request<Collection | undefined>((await store("collections")).get(action.collectionId));
    if (!destination || destination.deletedAt) throw new TypeError("收藏夹不存在");
  }
  if (action.type === "trash") { await trashBookmark(id); return request<Bookmark | undefined>((await store("bookmarks")).get(id)); }
  if (action.type === "restore") { await restoreBookmark(id); return request<Bookmark | undefined>((await store("bookmarks")).get(id)); }
  const next = applyBookmarkBatch(target, action, new Date().toISOString()) as Bookmark;
  await request((await store("bookmarks", "readwrite")).put(next));
  await enqueue({ entity: "bookmark", id, baseRevision: Number(target.revision || 0), record: next });
  return next;
}

export async function batchBookmarks(ids: string[], action: BookmarkBatchAction) {
  const changed: Bookmark[] = [];
  for (const id of [...new Set(ids)]) {
    const item = await batchBookmark(id, action);
    if (item) changed.push(item);
  }
  return changed;
}

export async function saveCollection(input: Partial<Collection> & { name: string }, { enqueueSync = true } = {}) {
  const id = input.id || crypto.randomUUID();
  const existing = await request<Collection | undefined>((await store("collections")).get(id));
  const item: Collection = { id, name: input.name.trim(), parentId: input.parentId || null, createdAt: existing?.createdAt || input.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), revision: Number((existing as (Collection & { revision?: number }) | undefined)?.revision || 0) + 1 } as Collection;
  await request((await store("collections", "readwrite")).put(item));
  if (enqueueSync) await enqueue({ entity: "collection", id: item.id, baseRevision: Number((existing as (Collection & { revision?: number }) | undefined)?.revision || 0), record: item });
  return item;
}

async function enqueue(value: { entity: "bookmark" | "collection"; id: string; baseRevision: number; record: Bookmark | Collection }) {
  await request((await store("outbox", "readwrite")).add({ ...value, createdAt: new Date().toISOString(), status: "pending" }));
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
}

export async function syncSettings() {
  const value = await request<any>((await store("settings")).get("sync"));
  return { enabled: value?.enabled === true, intervalMinutes: Math.max(1, Number(value?.intervalMinutes) || 15), cursor: value?.cursor || "" };
}

export async function setSyncSettings(input: Partial<{ enabled: boolean; intervalMinutes: number; cursor: string }>) {
  const current = await syncSettings();
  const value = { ...current, ...input, intervalMinutes: Math.max(1, Number(input.intervalMinutes ?? current.intervalMinutes) || 15) };
  await request((await store("settings", "readwrite")).put(value, "sync"));
  return value;
}

export async function listConflicts() {
  return request<any[]>((await store("conflicts")).getAll());
}

export type BookmarkConflictChoices = Partial<Record<"title" | "link" | "description" | "note" | "tags" | "collectionId", "local" | "cloud">>;

export async function resolveConflict(key: string, choice: "local" | "cloud" | BookmarkConflictChoices) {
  const db = await database();
  return new Promise<any>((resolve, reject) => {
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
      const selected = typeof choice === "string"
        ? (choice === "cloud" ? conflict.remote : conflict.local)
        : conflict.entity === "bookmark"
          ? mergeBookmarkConflict(conflict.local, conflict.remote, choice)
          : conflict.local;
      if (!selected) { tx.abort(); resolve(null); return; }
      const baseRevision = Number(conflict.remote?.revision || 0);
      const record = { ...selected, id: conflict.id, revision: baseRevision + 1, updatedAt: new Date().toISOString() };
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
        outboxStore.add({ entity: conflict.entity, id: conflict.id, baseRevision, record, createdAt: new Date().toISOString(), status: "pending" });
        tx.objectStore("conflicts").delete(key);
      };
    };
  });
}

export async function outboxItems() { return request<any[]>((await store("outbox")).getAll()); }

export async function applyRemoteRecord(entity: "bookmark" | "collection", record: any) {
  await request((await store(entity === "bookmark" ? "bookmarks" : "collections", "readwrite")).put(record));
}

export async function outboxFor(entity: "bookmark" | "collection", recordId: string) {
  return (await outboxItems()).filter((item) => item.entity === entity && item.id === recordId);
}

export async function removeOutbox(id: number) { await request((await store("outbox", "readwrite")).delete(id)); }

export async function saveConflict(value: any) { await request((await store("conflicts", "readwrite")).put({ ...value, key: `${value.entity}:${value.id}` })); }

export async function importLibrary(data: { bookmarks?: Partial<Bookmark>[]; items?: Partial<Bookmark>[]; collections?: Partial<Collection>[] }) {
  const collections = data.collections || [];
  const bookmarks = data.bookmarks || data.items || [];
  for (const collection of collections) if (collection.name) await saveCollection(collection as Partial<Collection> & { name: string }, { enqueueSync: false });
  for (const bookmark of bookmarks) if (bookmark.link) await saveBookmark(bookmark as Partial<Bookmark> & { link: string }, { enqueueSync: false });
  await initialize();
  return { bookmarks: bookmarks.length, collections: collections.length };
}

export async function exportLibrary() {
  return { version: 1, exportedAt: new Date().toISOString(), bookmarks: await request<Bookmark[]>((await store("bookmarks")).getAll()), collections: await request<Collection[]>((await store("collections")).getAll()) };
}

export async function replaceLibrary(data: { bookmarks?: Bookmark[]; collections?: Collection[] }) {
  await request((await store("bookmarks", "readwrite")).clear());
  await request((await store("collections", "readwrite")).clear());
  await importLibrary(data);
}

export async function mergeLibrary(data: { bookmarks?: Bookmark[]; collections?: Collection[] }) {
  const currentBookmarks = new Map((await request<Bookmark[]>((await store("bookmarks")).getAll())).map((item) => [item.id, item]));
  const currentCollections = new Map((await request<Collection[]>((await store("collections")).getAll())).map((item) => [item.id, item]));
  const collectionIds = new Map<string, string>();
  for (const incoming of data.collections || []) {
    const current = currentCollections.get(incoming.id);
    if (!current) {
      await request((await store("collections", "readwrite")).put(incoming));
      collectionIds.set(incoming.id, incoming.id);
    } else if (JSON.stringify(current) !== JSON.stringify(incoming)) {
      const copy = { ...incoming, id: crypto.randomUUID(), name: `${incoming.name}（恢复副本）`, parentId: null };
      await request((await store("collections", "readwrite")).put(copy));
      collectionIds.set(incoming.id, copy.id);
    } else collectionIds.set(incoming.id, incoming.id);
  }
  for (const incoming of data.bookmarks || []) {
    const current = currentBookmarks.get(incoming.id);
    if (!current) await saveBookmark({ ...incoming, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId } as Partial<Bookmark> & { link: string }, { enqueueSync: false });
    else if (JSON.stringify(current) !== JSON.stringify(incoming)) await saveBookmark({ ...incoming, id: crypto.randomUUID(), title: `${incoming.title}（恢复副本）`, collectionId: collectionIds.get(incoming.collectionId) || incoming.collectionId }, { enqueueSync: true });
  }
  await initialize();
}

export async function webdavSettings() {
  const value = await request<any>((await store("settings")).get("webdav"));
  return { enabled: value?.enabled === true, endpoint: value?.endpoint || "", username: value?.username || "", password: value?.password || "", encryptionPassword: value?.encryptionPassword || "", retention: Math.max(3, Math.min(50, Number(value?.retention) || 10)), lastBackupAt: value?.lastBackupAt || "", lastError: value?.lastError || "" };
}

export async function setWebdavSettings(input: Record<string, unknown>) {
  const value = { ...(await webdavSettings()), ...input };
  value.retention = Math.max(3, Math.min(50, Number(value.retention) || 10));
  await request((await store("settings", "readwrite")).put(value, "webdav"));
  return value;
}
