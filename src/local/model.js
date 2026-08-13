export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

function dataCover(value) {
  const match = /^data:(image\/(?:jpeg|png|gif|webp|avif|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2]) throw new TypeError("封面必须是有效的图片");
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  const bytes = Math.floor(match[2].length * 3 / 4) - padding;
  if (bytes > MAX_COVER_BYTES) throw new TypeError("封面不能超过 5 MB");
  return value;
}

export function validateCover(value) {
  if (!value || typeof value !== "string") return "";
  return value.startsWith("data:") ? dataCover(value) : value;
}

export function coverBytes(value) {
  const match = /^data:(image\/(?:jpeg|png|gif|webp|avif|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value || "");
  if (!match || !match[2]) return null;
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (bytes.byteLength > MAX_COVER_BYTES) throw new TypeError("封面不能超过 5 MB");
  return { bytes, contentType: match[1].toLocaleLowerCase() };
}

export function bytesToCover(bytes, contentType) {
  const type = String(contentType || "").toLocaleLowerCase();
  if (!COVER_TYPES.has(type)) throw new TypeError("封面必须是有效的图片");
  if (bytes.byteLength > MAX_COVER_BYTES) throw new TypeError("封面不能超过 5 MB");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

export async function fileToCover(file) {
  const contentType = String(file?.type || "").toLocaleLowerCase();
  if (!COVER_TYPES.has(contentType)) throw new TypeError("请选择 JPG、PNG、GIF、WebP、AVIF 或 SVG 图片");
  return bytesToCover(new Uint8Array(await file.arrayBuffer()), contentType);
}

function coverReference(value) {
  if (!value || typeof value !== "object") return undefined;
  const id = typeof value.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ? value.id : "";
  const url = typeof value.url === "string" ? value.url : "";
  if (!id && !url) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(url ? { url } : {}),
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    ...(Number.isFinite(value.size) ? { size: Number(value.size) } : {}),
  };
}

export function normalizeBookmark(input, existing, now = new Date().toISOString(), id = crypto.randomUUID()) {
  const hasCover = Object.prototype.hasOwnProperty.call(input, "cover");
  const cover = hasCover ? validateCover(input.cover) : existing?.cover || "";
  let coverRef = Object.prototype.hasOwnProperty.call(input, "coverRef") ? coverReference(input.coverRef) : existing?.coverRef;
  if (cover.startsWith("data:") && !coverRef) coverRef = { id: crypto.randomUUID() };
  if (hasCover && !cover) coverRef = undefined;
  return {
    id: input.id || id,
    link: new URL(input.link).href,
    title: String(input.title || input.link).trim(),
    description: String(input.description || "").trim(),
    note: String(input.note || "").trim(),
    collectionId: input.collectionId || "unsorted",
    tags: [...new Set((input.tags || []).map(String).map((tag) => tag.trim()).filter(Boolean))],
    cover,
    ...(coverRef ? { coverRef } : {}),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
}

// Keep batch edits as plain record transforms so the IndexedDB layer can reuse
// the same semantics without dropping cover/metadata fields.
export function applyBookmarkBatch(input, action, now = new Date().toISOString()) {
  const item = { ...input, tags: Array.isArray(input?.tags) ? [...input.tags] : [] };
  if (!action || typeof action.type !== "string") throw new TypeError("无效的批量操作");
  if (action.type === "move") {
    if (!action.collectionId) throw new TypeError("请选择收藏夹");
    item.collectionId = String(action.collectionId);
  } else if (action.type === "tags") {
    const tags = [...new Set((Array.isArray(action.tags) ? action.tags : []).map(String).map((tag) => tag.trim()).filter(Boolean))];
    const keys = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
    item.tags = action.mode === "remove"
      ? item.tags.filter((tag) => !keys.has(String(tag).toLocaleLowerCase()))
      : [...item.tags, ...tags].filter((tag, index, all) => all.findIndex((value) => String(value).toLocaleLowerCase() === String(tag).toLocaleLowerCase()) === index);
  } else if (action.type === "trash") {
    item.deletedAt = now;
    delete item.purgedAt;
    delete item.permanentDeletedAt;
  } else if (action.type === "restore") {
    delete item.deletedAt;
  } else if (action.type === "purge" || action.type === "permanentDelete") {
    item.deletedAt ||= now;
    item.purgedAt = now;
    item.permanentDeletedAt = now;
  } else {
    throw new TypeError("不支持的批量操作");
  }
  item.updatedAt = now;
  item.revision = Number(item.revision || 0) + 1;
  return item;
}

export const BOOKMARK_CONFLICT_FIELDS = ["title", "link", "description", "note", "tags", "collectionId"];

// Keep conflict merging as a plain transform so the IndexedDB layer can commit
// the resulting record together with its conflict/outbox bookkeeping.
export function mergeBookmarkConflict(local = {}, remote = {}, choices = {}) {
  const merged = { ...local };
  for (const field of BOOKMARK_CONFLICT_FIELDS) {
    const source = choices[field] === "cloud" ? remote : local;
    if (field === "link") {
      const link = source?.link ?? source?.url;
      if (link !== undefined) merged.link = link;
      continue;
    }
    if (source?.[field] !== undefined) merged[field] = field === "tags" && Array.isArray(source[field]) ? [...source[field]] : source[field];
  }
  return merged;
}

export function filterSyncableOutbox(items = [], conflicts = []) {
  const paused = new Set(conflicts.map((item) => `${item.entity}:${item.id}`));
  return items.filter((item) => !paused.has(`${item.entity}:${item.id}`));
}
