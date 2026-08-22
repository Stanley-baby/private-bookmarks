const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UPLOAD_PATH = new RegExp(`^/v1/media/(${UUID})$`, "i");
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const textEncoder = new TextEncoder();

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/gif", ".gif"],
  ["image/webp", ".webp"], ["image/avif", ".avif"], ["image/svg+xml", ".svg"],
  ["application/pdf", ".pdf"], ["application/zip", ".zip"], ["text/plain", ".txt"],
  ["text/html", ".html"], ["audio/mpeg", ".mp3"], ["video/mp4", ".mp4"],
]);

function contentType(value, fallback = DEFAULT_CONTENT_TYPE) {
  const type = String(value || "").split(";", 1)[0].trim().toLocaleLowerCase();
  return /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type) ? type : fallback;
}

function mediaValue(value) {
  if (typeof value === "string") return { value };
  if (!value || typeof value !== "object") return null;
  const source = value.url || value.link || value.src || "";
  if (typeof source !== "string") return null;
  return { value: source, name: value.name || value.filename, contentType: value.contentType || value.mime };
}

function base64Bytes(value) {
  const compact = value.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) return null;
  try {
    const binary = atob(compact + "=".repeat((4 - compact.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function parseDataUrl(value) {
  if (typeof value !== "string" || value.slice(0, 5).toLocaleLowerCase() !== "data:") return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const header = value.slice(5, comma).split(";");
  const rawType = header.shift() || "";
  const encoded = header.some((part) => part.toLocaleLowerCase() === "base64");
  let payload;
  try { payload = decodeURIComponent(value.slice(comma + 1)); } catch { return null; }
  const bytes = encoded ? base64Bytes(payload) : textEncoder.encode(payload);
  if (!bytes) return null;
  return { bytes, contentType: contentType(rawType) };
}

export function parseUploadReference(value) {
  const candidate = mediaValue(value)?.value;
  if (!candidate || candidate.toLocaleLowerCase() === "<screenshot>" || candidate.toLocaleLowerCase().startsWith("data:")) return null;
  let url;
  try { url = new URL(candidate, "https://private-bookmarks.invalid"); } catch { return null; }
  const match = UPLOAD_PATH.exec(url.pathname);
  if (!match) return null;
  return { id: match[1], url: candidate, path: url.pathname };
}

function reference(value, hints = {}) {
  const candidate = mediaValue(value);
  if (!candidate || candidate.value.toLocaleLowerCase() === "<screenshot>") return null;
  const data = parseDataUrl(candidate.value);
  if (data) return {
    kind: "data",
    bytes: data.bytes,
    contentType: data.contentType,
    id: hints.id || "",
    name: candidate.name || hints.name || "",
  };
  const upload = parseUploadReference(candidate.value);
  if (!upload) return null;
  return {
    kind: "upload",
    ...upload,
    contentType: contentType(candidate.contentType || hints.contentType),
    name: candidate.name || hints.name || "",
  };
}

function byteIdentity(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function bookmarkCandidates(bookmark) {
  const coverRef = bookmark?.coverRef && typeof bookmark.coverRef === "object" ? bookmark.coverRef : {};
  const coverHints = {
    id: typeof coverRef.id === "string" && new RegExp(`^${UUID}$`, "i").test(coverRef.id) ? coverRef.id : "",
    name: coverRef.name || coverRef.filename || "",
    contentType: coverRef.contentType,
  };
  const candidates = [[bookmark?.cover, coverHints], [coverRef.url, coverHints]];
  if (Array.isArray(bookmark?.media)) for (const item of bookmark.media) {
    const hints = item && typeof item === "object" ? item : {};
    candidates.push([item, { name: hints.name || hints.filename || "", contentType: hints.contentType || hints.mime }]);
  }
  return candidates;
}

export function collectMediaReferences(backup) {
  const references = [];
  const seen = new Set();
  for (const bookmark of Array.isArray(backup?.bookmarks) ? backup.bookmarks : []) {
    for (const [value, hints] of bookmarkCandidates(bookmark)) {
      const item = reference(value, hints);
      if (!item) continue;
      const key = item.kind === "upload"
        ? `upload:${item.id.toLocaleLowerCase()}`
        : `data:${item.contentType}:${byteIdentity(item.bytes)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(item);
    }
  }
  return references;
}

export function collectUploadReferences(backup) {
  return collectMediaReferences(backup).filter((item) => item.kind === "upload");
}

export function mimeExtension(value) {
  const type = contentType(value);
  if (MIME_EXTENSIONS.has(type)) return MIME_EXTENSIONS.get(type);
  const subtype = type.split("/", 2)[1]?.split("+", 1)[0].replace(/[^a-z0-9-]/g, "");
  return subtype ? `.${subtype}` : "";
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLocaleLowerCase()] || "";
}

export function contentDispositionFilename(value) {
  const header = String(value || "");
  const extended = header.match(/(?:^|;)\s*filename\*\s*=\s*(?:UTF-8''|[^']*'[^']*')?([^;]*)/i)?.[1];
  const regular = header.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  let name = extended || regular?.[1] || regular?.[2] || "";
  name = name.trim().replace(/^"|"$/g, "");
  try { name = decodeURIComponent(name); } catch { /* use the header value */ }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name && name !== "." && name !== ".." ? name : "";
}

function archiveName(value, fallback, used) {
  let name = String(value || "").trim() || fallback;
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim() || fallback;
  const stem = name.replace(/(\.[^.]+)$/, "");
  const extension = name.slice(stem.length);
  let index = 1;
  let candidate = `uploads/${name}`;
  while (used.has(candidate)) candidate = `uploads/${stem}-${++index}${extension}`;
  used.add(candidate);
  return candidate;
}

function resolvedUrl(value, baseUrl) {
  if (!baseUrl) return value;
  return new URL(value, baseUrl).href;
}

function metadataBytes(items) {
  return textEncoder.encode(`${JSON.stringify({ format: "private-bookmarks/uploads-v1", uploads: items }, null, 2)}\n`);
}

export async function mediaArchiveEntries(backup, options = {}) {
  const settings = typeof options === "function" ? { fetchImpl: options } : (options || {});
  const references = collectMediaReferences(backup);
  const entries = [];
  const uploads = [];
  const usedNames = new Set();
  for (const [index, referenceItem] of references.entries()) {
    let bytes = referenceItem.bytes;
    let type = referenceItem.contentType;
    let filename = referenceItem.name;
    if (referenceItem.kind === "upload") {
      const fetchImpl = settings.fetchImpl || settings.fetch || globalThis.fetch;
      if (typeof fetchImpl !== "function") throw new TypeError("需要 fetch 才能归档上传媒体");
      const response = await fetchImpl(resolvedUrl(referenceItem.url, settings.baseUrl || settings.endpoint));
      if (!response || response.ok === false || (Number.isFinite(response.status) && response.status >= 400)) throw new Error(`媒体下载失败: ${referenceItem.id}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      filename = contentDispositionFilename(headerValue(response.headers, "content-disposition")) || filename;
      type = contentType(headerValue(response.headers, "content-type"), type);
    }
    const fallback = `${referenceItem.id || `data-${index + 1}`}${mimeExtension(type)}`;
    const name = archiveName(filename, fallback, usedNames);
    entries.push({ name, bytes });
    uploads.push({
      id: referenceItem.id || null,
      path: name,
      name: name.slice("uploads/".length),
      contentType: type,
      size: bytes.byteLength,
      source: referenceItem.kind,
      ...(referenceItem.kind === "upload" ? { url: referenceItem.path } : {}),
    });
  }
  entries.push({ name: "uploads.json", bytes: metadataBytes(uploads) });
  return entries;
}

