const MAX_TITLE = 1_000;
const MAX_TEXT = 10_000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

export function canonicalizeUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("Only HTTP(S) links can be saved");

  url.username = "";
  url.password = "";
  url.hash = url.hash.startsWith("#:~:text=") ? "" : url.hash;
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function cleanText(value, limit) {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError("Text fields must be strings");
  return value.trim().slice(0, limit);
}

export function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new TypeError("Tags must be an array");
  const seen = new Set();
  return tags.reduce((result, tag) => {
    const display = cleanText(tag, 100);
    const key = display.toLocaleLowerCase();
    if (display && !seen.has(key)) {
      seen.add(key);
      result.push(display);
    }
    return result;
  }, []);
}

function bookmarkInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("A bookmark is required");
  return {
    link: canonicalizeUrl(input.link),
    title: cleanText(input.title, MAX_TITLE),
    description: cleanText(input.description, MAX_TEXT),
    note: cleanText(input.note, MAX_TEXT),
    cover: cleanText(input.cover, 2_000),
    media: Array.isArray(input.media) ? input.media.filter((item) => typeof item === "string").slice(0, 9) : [],
    collectionId: cleanText(input.collectionId || "unsorted", 64) || "unsorted",
    tags: normalizeTags(input.tags),
    favorite: Boolean(input.favorite),
    highlights: Array.isArray(input.highlights) ? input.highlights : [],
  };
}

function bookmarkChanges(input) {
  if (!input || typeof input !== "object") throw new TypeError("Changes are required");
  const changes = {};
  for (const [field, limit] of [["title", MAX_TITLE], ["description", MAX_TEXT], ["note", MAX_TEXT], ["cover", 2_000], ["collectionId", 64]]) {
    if (field in input) changes[field] = cleanText(input[field], limit);
  }
  if ("link" in input) changes.link = canonicalizeUrl(input.link);
  if ("tags" in input) changes.tags = normalizeTags(input.tags);
  if ("favorite" in input) changes.favorite = Boolean(input.favorite);
  if ("highlights" in input) changes.highlights = Array.isArray(input.highlights) ? input.highlights : [];
  if ("media" in input) changes.media = Array.isArray(input.media) ? input.media.filter((item) => typeof item === "string").slice(0, 9) : [];
  if ("position" in input) {
    if (!Number.isFinite(input.position)) throw new TypeError("Position must be a number");
    changes.position = input.position;
  }
  return changes;
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "access-control-allow-origin": "*", "vary": "origin" },
  });
}

function error(status, code, message) {
  return json({ code, message }, status);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new TypeError("Invalid JSON body");
  }
}

function authorized(request, key) {
  return Boolean(key) && request.headers.get("x-private-bookmarks-key") === key;
}

function mediaKey(id) {
  return `covers/${id}`;
}

async function mediaToken(id, key) {
  if (!key) return "";
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(mediaKey(id)));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function mediaType(request) {
  const value = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLocaleLowerCase();
  if (!MEDIA_TYPES.has(value)) throw new TypeError("仅支持 JPG、PNG、GIF、WebP 或 AVIF 图片");
  return value;
}

export function createApi({ key, store, healthCheck, mediaBucket = null }) {
  return {
    async fetch(request) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type, x-private-bookmarks-key",
            "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          },
        });
      }
      const { pathname, searchParams } = new URL(request.url);
      const mediaMatch = pathname.match(/^\/v1\/media\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && mediaMatch) {
        if (!mediaBucket) return error(501, "not_available", "Media storage is not configured");
        const id = mediaMatch[1];
        if (searchParams.get("token") !== await mediaToken(id, key)) return error(401, "unauthorized", "Invalid media token");
        const object = await mediaBucket.get(mediaKey(id));
        if (!object) return error(404, "not_found", "Media not found");
        const headers = new Headers();
        object.writeHttpMetadata?.(headers);
        headers.set("cache-control", headers.get("cache-control") || "public, max-age=31536000, immutable");
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        headers.set("access-control-allow-origin", "*");
        return new Response(object.body, { headers });
      }
      if (!authorized(request, key)) return error(401, "unauthorized", "Invalid access key");

      try {
        if (request.method === "GET" && pathname === "/v1/health") return json({ ok: true });
        if (request.method === "GET" && pathname === "/v1/export") return json(await store.exportData());
        if (request.method === "POST" && pathname === "/v1/restore") {
          const input = await readJson(request);
          if (!input.confirm || input.backup?.format !== "private-bookmarks/v1") return error(400, "invalid_backup", "A confirmed Private Bookmarks backup is required");
          await store.replaceData(input.backup);
          return json({ ok: true });
        }
        if (request.method === "GET" && pathname === "/v1/bootstrap") {
          const [collections, preferences, collectionCounts, trashCount] = await Promise.all([
            store.listCollections(),
            store.getPreferences(),
            store.listCollectionCounts(),
            store.getTrashCount(),
          ]);
          return json({
            collections,
            preferences,
            collectionCounts,
            trashCount,
            capabilities: { mediaUpload: Boolean(mediaBucket) },
          });
        }
        if (request.method === "POST" && pathname === "/v1/media") {
          if (!mediaBucket) return error(501, "not_available", "Media storage is not configured");
          const type = mediaType(request);
          const declaredSize = Number(request.headers.get("content-length"));
          if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES) return error(413, "media_too_large", "图片不能超过 5 MB");
          const bytes = await request.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) return error(413, "media_too_large", "图片不能超过 5 MB");
          const id = crypto.randomUUID();
          await mediaBucket.put(mediaKey(id), bytes, {
            httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
          });
          const url = new URL(request.url);
          url.pathname = `/v1/media/${id}`;
          url.search = `?token=${await mediaToken(id, key)}`;
          return json({ id, url: url.toString(), contentType: type, size: bytes.byteLength }, 201);
        }
        if (request.method === "PATCH" && pathname === "/v1/preferences") {
          const input = await readJson(request);
          if (!Number.isInteger(input.revision)) return error(400, "invalid_revision", "A revision is required");
          const result = await store.updatePreferences(input.force ? (await store.getPreferences()).revision : input.revision, input.preferences || {});
          if (result.conflict) return error(409, "editing_conflict", "Refresh before saving preferences");
          return json(result.preferences);
        }
        if (request.method === "POST" && pathname === "/v1/health-checks") {
          if (!healthCheck) return error(501, "not_available", "Health checks are not configured");
          return json(await healthCheck((await readJson(request)).collectionId || null));
        }
        if (request.method === "GET" && pathname === "/v1/collections") return json(await store.listCollections({ trash: searchParams.get("trash") === "1" }));
        if (request.method === "POST" && pathname === "/v1/collections") {
          const input = await readJson(request);
          return json(await store.createCollection({ name: input.name, parentId: input.parentId || null }), 201);
        }
        const collectionMatch = pathname.match(/^\/v1\/collections\/([^/]+)$/);
        if (collectionMatch) {
          const id = decodeURIComponent(collectionMatch[1]);
          if (request.method === "PATCH") {
            const input = await readJson(request);
            if (!Number.isInteger(input.revision)) return error(400, "invalid_revision", "A revision is required");
            const result = await store.updateCollection(id, input.force ? (await store.getCollection(id))?.revision : input.revision, input);
            if (result.missing) return error(404, "not_found", "Collection not found");
            if (result.conflict) return error(409, "editing_conflict", "Refresh before changing this collection");
            return json(result.collection);
          }
          if (request.method === "DELETE") {
            const revision = searchParams.get("force") === "1" ? (await store.getCollection(id))?.revision : Number(searchParams.get("revision"));
            const result = await store.trashCollection(id, revision);
            if (result.missing) return error(404, "not_found", "Collection not found");
            if (result.conflict) return error(409, "editing_conflict", "Refresh before deleting this collection");
            return json(result.collection);
          }
        }
        const collectionRestoreMatch = pathname.match(/^\/v1\/collections\/([^/]+)\/restore$/);
        if (collectionRestoreMatch && request.method === "POST") {
          const input = await readJson(request);
          if (!Number.isInteger(input.revision)) return error(400, "invalid_revision", "A revision is required");
          const id = decodeURIComponent(collectionRestoreMatch[1]);
          const result = await store.restoreCollection(id, input.force ? (await store.getCollection(id))?.revision : input.revision);
          if (result.missing) return error(404, "not_found", "Collection not found");
          if (result.conflict) return error(409, "editing_conflict", "Refresh before restoring this collection");
          return json(result.collection);
        }
        if (request.method === "GET" && pathname === "/v1/bookmarks") {
          return json(await store.listBookmarks({
            collectionId: searchParams.get("collection"),
            view: searchParams.get("view"),
            search: searchParams.get("search"),
          }));
        }
        if (request.method === "GET" && pathname === "/v1/bookmarks/by-link") {
          const link = searchParams.get("link");
          if (!link) return error(400, "invalid_request", "A link is required");
          return json(await store.getBookmarksByLink(canonicalizeUrl(link)));
        }
        if (request.method === "POST" && pathname === "/v1/bookmarks") {
          return json(await store.createBookmark(bookmarkInput(await readJson(request))), 201);
        }
        if (request.method === "POST" && pathname === "/v1/bookmarks/batch") {
          const input = await readJson(request);
          if (!Array.isArray(input.items) || !input.items.length || new Set(input.items.map((item) => item?.id)).size !== input.items.length || !input.items.every((item) => item && typeof item.id === "string" && Number.isInteger(item.revision))) {
            return error(400, "invalid_batch", "Each selected bookmark needs an id and revision");
          }
          if (!input.action || !["favorite", "move", "trash", "restore", "tags", "screenshot"].includes(input.action.type)) return error(400, "invalid_batch", "Unsupported batch operation");
          if (input.action.type === "tags") {
            if (!["add", "remove"].includes(input.action.mode)) return error(400, "invalid_batch", "Tag operations need add or remove mode");
            input.action.tags = normalizeTags(input.action.tags);
          }
          const items = input.force ? await Promise.all(input.items.map(async (item) => ({ id: item.id, revision: (await store.getBookmark(item.id))?.revision }))) : input.items;
          const result = await store.batchBookmarks(items, input.action);
          if (result.conflict) return error(409, "editing_conflict", "Refresh before applying this batch operation");
          return json(result);
        }

        const restoreMatch = pathname.match(/^\/v1\/bookmarks\/([^/]+)\/restore$/);
        if (restoreMatch && request.method === "POST") {
          const input = await readJson(request);
          if (!Number.isInteger(input.revision)) return error(400, "invalid_revision", "A revision is required");
          const id = decodeURIComponent(restoreMatch[1]);
          const result = await store.restoreBookmark(id, input.force ? (await store.getBookmark(id))?.revision : input.revision);
          if (result.missing) return error(404, "not_found", "Bookmark not found");
          if (result.conflict) return error(409, "editing_conflict", "Refresh before restoring this bookmark");
          return json(result.bookmark);
        }
        const bookmarkMatch = pathname.match(/^\/v1\/bookmarks\/([^/]+)$/);
        if (bookmarkMatch) {
          const id = decodeURIComponent(bookmarkMatch[1]);
          if (request.method === "GET") {
            const bookmark = await store.getBookmark(id);
            return bookmark ? json(bookmark) : error(404, "not_found", "Bookmark not found");
          }
          if (request.method === "PATCH") {
            const input = await readJson(request);
            if (!Number.isInteger(input.revision)) return error(400, "invalid_revision", "A revision is required");
            const result = await store.updateBookmark(id, input.force ? (await store.getBookmark(id))?.revision : input.revision, bookmarkChanges(input));
            if (result.missing) return error(404, "not_found", "Bookmark not found");
            if (result.conflict) return error(409, "editing_conflict", "Refresh before saving this change");
            return json(result.bookmark);
          }
          if (request.method === "DELETE") {
            const revision = searchParams.get("force") === "1" ? (await store.getBookmark(id))?.revision : Number(searchParams.get("revision"));
            const result = await store.trashBookmark(id, revision);
            if (result?.missing) return error(404, "not_found", "Bookmark not found");
            if (result?.conflict) return error(409, "editing_conflict", "Refresh before deleting this bookmark");
            return json(result.bookmark);
          }
        }
        return error(404, "not_found", "Route not found");
      } catch (reason) {
        if (reason instanceof TypeError) return error(400, "invalid_request", reason.message);
        console.error(reason);
        return error(500, "internal_error", "Unexpected server error");
      }
    },
  };
}
