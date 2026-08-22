import * as defaultDb from "./local-db.js";
class LocalApiError extends Error {
  status;
  code;
  constructor(message, status, code) {
    super(message);
    this.name = "LocalApiError";
    this.status = status;
    this.code = code;
  }
}
function fail(message, status, code) {
  throw new LocalApiError(message, status, code);
}
function legacyBookmark(item) {
  const value = {
    type: "link",
    language: "",
    title: "",
    description: "",
    note: "",
    tags: [],
    highlights: [],
    media: [],
    reminder: "",
    favorite: false,
    health: { status: "unknown", checkedAt: null, finalUrl: "" },
    ...item
  };
  return {
    ...value,
    type: value.type || "link",
    language: value.language || "",
    tags: Array.isArray(value.tags) ? value.tags : [],
    highlights: Array.isArray(value.highlights) ? value.highlights : [],
    media: Array.isArray(value.media) ? value.media : [],
    reminder: value.reminder || "",
    favorite: Boolean(value.favorite),
    health: value.health || { status: "unknown", checkedAt: null, finalUrl: "" }
  };
}
function jsonBody(init) {
  if (typeof init.body !== "string" || !init.body) return {};
  try {
    return JSON.parse(init.body);
  } catch {
    fail("\u8BF7\u6C42\u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON", 400, "invalid_request");
  }
}
function createLocalApi({ db = defaultDb } = {}) {
  const request = async (path, init = {}) => {
    try {
      const url = new URL(path, "https://local.private-bookmarks");
      const method = String(init.method || "GET").toUpperCase();
      const body = jsonBody(init);
      const live = !(url.searchParams.get("view") === "trash" || url.searchParams.get("trash") === "1");
      const unavailable = (message = "\u6B64\u529F\u80FD\u9700\u8981\u8FDE\u63A5\u79C1\u6709\u5B9E\u4F8B") => fail(message, 501, "not_available");
      const records = async () => (await db.listBookmarks({ trash: !live })).map(legacyBookmark);
      const collectionScope = async (id) => {
        if (!id || (await db.getPreferences()).nestedViewLegacy) return id ? /* @__PURE__ */ new Set([id]) : null;
        const collections = await db.listCollections();
        const ids = /* @__PURE__ */ new Set([id]);
        for (let changed = true; changed; ) {
          changed = false;
          for (const item of collections) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
            ids.add(item.id);
            changed = true;
          }
        }
        return ids;
      };
      if (method === "GET" && url.pathname === "/v1/health") return { ok: true };
      if (method === "GET" && url.pathname === "/v1/bootstrap") {
        await db.ensureDefaults();
        const [collections, all, trash, preferences] = await Promise.all([
          db.listCollections(),
          records(),
          db.listBookmarks({ trash: true }).then((items) => items.map(legacyBookmark)),
          db.getPreferences()
        ]);
        const counts = Object.fromEntries(collections.map((item) => [item.id, all.filter((bookmark2) => bookmark2.collectionId === item.id).length]));
        return { collections, preferences, collectionCounts: { unsorted: all.filter((item) => item.collectionId === "unsorted").length, ...counts }, trashCount: trash.length, ai: { available: false, models: [] }, capabilities: { mediaUpload: false, cloudBackup: false, aiRecommendations: false } };
      }
      if (method === "GET" && url.pathname === "/v1/bookmarks") {
        let items = await records();
        const collection2 = url.searchParams.get("collection");
        const search = (url.searchParams.get("search") || "").trim().toLocaleLowerCase();
        const scope = await collectionScope(collection2);
        if (scope) items = items.filter((item) => scope.has(item.collectionId));
        const view = url.searchParams.get("view");
        if (view === "favorites") items = items.filter((item) => item.favorite);
        if (view === "broken") items = items.filter((item) => item.health?.status === "broken");
        if (view === "unknown") items = items.filter((item) => item.health?.status === "unknown");
        if (search) items = items.filter((item) => [item.title, item.link, item.description, item.note, ...item.tags || []].join(" ").toLocaleLowerCase().includes(search));
        return items;
      }
      if (method === "GET" && url.pathname === "/v1/tags") {
        const counts = /* @__PURE__ */ new Map();
        let tagItems = await records();
        const scope = await collectionScope(url.searchParams.get("collection"));
        if (scope) tagItems = tagItems.filter((item) => scope.has(item.collectionId));
        for (const item of tagItems) for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
        return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
      }
      if (method === "GET" && url.pathname === "/v1/collections") return db.listCollections({ trash: url.searchParams.get("trash") === "1" });
      if (method === "GET" && url.pathname === "/v1/preferences") return db.getPreferences();
      if (method === "GET" && url.pathname === "/v1/export") return db.exportLibrary();
      if (method === "GET" && url.pathname === "/v1/bookmarks/by-link") {
        const link = url.searchParams.get("link");
        if (!link) fail("\u9700\u8981\u94FE\u63A5", 400, "invalid_request");
        let canonical;
        try {
          canonical = new URL(link).href;
        } catch {
          fail("\u94FE\u63A5\u65E0\u6548", 400, "invalid_request");
        }
        return (await records()).filter((item) => item.link === canonical);
      }
      if (method === "POST" && url.pathname === "/v1/bookmarks") return legacyBookmark(await db.saveBookmark(body));
      if (method === "POST" && url.pathname === "/v1/collections") return db.saveCollection(body);
      if (method === "POST" && url.pathname === "/v1/import") {
        const items = body.items ?? body.bookmarks;
        if (!Array.isArray(items) || !items.length) fail("\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u4E66\u7B7E", 400, "invalid_import");
        return db.importLibrary({ bookmarks: items, collections: Array.isArray(body.collections) ? body.collections : [] });
      }
      if (method === "POST" && url.pathname === "/v1/restore") {
        if (body.confirm !== true || body.backup?.format !== "private-bookmarks/v1") fail("\u9700\u8981\u786E\u8BA4\u7684\u79C1\u6709\u4E66\u7B7E\u5907\u4EFD", 400, "invalid_backup");
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
      if (bookmark && method === "GET") {
        const item = (await records()).find((value) => value.id === decodeURIComponent(bookmark[1] || ""));
        if (!item) fail("\u4E66\u7B7E\u4E0D\u5B58\u5728", 404, "not_found");
        return item;
      }
      if (bookmark && method === "PATCH") return legacyBookmark(await db.saveBookmark({ ...body, id: decodeURIComponent(bookmark[1] || "") }));
      if (bookmark && method === "DELETE") return db.trashBookmark(decodeURIComponent(bookmark[1] || ""));
      const restore = url.pathname.match(/^\/v1\/bookmarks\/([^/]+)\/restore$/);
      if (restore && method === "POST") return db.restoreBookmark(decodeURIComponent(restore[1] || ""));
      if (method === "POST" && url.pathname === "/v1/health-checks") return unavailable("\u672C\u5730\u6A21\u5F0F\u6682\u4E0D\u652F\u6301\u94FE\u63A5\u68C0\u67E5");
      const collection = url.pathname.match(/^\/v1\/collections\/([^/]+)$/);
      if (collection && method === "PATCH") {
        const id = decodeURIComponent(collection[1] || "");
        const current = (await db.listCollections({ trash: true })).find((item) => item.id === id) || (await db.listCollections()).find((item) => item.id === id);
        if (!current) fail("\u6536\u85CF\u5939\u4E0D\u5B58\u5728", 404, "not_found");
        return db.saveCollection({ ...current, ...body, id, name: body.name ?? current.name });
      }
      if (collection && method === "DELETE") return db.trashCollection?.(decodeURIComponent(collection[1] || ""));
      const collectionRestore = url.pathname.match(/^\/v1\/collections\/([^/]+)\/restore$/);
      if (collectionRestore && method === "POST") return db.restoreCollection(decodeURIComponent(collectionRestore[1] || ""), body.revision);
      if (method === "PATCH" && url.pathname === "/v1/preferences") {
        const result = await db.updatePreferences(body.revision, body.preferences || {});
        if (result.conflict) fail("\u8BF7\u5237\u65B0\u540E\u518D\u4FDD\u5B58\u8BBE\u7F6E", 409, "editing_conflict");
        return result.preferences;
      }
      if (/^\/v1\/(backups|cloud|media|ai\b)/.test(url.pathname)) return unavailable();
      fail("\u672C\u5730\u6A21\u5F0F\u6682\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C", 400, "not_available");
    } catch (error) {
      if (error instanceof LocalApiError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError) throw new LocalApiError(error.message, 400, error.code || "invalid_request");
      throw error;
    }
  };
  const jsonRequest = (path, method = "GET", value) => request(path, { method, ...value === void 0 ? {} : { body: JSON.stringify(value) } });
  return {
    request,
    health: () => jsonRequest("/v1/health"),
    bootstrap: () => jsonRequest("/v1/bootstrap"),
    search: (query, options = {}) => {
      const params = new URLSearchParams({ ...options, search: query });
      return request(`/v1/bookmarks?${params}`);
    },
    listBookmarks: (options = {}) => request(`/v1/bookmarks${new URLSearchParams(options).toString() ? `?${new URLSearchParams(options)}` : ""}`),
    listCollections: (options = {}) => request(`/v1/collections${new URLSearchParams(options).toString() ? `?${new URLSearchParams(options)}` : ""}`),
    getBookmark: (id) => request(`/v1/bookmarks/${encodeURIComponent(id)}`),
    getCollection: async (id) => (await request(`/v1/collections`)).find((item) => item.id === id) || null,
    createBookmark: (value) => jsonRequest("/v1/bookmarks", "POST", value),
    updateBookmark: (id, value) => jsonRequest(`/v1/bookmarks/${encodeURIComponent(id)}`, "PATCH", value),
    trashBookmark: (id) => request(`/v1/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    restoreBookmark: (id, revision) => jsonRequest(`/v1/bookmarks/${encodeURIComponent(id)}/restore`, "POST", revision === void 0 ? {} : { revision }),
    createCollection: (value) => jsonRequest("/v1/collections", "POST", value),
    updateCollection: (id, value) => jsonRequest(`/v1/collections/${encodeURIComponent(id)}`, "PATCH", value),
    deleteCollection: (id) => request(`/v1/collections/${encodeURIComponent(id)}`, { method: "DELETE" }),
    restoreCollection: (id, revision) => jsonRequest(`/v1/collections/${encodeURIComponent(id)}/restore`, "POST", revision === void 0 ? {} : { revision }),
    batchBookmarks: (items, action) => jsonRequest("/v1/bookmarks/batch", "POST", { items, action }),
    importLibrary: (value) => jsonRequest("/v1/import", "POST", value),
    restoreLibrary: (value) => jsonRequest("/v1/restore", "POST", value),
    exportLibrary: () => jsonRequest("/v1/export"),
    getPreferences: () => jsonRequest("/v1/preferences"),
    updatePreferences: (revision, preferences) => jsonRequest("/v1/preferences", "PATCH", { revision, preferences })
  };
}
const localApi = createLocalApi();
export {
  LocalApiError,
  createLocalApi,
  localApi
};

