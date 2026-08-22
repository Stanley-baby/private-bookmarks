export type CoverRef = { id?: string; url?: string; contentType?: string; size?: number };
export type Bookmark = {
  id: string;
  link: string;
  title: string;
  description: string;
  note: string;
  collectionId: string;
  tags: string[];
  type?: string;
  language?: string;
  reminder?: string;
  media?: string[];
  highlights?: unknown[];
  favorite?: boolean;
  position?: number;
  health?: { status?: string; checkedAt?: string | null; finalUrl?: string };
  cover?: string;
  coverRef?: CoverRef;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  purgedAt?: string;
  permanentDeletedAt?: string;
  deletedByCollectionId?: string;
  revision?: number;
};

export type Collection = { id: string; name: string; parentId: string | null; position?: number; createdAt: string; updatedAt?: string; deletedAt?: string; deletedByCollectionId?: string; revision?: number };
export type ActionMode = "popup" | "sidepanel";
import { applyBookmarkBatch, mergeBookmarkConflict, normalizeBookmark } from "./model.js";
import { LOCAL_DATABASE, LOCAL_DATABASE_VERSION, openLocalDatabase } from "../../extension/local-storage.js";

export {
  exportMigrationPackage,
  importMigrationPackage,
} from "../../extension/migration-package.js";

declare const chrome: any;

export const DEFAULT_PREFERENCES = {
  language: "zh-Hans",
  instanceName: "私有书签",
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
};

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function database() {
  return openLocalDatabase({ databaseName: LOCAL_DATABASE, version: LOCAL_DATABASE_VERSION });
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

/** Ensure the local-first library has the same built-in collection as the Worker API. */
export async function ensureDefaults() {
  const current = await request<Collection | undefined>((await store("collections")).get("unsorted"));
  if (!current) {
    const createdAt = new Date().toISOString();
    await request((await store("collections", "readwrite")).put({ id: "unsorted", name: "未分类", parentId: null, position: 0, createdAt, updatedAt: createdAt, revision: 1 } satisfies Collection));
  }
  await initialize();
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

export async function listCollections({ trash = false } = {}) {
  const items = await request<Collection[]>((await store("collections")).getAll());
  if (trash) {
    const deleted = new Set(items.filter((item) => item.deletedAt).map((item) => item.id));
    return items.filter((item) => item.deletedAt && !deleted.has(item.parentId || ""))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return items.filter((item) => !item.deletedAt).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
}

export async function getPreferences() {
  const value = await request<any>((await store("settings")).get("preferences"));
  return { ...DEFAULT_PREFERENCES, ...(value || {}), revision: Number(value?.revision) || 0 };
}

export async function updatePreferences(expectedRevision: number, changes: Record<string, unknown>) {
  const current = await getPreferences();
  if (current.revision !== Number(expectedRevision)) return { conflict: current };
  const next = { ...current, ...changes } as Record<string, unknown>;
  delete next.revision;
  const preferences = { ...next, revision: current.revision + 1 };
  await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  return { preferences };
}

export async function saveBookmark(input: Partial<Bookmark> & { link: string }, { enqueueSync = true } = {}) {
  await ensureDefaults();
  const now = new Date().toISOString();
  const existing = input.id ? await request<Bookmark | undefined>((await store("bookmarks")).get(input.id)) : undefined;
  const item: Bookmark = normalizeBookmark(input, existing, now);
  (item as Bookmark & { revision?: number }).revision = Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0) + 1;
  await request((await store("bookmarks", "readwrite")).put(item));
  if (enqueueSync) await enqueueLatest({ entity: "bookmark", id: item.id, baseRevision: Number((existing as (Bookmark & { revision?: number }) | undefined)?.revision || 0), record: item });
  return item;
}

export async function saveBookmarkWithCollection(
  input: Partial<Bookmark> & { link: string },
  collection?: Partial<Collection> & { name: string },
) {
  await ensureDefaults();
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
  if (!target) return null;
  target.deletedAt = target.updatedAt = new Date().toISOString();
  delete target.purgedAt;
  delete target.permanentDeletedAt;
  const baseRevision = Number((target as Bookmark & { revision?: number }).revision || 0);
  (target as Bookmark & { revision?: number }).revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueueLatest({ entity: "bookmark", id, baseRevision, record: target });
  return target;
}

export async function restoreBookmark(id: string) {
  const target = await request<Bookmark | undefined>((await store("bookmarks")).get(id));
  if (!target || target.permanentDeletedAt) return null;
  delete target.deletedAt;
  delete target.purgedAt;
  target.updatedAt = new Date().toISOString();
  const baseRevision = Number((target as Bookmark & { revision?: number }).revision || 0);
  (target as Bookmark & { revision?: number }).revision = baseRevision + 1;
  await request((await store("bookmarks", "readwrite")).put(target));
  await enqueueLatest({ entity: "bookmark", id, baseRevision, record: target });
  return target;
}

export type BookmarkBatchAction =
  | { type: "move"; collectionId: string }
  | { type: "tags"; mode: "add" | "remove"; tags: string[] }
  | { type: "trash" }
  | { type: "restore" }
  | { type: "screenshot" }
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
  if (action.type === "screenshot") {
    const media = Array.isArray(target.media) ? [...target.media] : [];
    if (!media.some((value) => value === "<screenshot>" || (value && typeof value === "object" && (value as any).link === "<screenshot>"))) media.push("<screenshot>");
    const next = { ...target, cover: "<screenshot>", media, updatedAt: new Date().toISOString(), revision: Number(target.revision || 0) + 1 };
    await request((await store("bookmarks", "readwrite")).put(next));
    await enqueueLatest({ entity: "bookmark", id, baseRevision: Number(target.revision || 0), record: next });
    return next;
  }
  const next = applyBookmarkBatch(target, action, new Date().toISOString()) as Bookmark;
  await request((await store("bookmarks", "readwrite")).put(next));
  await enqueueLatest({ entity: "bookmark", id, baseRevision: Number(target.revision || 0), record: next });
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
  const item: Collection = { id, name: input.name.trim(), parentId: input.parentId || null, position: input.position ?? existing?.position ?? 0, createdAt: existing?.createdAt || input.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), revision: Number((existing as (Collection & { revision?: number }) | undefined)?.revision || 0) + 1 } as Collection;
  await request((await store("collections", "readwrite")).put(item));
  if (enqueueSync) await enqueue({ entity: "collection", id: item.id, baseRevision: Number((existing as (Collection & { revision?: number }) | undefined)?.revision || 0), record: item });
  return item;
}

export async function trashCollection(id: string) {
  const target = await request<Collection | undefined>((await store("collections")).get(id));
  if (!target || target.deletedAt || id === "unsorted") return null;
  const all = await request<Collection[]>((await store("collections")).getAll());
  const ids = new Set([id]);
  for (const item of all) if (item.parentId && ids.has(item.parentId)) ids.add(item.id);
  const deletedAt = new Date().toISOString();
  const bookmarks = await request<Bookmark[]>((await store("bookmarks")).getAll());
  for (const item of all) if (ids.has(item.id)) {
    item.deletedAt = deletedAt;
    item.deletedByCollectionId = id;
    item.updatedAt = deletedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("collections", "readwrite")).put(item));
    await enqueue({ entity: "collection", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
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

export async function restoreCollection(id: string, expectedRevision?: number) {
  const target = await request<Collection | undefined>((await store("collections")).get(id));
  if (!target || !target.deletedAt) return null;
  if (expectedRevision != null && Number(target.revision || 0) !== Number(expectedRevision)) return null;
  const source = target.deletedByCollectionId || id;
  const collections = await request<Collection[]>((await store("collections")).getAll());
  const bookmarks = await request<Bookmark[]>((await store("bookmarks")).getAll());
  const updatedAt = new Date().toISOString();
  for (const item of collections.filter((entry) => entry.deletedAt && (entry.deletedByCollectionId || entry.id) === source)) {
    delete item.deletedAt;
    delete item.deletedByCollectionId;
    item.updatedAt = updatedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("collections", "readwrite")).put(item));
    await enqueue({ entity: "collection", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  for (const item of bookmarks.filter((entry) => entry.deletedAt && entry.deletedByCollectionId === source)) {
    delete item.deletedAt;
    delete item.deletedByCollectionId;
    item.updatedAt = updatedAt;
    item.revision = Number(item.revision || 0) + 1;
    await request((await store("bookmarks", "readwrite")).put(item));
    await enqueue({ entity: "bookmark", id: item.id, baseRevision: Number(item.revision || 0) - 1, record: item });
  }
  return request<Collection | undefined>((await store("collections")).get(id));
}

async function enqueue(value: { entity: "bookmark" | "collection"; id: string; baseRevision: number; record: Bookmark | Collection }) {
  await request((await store("outbox", "readwrite")).add({ ...value, createdAt: new Date().toISOString(), status: "pending" }));
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-webdav-idle");
    chrome.alarms.create("private-bookmarks-webdav-idle", { delayInMinutes: 5 });
  }
}

async function enqueueLatest(value: { entity: "bookmark" | "collection"; id: string; baseRevision: number; record: Bookmark | Collection }) {
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
    outbox.add({ ...value, createdAt: new Date().toISOString(), status: "pending" });
  };
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存同步队列失败"));
  });
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
  await ensureDefaults();
  const collections = data.collections || [];
  const bookmarks = data.bookmarks || data.items || [];
  for (const collection of collections) if (collection.name) await saveCollection(collection as Partial<Collection> & { name: string }, { enqueueSync: false });
  for (const bookmark of bookmarks) if (bookmark.link) await saveBookmark(bookmark as Partial<Bookmark> & { link: string }, { enqueueSync: false });
  await initialize();
  return { bookmarks: bookmarks.length, collections: collections.length };
}

export async function exportLibrary() {
  return { format: "private-bookmarks/v1", version: 1, exportedAt: new Date().toISOString(), bookmarks: await request<Bookmark[]>((await store("bookmarks")).getAll()), collections: await request<Collection[]>((await store("collections")).getAll()), preferences: await getPreferences() };
}

export async function replaceLibrary(data: { bookmarks?: Bookmark[]; collections?: Collection[] }) {
  await request((await store("bookmarks", "readwrite")).clear());
  await request((await store("collections", "readwrite")).clear());
  await request((await store("settings", "readwrite")).delete("preferences"));
  await importLibrary(data);
  if ((data as any).preferences) {
    const preferences = { ...DEFAULT_PREFERENCES, ...(data as any).preferences };
    await request((await store("settings", "readwrite")).put(preferences, "preferences"));
  }
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
