export const LOCAL_DATABASE = "private-bookmarks-local";
export const LOCAL_DATABASE_VERSION = 2;
export const LOCAL_STORE_NAMES = ["bookmarks", "collections", "settings", "outbox", "conflicts"];

export function openLocalDatabase({ indexedDB = globalThis.indexedDB, databaseName = LOCAL_DATABASE, version = LOCAL_DATABASE_VERSION } = {}) {
  if (!indexedDB?.open) return Promise.reject(new TypeError("本地资料库不可用"));
  return new Promise((resolve, reject) => {
    let opening;
    try { opening = indexedDB.open(databaseName, Number(version) || LOCAL_DATABASE_VERSION); }
    catch (error) { reject(error); return; }
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
