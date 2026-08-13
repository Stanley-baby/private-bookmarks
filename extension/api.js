import { activeConnection, forgetPin, lockConfig, lockState } from "./lock.js?v=20260808-pin2";

const CONNECTION_KEY = "instanceConnection";
const extensionStorage = globalThis.chrome?.storage?.local;

function localAddress(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function connection() {
  return activeConnection();
}

export async function connect(endpoint, key) {
  const configuredLock = await lockConfig();
  if (configuredLock && (await lockState()).locked) throw Object.assign(new TypeError("请先解锁应用"), { code: "locked" });
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && (extensionStorage || url.protocol !== "http:" || !localAddress(url))) throw new TypeError("私有实例地址必须使用 HTTPS");
  if (extensionStorage && !await chrome.permissions.request({ origins: [`${url.origin}/*`] })) throw new TypeError("未获得私有实例地址的访问权限");
  const value = { endpoint: url.origin, key: String(key).trim() };
  if (!value.key) throw new TypeError("需要访问密钥");
  if (extensionStorage) await extensionStorage.set({ [CONNECTION_KEY]: value });
  else localStorage.setItem(CONNECTION_KEY, JSON.stringify(value));
  await api("/v1/health");
  return value;
}

export async function disconnect() {
  if (await lockConfig()) {
    await forgetPin();
    if (extensionStorage) return extensionStorage.remove([CONNECTION_KEY, "instanceConnectionBackground"]);
    localStorage.removeItem(CONNECTION_KEY);
    localStorage.removeItem("instanceConnectionBackground");
    return;
  }
  if (extensionStorage) await extensionStorage.remove(CONNECTION_KEY);
  else localStorage.removeItem(CONNECTION_KEY);
}

export async function requestPagePermission(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { throw new TypeError("只能保存 HTTP(S) 页面"); }
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("只能保存 HTTP(S) 页面");
  if (!extensionStorage) return true;
  const origin = url.origin;
  if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function api(path, init = {}) {
  const config = await activeConnection();
  if (!config) return localApi(path, init);
  const response = await fetch(`${config.endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-private-bookmarks-key": config.key,
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.message || "Request failed"), { status: response.status, code: body?.code });
  return body;
}

// The extension is local-first. Keep the legacy page's API-shaped calls intact
// while routing them to the IndexedDB store when no Worker connection exists.
let localDbPromise;
async function localDb() {
  return localDbPromise ||= import("../src/local/db.ts");
}

async function localApi(path, init = {}) {
  const db = await localDb();
  const url = new URL(path, "https://local.private-bookmarks");
  const method = String(init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
  const live = !(url.searchParams.get("view") === "trash" || url.searchParams.get("trash") === "1");
  const unavailable = (message = "此功能需要连接私有实例") => { throw Object.assign(new Error(message), { status: 501, code: "not_available" }); };
  const legacyBookmark = (item) => ({ type: "link", language: "", title: "", description: "", note: "", tags: [], highlights: [], media: [], reminder: "", favorite: false, health: { status: "unknown", checkedAt: null, finalUrl: "" }, ...item, type: item.type || "link", language: item.language || "", tags: Array.isArray(item.tags) ? item.tags : [], highlights: Array.isArray(item.highlights) ? item.highlights : [], media: Array.isArray(item.media) ? item.media : [], reminder: item.reminder || "", favorite: Boolean(item.favorite), health: item.health || { status: "unknown", checkedAt: null, finalUrl: "" } });
  const records = async () => (await db.listBookmarks({ trash: !live })).map(legacyBookmark);
  if (method === "GET" && url.pathname === "/v1/health") return { ok: true };
  if (method === "GET" && url.pathname === "/v1/bootstrap") {
    await db.ensureDefaults();
    const [collections, all, trash, preferences] = await Promise.all([db.listCollections(), records(), db.listBookmarks({ trash: true }).then((items) => items.map(legacyBookmark)), db.getPreferences()]);
    const counts = Object.fromEntries(collections.map((item) => [item.id, all.filter((bookmark) => bookmark.collectionId === item.id).length]));
    return { collections, preferences, collectionCounts: { unsorted: all.filter((item) => item.collectionId === "unsorted").length, ...counts }, trashCount: trash.length, ai: { available: false, models: [] }, capabilities: { mediaUpload: false, cloudBackup: false, aiRecommendations: false } };
  }
  if (method === "GET" && url.pathname === "/v1/bookmarks") {
    let items = await records();
    const collection = url.searchParams.get("collection");
    const search = (url.searchParams.get("search") || "").trim().toLocaleLowerCase();
    if (collection) items = items.filter((item) => item.collectionId === collection);
    const view = url.searchParams.get("view");
    if (view === "favorites") items = items.filter((item) => item.favorite);
    if (view === "broken") items = items.filter((item) => item.health?.status === "broken");
    if (view === "unknown") items = items.filter((item) => item.health?.status === "unknown");
    if (search) items = items.filter((item) => [item.title, item.link, item.description, item.note, ...(item.tags || [])].join(" ").toLocaleLowerCase().includes(search));
    return items;
  }
  if (method === "GET" && url.pathname === "/v1/tags") {
    const counts = new Map();
    let tagItems = await records();
    const collection = url.searchParams.get("collection");
    if (collection) tagItems = tagItems.filter((item) => item.collectionId === collection);
    for (const item of tagItems) for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (method === "GET" && url.pathname === "/v1/collections") return db.listCollections({ trash: url.searchParams.get("trash") === "1" });
  if (method === "GET" && url.pathname === "/v1/preferences") return db.getPreferences();
  if (method === "GET" && url.pathname === "/v1/export") return db.exportLibrary();
  if (method === "GET" && url.pathname === "/v1/bookmarks/by-link") {
    const link = url.searchParams.get("link");
    if (!link) throw new TypeError("需要链接");
    let canonical;
    try { canonical = new URL(link).href; } catch { throw new TypeError("链接无效"); }
    return (await records()).filter((item) => item.link === canonical);
  }
  if (method === "POST" && url.pathname === "/v1/bookmarks") return legacyBookmark(await db.saveBookmark(body));
  if (method === "POST" && url.pathname === "/v1/collections") return db.saveCollection(body);
  if (method === "POST" && url.pathname === "/v1/import") return db.importLibrary({ bookmarks: body.items || [] });
  if (method === "POST" && url.pathname === "/v1/restore") {
    if (body.confirm !== true || (body.backup?.format && body.backup.format !== "private-bookmarks/v1")) throw Object.assign(new Error("需要确认的私有书签备份"), { status: 400, code: "invalid_backup" });
    await db.replaceLibrary(body.backup || body);
    return { ok: true };
  }
  if (method === "POST" && url.pathname === "/v1/bookmarks/batch") {
    const action = body.action || {};
    const ids = (body.items || []).map((item) => typeof item === "string" ? item : item.id);
    if (action.type === "favorite") return { bookmarks: (await db.batchBookmarks(ids, { type: "favorite", favorite: action.favorite })).map(legacyBookmark) };
    return { bookmarks: (await db.batchBookmarks(ids, action)).map(legacyBookmark) };
  }
  const bookmark = url.pathname.match(/^\/v1\/bookmarks\/([^/]+)$/);
  if (bookmark && method === "PATCH") return legacyBookmark(await db.saveBookmark({ ...body, id: decodeURIComponent(bookmark[1]) }));
  if (bookmark && method === "DELETE") return db.trashBookmark(decodeURIComponent(bookmark[1]));
  const restore = url.pathname.match(/^\/v1\/bookmarks\/([^/]+)\/restore$/);
  if (restore && method === "POST") return db.restoreBookmark(decodeURIComponent(restore[1]));
  if (method === "POST" && url.pathname === "/v1/health-checks") return unavailable("本地模式暂不支持链接检查");
  const collection = url.pathname.match(/^\/v1\/collections\/([^/]+)$/);
  if (collection && method === "PATCH") {
    const id = decodeURIComponent(collection[1]);
    const current = (await db.listCollections({ trash: true })).find((item) => item.id === id) || (await db.listCollections()).find((item) => item.id === id);
    if (!current) throw Object.assign(new Error("收藏夹不存在"), { status: 404, code: "not_found" });
    return db.saveCollection({ ...current, ...body, id, name: body.name ?? current.name });
  }
  if (collection && method === "DELETE") return db.trashCollection?.(decodeURIComponent(collection[1]));
  const collectionRestore = url.pathname.match(/^\/v1\/collections\/([^/]+)\/restore$/);
  if (collectionRestore && method === "POST") return db.restoreCollection(decodeURIComponent(collectionRestore[1]), body.revision);
  if (method === "PATCH" && url.pathname === "/v1/preferences") {
    const result = await db.updatePreferences(body.revision, body.preferences || {});
    if (result.conflict) throw Object.assign(new Error("请刷新后再保存设置"), { status: 409, code: "editing_conflict" });
    return result.preferences;
  }
  if (/^\/v1\/(backups|cloud|media|ai\b)/.test(url.pathname)) return unavailable();
  throw new TypeError("本地模式暂不支持此操作");
}

export async function uploadCover(bytes, contentType, id) {
  return api("/v1/media", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": contentType,
      ...(id ? { "x-private-bookmarks-id": id } : {}),
    },
  });
}

export async function saveBookmark(bookmark) {
  return api("/v1/bookmarks", { method: "POST", body: JSON.stringify(bookmark) });
}
