import { MAX_RESTORE_STATEMENTS, restoreStatementCount } from "./d1-store.js";

const MAX_TITLE = 1_000;
const MAX_TEXT = 10_000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_MEDIA_FILES = 100;
const MAX_BACKUP_MEDIA_BYTES = 100 * 1024 * 1024;
// Keep imports small enough for one D1 batch and predictable request sizes.
export const MAX_IMPORT_ITEMS = 100;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);
const ATTACHMENT_TYPES = new Set([
  ...MEDIA_TYPES,
  "application/pdf", "application/zip", "application/octet-stream", "text/plain", "text/csv",
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
  "video/mp4", "video/quicktime", "video/webm", "video/ogg",
  "application/msword", "application/rtf", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const BOOKMARK_TYPES = new Set(["link", "article", "image", "video", "audio", "document"]);
const CLOUD_BACKUP_FORMAT = "private-bookmarks/cloud-backup/v1";
const BACKUP_FILES = ["library.json", "manifest.json"];
const CLOUD_PROVIDERS = Object.freeze({
  dropbox: {
    authEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    scopes: "account_info.read files.content.write",
  },
  google: {
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: "openid email profile https://www.googleapis.com/auth/drive.file",
  },
  onedrive: {
    authEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: "openid email profile offline_access Files.ReadWrite.AppFolder User.Read",
  },
});
const CLOUD_PROVIDER_ALIASES = Object.freeze({ "google-drive": "google", "one-drive": "onedrive" });

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

function normalizeReminder(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Reminder must be a valid date");
  return date.toISOString();
}

function normalizeCreatedAt(value) {
  if (!value) return "";
  if (typeof value !== "string") throw new TypeError("Created date must be a string");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Created date must be valid");
  return date.toISOString();
}

function normalizeImportId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

function normalizeBookmarkType(value) {
  if (value == null || value === "") return "link";
  if (!BOOKMARK_TYPES.has(value)) throw new TypeError("Unsupported bookmark type");
  return value;
}

function normalizeLanguage(value) {
  if (typeof value !== "string") return "";
  const language = value.trim().replaceAll("_", "-").split("-", 1)[0].toLocaleLowerCase();
  return /^[a-z]{2,3}$/.test(language) ? language : "";
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
    type: normalizeBookmarkType(input.type),
    language: normalizeLanguage(input.language),
    title: cleanText(input.title, MAX_TITLE),
    description: cleanText(input.description, MAX_TEXT),
    note: cleanText(input.note, MAX_TEXT),
    reminder: normalizeReminder(input.reminder),
    cover: cleanText(input.cover, 2_000),
    media: Array.isArray(input.media) ? input.media.filter((item) => typeof item === "string").slice(0, 9) : [],
    collectionId: cleanText(input.collectionId || "unsorted", 64) || "unsorted",
    tags: normalizeTags(input.tags),
    favorite: Boolean(input.favorite),
    highlights: Array.isArray(input.highlights) ? input.highlights : [],
    createdAt: normalizeCreatedAt(input.createdAt),
    id: normalizeImportId(input.id),
  };
}

function bookmarkChanges(input) {
  if (!input || typeof input !== "object") throw new TypeError("Changes are required");
  const changes = {};
  for (const [field, limit] of [["title", MAX_TITLE], ["description", MAX_TEXT], ["note", MAX_TEXT], ["cover", 2_000], ["collectionId", 64]]) {
    if (field in input) changes[field] = cleanText(input[field], limit);
  }
  if ("link" in input) changes.link = canonicalizeUrl(input.link);
  if ("type" in input) changes.type = normalizeBookmarkType(input.type);
  if ("language" in input) changes.language = normalizeLanguage(input.language);
  if ("reminder" in input) changes.reminder = normalizeReminder(input.reminder);
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

function backupKey(id, file) {
  return `backups/${id}/${file}`;
}

function backupMediaKey(id, mediaId) {
  return backupKey(id, `media/${mediaId}`);
}

function hexDigest(bytes) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""));
}

function backupInvalid(message, code = "invalid_backup") {
  const reason = new TypeError(message);
  reason.code = code;
  return reason;
}

async function objectBytes(object) {
  if (typeof object.arrayBuffer === "function") return new Uint8Array(await object.arrayBuffer());
  if (object.body instanceof ArrayBuffer) return new Uint8Array(object.body);
  if (ArrayBuffer.isView(object.body)) return new Uint8Array(object.body.buffer, object.body.byteOffset, object.body.byteLength);
  if (object.body && typeof object.body.getReader === "function") return new Uint8Array(await new Response(object.body).arrayBuffer());
  if (typeof object.body === "string") return new TextEncoder().encode(object.body);
  throw backupInvalid("Backup object body is unreadable");
}

async function readBackupObject(bucket, id, file) {
  const object = await bucket.get(backupKey(id, file));
  if (!object) throw backupInvalid("Backup object is missing", "backup_not_found");
  return objectBytes(object);
}

function mediaReferenceIds(backup) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "object" && value) return add(value.link || value.url || "");
    if (typeof value !== "string" || !value) return;
    try {
      const url = new URL(value, "https://private-bookmarks.invalid");
      const match = url.pathname.match(/^\/v1\/media\/([0-9a-f-]{36})$/i);
      if (match && normalizeImportId(match[1])) ids.add(match[1]);
    } catch { /* external media URLs are not part of an instance backup */ }
  };
  for (const item of backup?.bookmarks || []) {
    add(item?.cover);
    for (const value of item?.media || []) add(value);
  }
  return [...ids];
}

function mediaManifestEntries(manifest) {
  if (!Array.isArray(manifest?.media)) return [];
  return manifest.media.filter((item) => item && normalizeImportId(item.id) && item.key === `media/${item.id}`);
}

async function removeBackupObjects(bucket, id, mediaIds = []) {
  if (!bucket?.delete) return;
  const keys = new Set(BACKUP_FILES.map((file) => backupKey(id, file)));
  for (const mediaId of mediaIds) keys.add(backupMediaKey(id, mediaId));
  if (bucket.list) {
    try {
      const listed = await bucket.list({ prefix: `backups/${id}/` });
      for (const object of listed?.objects || []) if (object?.key) keys.add(object.key);
    } catch { /* best effort; explicit keys still get removed */ }
  }
  for (const key of keys) await bucket.delete(key);
}

async function copyBackupMedia({ bucket, backupId, mediaIds }) {
  const media = [];
  let totalBytes = 0;
  for (const id of mediaIds) {
    if (media.length >= MAX_BACKUP_MEDIA_FILES) throw backupInvalid("Too many media files in one backup", "media_backup_too_large");
    const object = await bucket.get(mediaKey(id));
    if (!object) throw backupInvalid(`Media ${id} is missing`, "media_backup_missing");
    const bytes = await objectBytes(object);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_MEDIA_BYTES || totalBytes > MAX_BACKUP_MEDIA_BYTES) {
      throw backupInvalid("Media files exceed the backup size limit", "media_backup_too_large");
    }
    const contentType = object.httpMetadata?.contentType || object.contentType || "application/octet-stream";
    const key = `media/${id}`;
    await bucket.put(backupKey(backupId, key), bytes, {
      httpMetadata: { contentType, cacheControl: "private, no-store" },
    });
    media.push({ id, key, bytes: bytes.byteLength, sha256: await hexDigest(bytes), contentType });
  }
  return media;
}

export async function createCloudBackup({ store, bucket, kind = "manual", includeMedia = false } = {}) {
  if (!store || !bucket) throw backupInvalid("Backup storage is not configured", "not_available");
  const backup = await store.exportData();
  if (backup?.format !== "private-bookmarks/v1") throw backupInvalid("Export is not a Private Bookmarks backup");
  if (restoreStatementCount(backup) > MAX_RESTORE_STATEMENTS) throw backupInvalid(`Backup is too large to restore in one D1 batch (maximum ${MAX_RESTORE_STATEMENTS} statements)`, "backup_too_large");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const libraryBytes = new TextEncoder().encode(JSON.stringify(backup));
  const librarySha256 = await hexDigest(libraryBytes);
  const mediaIds = includeMedia ? mediaReferenceIds(backup) : [];
  let media = [];
  const manifest = {
    format: CLOUD_BACKUP_FORMAT,
    backupId: id,
    createdAt,
    includeMedia: Boolean(includeMedia),
    mediaCopied: Boolean(includeMedia),
    mediaCount: 0,
    media: [],
    files: { "library.json": { bytes: libraryBytes.byteLength, sha256: librarySha256 } },
  };
  try {
    await bucket.put(backupKey(id, "library.json"), libraryBytes, { httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" } });
    if (includeMedia) {
      media = await copyBackupMedia({ bucket, backupId: id, mediaIds });
      manifest.media = media;
      manifest.mediaCount = media.length;
      for (const item of media) manifest.files[item.key] = { bytes: item.bytes, sha256: item.sha256, contentType: item.contentType };
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestSha256 = await hexDigest(manifestBytes);
    await bucket.put(backupKey(id, "manifest.json"), manifestBytes, { httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" } });
    const metadata = await store.createBackup({ id, kind, includeMedia, mediaCopied: Boolean(includeMedia), mediaCount: media.length, libraryBytes: libraryBytes.byteLength, librarySha256, manifestSha256, createdAt });
    return { metadata, backup, manifest };
  } catch (reason) {
    try { await removeBackupObjects(bucket, id, media.map((item) => item.id)); } catch { /* best effort cleanup */ }
    throw reason;
  }
}

async function readCloudBackup({ store, bucket, id }) {
  const metadata = await store.getBackup(id);
  if (!metadata) throw backupInvalid("Backup not found", "backup_not_found");
  const [libraryBytes, manifestBytes] = await Promise.all([
    readBackupObject(bucket, id, "library.json"),
    readBackupObject(bucket, id, "manifest.json"),
  ]);
  const librarySha256 = await hexDigest(libraryBytes);
  const manifestSha256 = await hexDigest(manifestBytes);
  if (metadata.librarySha256 && metadata.librarySha256 !== librarySha256) throw backupInvalid("Backup library checksum mismatch", "backup_checksum_mismatch");
  if (metadata.manifestSha256 && metadata.manifestSha256 !== manifestSha256) throw backupInvalid("Backup manifest checksum mismatch", "backup_checksum_mismatch");
  let manifest;
  let backup;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    backup = JSON.parse(new TextDecoder().decode(libraryBytes));
  } catch {
    throw backupInvalid("Backup JSON is invalid");
  }
  if (manifest?.format !== CLOUD_BACKUP_FORMAT || manifest.backupId !== id || manifest.files?.["library.json"]?.sha256 !== librarySha256 || Number(manifest.files?.["library.json"]?.bytes) !== libraryBytes.byteLength) throw backupInvalid("Backup manifest is invalid");
  if (backup?.format !== "private-bookmarks/v1") throw backupInvalid("Backup library is invalid");
  const media = mediaManifestEntries(manifest);
  if (Array.isArray(manifest.media) && media.length !== manifest.media.length) throw backupInvalid("Backup media manifest is invalid");
  if (Number(manifest.mediaCount || 0) !== media.length || (manifest.includeMedia === true && manifest.mediaCopied !== true)) throw backupInvalid("Backup media manifest is invalid");
  for (const item of media) {
    if (manifest.files?.[item.key]?.sha256 !== item.sha256) throw backupInvalid("Backup media manifest is invalid");
  }
  return { metadata, backup, manifest, libraryBytes, manifestBytes };
}

async function readBackupMedia(bucket, id, item) {
  const bytes = await readBackupObject(bucket, id, item.key);
  if (bytes.byteLength !== Number(item.bytes) || await hexDigest(bytes) !== item.sha256) throw backupInvalid("Backup media checksum mismatch", "backup_checksum_mismatch");
  return bytes;
}

async function restoreBackupMedia(bucket, id, manifest) {
  const media = mediaManifestEntries(manifest);
  for (const item of media) {
    const bytes = await readBackupMedia(bucket, id, item);
    await bucket.put(mediaKey(item.id), bytes, { httpMetadata: { contentType: item.contentType || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" } });
  }
}

function concatBytes(chunks) {
  const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

const CRC32_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipArchive(entries) {
  const encoder = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(bytes);
    const localHeader = new ArrayBuffer(30);
    const localView = new DataView(localHeader);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true); localView.setUint16(6, 0x800, true);
    localView.setUint16(8, 0, true); localView.setUint16(10, 0, true); localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true); localView.setUint32(18, bytes.byteLength, true); localView.setUint32(22, bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true); localView.setUint16(28, 0, true);
    local.push(new Uint8Array(localHeader), name, bytes);
    const centralHeader = new ArrayBuffer(46);
    const centralView = new DataView(centralHeader);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true); centralView.setUint16(8, 0x800, true);
    centralView.setUint16(10, 0, true); centralView.setUint16(12, 0, true); centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true); centralView.setUint32(20, bytes.byteLength, true); centralView.setUint32(24, bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true); centralView.setUint16(30, 0, true); centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true); centralView.setUint16(36, 0, true); centralView.setUint32(38, 0, true); centralView.setUint32(42, offset, true);
    central.push(new Uint8Array(centralHeader), name);
    offset += 30 + name.byteLength + bytes.byteLength;
  }
  const centralBytes = concatBytes(central);
  const localBytes = concatBytes(local);
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true); endView.setUint32(16, localBytes.byteLength, true);
  return concatBytes([localBytes, centralBytes, new Uint8Array(end)]);
}

async function backupArchiveBytes({ bucket, id, backup, manifest, libraryBytes, manifestBytes }) {
  const entries = [
    { name: "library.json", bytes: libraryBytes || new TextEncoder().encode(JSON.stringify(backup)) },
    { name: "manifest.json", bytes: manifestBytes || new TextEncoder().encode(JSON.stringify(manifest)) },
  ];
  for (const item of mediaManifestEntries(manifest)) entries.push({ name: item.key, bytes: await readBackupMedia(bucket, id, item) });
  return zipArchive(entries);
}

export async function deleteCloudBackup({ store, bucket, id } = {}) {
  const metadata = await store.getBackup(id);
  if (!metadata) return false;
  let mediaIds = [];
  try {
    const manifestBytes = await readBackupObject(bucket, id, "manifest.json");
    mediaIds = mediaManifestEntries(JSON.parse(new TextDecoder().decode(manifestBytes))).map((item) => item.id);
  } catch { /* delete the known JSON objects even if the manifest is damaged */ }
  await removeBackupObjects(bucket, id, mediaIds);
  await store.deleteBackup(id);
  return true;
}

export function automaticBackupRetention(backups, now = new Date()) {
  const automatic = backups.filter((item) => item?.kind === "automatic").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const keep = new Set(automatic.slice(0, 7).map((item) => item.id));
  const weekKeys = new Set();
  // ponytail: seven-day UTC buckets, calendar-week boundaries only if retention policy needs them.
  const week = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return String(Math.floor((date.getTime() - now.getTimezoneOffset() * 60_000) / (7 * 24 * 60 * 60 * 1_000)));
  };
  for (const item of automatic.slice(7)) {
    const key = week(item.createdAt);
    if (key && weekKeys.size < 4 && !weekKeys.has(key)) {
      keep.add(item.id);
      weekKeys.add(key);
    }
  }
  return automatic.filter((item) => !keep.has(item.id));
}

async function mediaToken(id, key) {
  if (!key) return "";
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(mediaKey(id)));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cloudProvider(value) {
  const normalized = String(value || "").toLocaleLowerCase();
  return CLOUD_PROVIDER_ALIASES[normalized] || normalized;
}

function cloudConfig(provider, oauth = {}, request) {
  const definition = CLOUD_PROVIDERS[provider];
  if (!definition) return null;
  const input = oauth?.[provider] || {};
  const clientId = input.clientId || oauth?.[`${provider}ClientId`] || "";
  const clientSecret = input.clientSecret || oauth?.[`${provider}ClientSecret`] || "";
  const redirectUri = input.redirectUri || oauth?.[`${provider}RedirectUri`] || new URL(`/v1/cloud/${provider}/callback`, request.url).toString();
  return clientId && clientSecret ? { ...definition, clientId, clientSecret, redirectUri } : null;
}

function encodeBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const padded = String(value).replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  return decodeBase64(padded);
}

async function hmacState(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function createOAuthState({ provider, redirectUri, secret }) {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ provider, redirectUri, issuedAt: Date.now() })));
  return `${payload}.${encodeBase64Url(await hmacState(secret, payload))}`;
}

async function readOAuthState(value, secret) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature || !secret) throw backupInvalid("OAuth state is invalid", "oauth_state_invalid");
  const expected = encodeBase64Url(await hmacState(secret, payload));
  if (signature !== expected) throw backupInvalid("OAuth state is invalid", "oauth_state_invalid");
  let result;
  try { result = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))); } catch { throw backupInvalid("OAuth state is invalid", "oauth_state_invalid"); }
  if (!result?.provider || !Number.isFinite(result.issuedAt) || Date.now() - result.issuedAt > 10 * 60 * 1_000) throw backupInvalid("OAuth state has expired", "oauth_state_expired");
  return result;
}

async function tokenCipherKey(secret) {
  if (!secret) throw backupInvalid("OAuth token encryption is not configured", "oauth_not_available");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenCipherKey(secret), new TextEncoder().encode(String(value || "")));
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptToken(secret, value) {
  try {
    const [iv, ciphertext] = String(value || "").split(".");
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(iv) }, await tokenCipherKey(secret), decodeBase64Url(ciphertext));
    return new TextDecoder().decode(decrypted);
  } catch {
    throw backupInvalid("Stored OAuth token is invalid", "oauth_token_invalid");
  }
}

async function responsePayload(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

async function exchangeOAuthCode({ provider, config, code, redirectUri, fetchImpl }) {
  const body = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const response = await fetchImpl(config.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = await responsePayload(response);
  if (!response.ok || !payload.access_token) throw backupInvalid(payload.error_description || payload.error || "OAuth token exchange failed", "oauth_exchange_failed");
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3_600);
  return { ...payload, expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(), provider };
}

async function cloudAccount({ provider, accessToken, fetchImpl }) {
  const endpoints = {
    dropbox: ["https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: "{}" }],
    google: ["https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${accessToken}` } }],
    onedrive: ["https://graph.microsoft.com/v1.0/me", { headers: { authorization: `Bearer ${accessToken}` } }],
  };
  const [url, init] = endpoints[provider];
  try {
    const response = await fetchImpl(url, init);
    if (!response.ok) return {};
    const payload = await responsePayload(response);
    return { id: payload.account_id || payload.id || "", name: payload.name?.display_name || payload.displayName || payload.name || "", email: payload.email || payload.mail || payload.userPrincipalName || "" };
  } catch { return {}; }
}

async function saveOAuthConnection({ store, provider, token, secret, account, existing = null }) {
  return store.saveCloudConnection({
    provider,
    accessToken: await encryptToken(secret, token.access_token),
    refreshToken: token.refresh_token ? await encryptToken(secret, token.refresh_token) : existing?.refreshToken || "",
    expiresAt: token.expiresAt,
    scope: token.scope || "",
    accountId: account.id || "",
    accountName: account.name || "",
    accountEmail: account.email || "",
  });
}

async function cloudAccessToken({ store, connection, config, secret, fetchImpl }) {
  if (connection.expiresAt && new Date(connection.expiresAt).getTime() > Date.now() + 60_000) return decryptToken(secret, connection.accessToken);
  if (!connection.refreshToken) return decryptToken(secret, connection.accessToken);
  const refreshToken = await decryptToken(secret, connection.refreshToken);
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetchImpl(config.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = await responsePayload(response);
  if (!response.ok || !payload.access_token) throw backupInvalid(payload.error_description || payload.error || "OAuth token refresh failed", "oauth_refresh_failed");
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3_600);
  await store.saveCloudConnection({ ...connection, accessToken: await encryptToken(secret, payload.access_token), refreshToken: connection.refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString() });
  return payload.access_token;
}

function multipartUploadBody(metadata, bytes, boundary) {
  const encoder = new TextEncoder();
  return concatBytes([
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
    bytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ]);
}

async function uploadCloudArchive({ provider, accessToken, name, bytes, fetchImpl }) {
  let response;
  if (provider === "dropbox") {
    response = await fetchImpl("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/octet-stream", "dropbox-api-arg": JSON.stringify({ path: `/Private Bookmarks/${name}`, mode: "add", autorename: true, mute: true }) }, body: bytes });
  } else if (provider === "google") {
    const boundary = `private-bookmarks-${crypto.randomUUID()}`;
    response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` }, body: multipartUploadBody({ name, mimeType: "application/zip" }, bytes, boundary) });
  } else {
    const path = encodeURIComponent(name);
    response = await fetchImpl(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/Private%20Bookmarks/${path}:/content`, { method: "PUT", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/zip" }, body: bytes });
  }
  const payload = await responsePayload(response);
  if (!response.ok) throw backupInvalid(payload.error?.message || payload.error_description || payload.message || "Cloud upload failed", "cloud_upload_failed");
  return payload;
}

function callbackHtml(ok, message) {
  const escaped = String(message).replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[value]));
  return new Response(`<!doctype html><meta charset="utf-8"><title>Private Bookmarks</title><p>${escaped}</p><script>window.opener?.postMessage({type:"private-bookmarks-oauth",ok:${Boolean(ok)}},"*");window.setTimeout(()=>window.close(),800)</script>`, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function mediaType(request) {
  const value = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLocaleLowerCase();
  const kind = request.headers.get("x-private-bookmarks-kind") || "cover";
  const allowed = kind === "attachment" ? ATTACHMENT_TYPES : MEDIA_TYPES;
  if (!allowed.has(value)) throw new TypeError(kind === "attachment" ? "不支持此附件类型" : "仅支持 JPG、PNG、GIF、WebP、AVIF 或 SVG 图片");
  return { value, kind };
}

export function createApi({ key, store, healthCheck, mediaBucket = null, backupBucket = null, oauth = {}, fetchImpl = globalThis.fetch }) {
  const cloudBucket = backupBucket || mediaBucket;
  const oauthSecret = oauth.encryptionKey || oauth.secret || key;
  return {
    async fetch(request) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type, x-private-bookmarks-key, x-private-bookmarks-kind, x-private-bookmarks-name, x-private-bookmarks-id",
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
      const callbackMatch = pathname.match(/^\/v1\/cloud\/([^/]+)\/callback$/i);
      if (request.method === "GET" && callbackMatch) {
        const provider = cloudProvider(callbackMatch[1]);
        try {
          const config = cloudConfig(provider, oauth, request);
          if (!config || !store?.saveCloudConnection) return callbackHtml(false, "此实例尚未配置此云盘 OAuth");
          const callbackError = searchParams.get("error_description") || searchParams.get("error");
          if (callbackError) return callbackHtml(false, callbackError);
          const state = await readOAuthState(searchParams.get("state"), oauthSecret);
          if (state.provider !== provider || state.redirectUri !== config.redirectUri) throw backupInvalid("OAuth callback does not match the authorization request", "oauth_state_invalid");
          const code = searchParams.get("code");
          if (!code) throw backupInvalid("OAuth callback did not contain an authorization code", "oauth_exchange_failed");
          const token = await exchangeOAuthCode({ provider, config, code, redirectUri: state.redirectUri, fetchImpl });
          const account = await cloudAccount({ provider, accessToken: token.access_token, fetchImpl });
          await saveOAuthConnection({ store, provider, token, secret: oauthSecret, account, existing: await store.getCloudConnection(provider) });
          return callbackHtml(true, `${provider} 已连接，可以关闭此窗口`);
        } catch (reason) {
          return callbackHtml(false, reason.message || "OAuth 授权失败");
        }
      }
      if (!authorized(request, key)) return error(401, "unauthorized", "Invalid access key");

      try {
        if (request.method === "GET" && pathname === "/v1/health") return json({ ok: true });
        if (request.method === "GET" && pathname === "/v1/export") return json(await store.exportData());
        if (request.method === "GET" && pathname === "/v1/cloud/connections") {
          if (!store.listCloudConnections) return error(501, "oauth_not_available", "Cloud OAuth storage is not configured");
          const saved = new Map((await store.listCloudConnections()).map((item) => [item.provider, item]));
          return json(Object.keys(CLOUD_PROVIDERS).map((provider) => {
            const config = cloudConfig(provider, oauth, request);
            const item = saved.get(provider);
            return { provider, configured: Boolean(config), connected: Boolean(item), accountName: item?.accountName || "", accountEmail: item?.accountEmail || "", connectedAt: item?.connectedAt || "" };
          }));
        }
        const cloudMatch = pathname.match(/^\/v1\/cloud\/([^/]+)(?:\/(authorize|disconnect|backups))?$/i);
        if (cloudMatch) {
          const provider = cloudProvider(cloudMatch[1]);
          if (!CLOUD_PROVIDERS[provider]) return error(404, "not_found", "Unsupported cloud provider");
          const action = cloudMatch[2] || "";
          const config = cloudConfig(provider, oauth, request);
          if (action === "authorize" && request.method === "GET") {
            if (!config) return error(501, "oauth_not_configured", `${provider} OAuth is not configured`);
            const state = await createOAuthState({ provider, redirectUri: config.redirectUri, secret: oauthSecret });
            const url = new URL(config.authEndpoint);
            url.searchParams.set("client_id", config.clientId); url.searchParams.set("redirect_uri", config.redirectUri); url.searchParams.set("response_type", "code"); url.searchParams.set("state", state); url.searchParams.set("scope", config.scopes);
            if (provider === "dropbox") url.searchParams.set("token_access_type", "offline");
            if (provider === "google") { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
            if (provider === "onedrive") url.searchParams.set("response_mode", "query");
            return json({ provider, configured: true, authorizationUrl: url.toString(), redirectUri: config.redirectUri });
          }
          if (action === "disconnect" && request.method === "POST") {
            if (!store.deleteCloudConnection) return error(501, "oauth_not_available", "Cloud OAuth storage is not configured");
            await store.deleteCloudConnection(provider);
            return json({ ok: true, provider });
          }
          if (action === "backups" && request.method === "POST") {
            if (!config) return error(501, "oauth_not_configured", `${provider} OAuth is not configured`);
            if (!cloudBucket) return error(501, "not_available", "Backup storage is not configured");
            if (!store.getCloudConnection) return error(501, "oauth_not_available", "Cloud OAuth storage is not configured");
            const connection = await store.getCloudConnection(provider);
            if (!connection) return error(409, "oauth_not_connected", `${provider} is not connected`);
            const input = await readJson(request);
            if (!input || typeof input !== "object" || Array.isArray(input)) return error(400, "invalid_request", "Cloud backup options are required");
            if ("includeMedia" in input && typeof input.includeMedia !== "boolean") return error(400, "invalid_request", "includeMedia must be a boolean");
            const created = await createCloudBackup({ store, bucket: cloudBucket, includeMedia: input.includeMedia === true });
            const archive = await backupArchiveBytes({ bucket: cloudBucket, id: created.metadata.id, backup: created.backup, manifest: created.manifest });
            const accessToken = await cloudAccessToken({ store, connection, config, secret: oauthSecret, fetchImpl });
            const name = `private-bookmarks-${created.metadata.id}.zip`;
            const remote = await uploadCloudArchive({ provider, accessToken, name, bytes: archive, fetchImpl });
            return json({ ok: true, provider, backupId: created.metadata.id, name, bytes: archive.byteLength, remote });
          }
        }
        if (request.method === "POST" && pathname === "/v1/backups") {
          if (!cloudBucket) return error(501, "not_available", "Backup storage is not configured");
          const input = await readJson(request);
          if (!input || typeof input !== "object" || Array.isArray(input)) return error(400, "invalid_request", "A backup options object is required");
          if ("includeMedia" in input && typeof input.includeMedia !== "boolean") return error(400, "invalid_request", "includeMedia must be a boolean");
          const { metadata } = await createCloudBackup({ store, bucket: cloudBucket, includeMedia: input.includeMedia === true });
          return json(metadata, 201);
        }
        if (request.method === "GET" && pathname === "/v1/backups") {
          if (!cloudBucket) return error(501, "not_available", "Backup storage is not configured");
          return json(await store.listBackups());
        }
        const backupMediaMatch = pathname.match(/^\/v1\/backups\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})$/i);
        if (backupMediaMatch && request.method === "GET") {
          if (!cloudBucket) return error(501, "not_available", "Backup storage is not configured");
          const [, id, mediaId] = backupMediaMatch;
          const { manifest } = await readCloudBackup({ store, bucket: cloudBucket, id });
          const item = mediaManifestEntries(manifest).find((entry) => entry.id.toLocaleLowerCase() === mediaId.toLocaleLowerCase());
          if (!item) return error(404, "not_found", "Backup media not found");
          const bytes = await readBackupMedia(cloudBucket, id, item);
          return new Response(bytes, { headers: { "content-type": item.contentType || "application/octet-stream", "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${item.id}"`, "cache-control": "no-store", "access-control-allow-origin": "*" } });
        }
        const backupMatch = pathname.match(/^\/v1\/backups\/([0-9a-f-]{36})(?:\/(download|restore))?$/i);
        if (backupMatch) {
          if (!cloudBucket) return error(501, "not_available", "Backup storage is not configured");
          const id = backupMatch[1];
          if (request.method === "GET" && backupMatch[2] === "download") {
            const { backup, manifest, libraryBytes, manifestBytes } = await readCloudBackup({ store, bucket: cloudBucket, id });
            if (searchParams.get("format") === "zip") {
              const archive = await backupArchiveBytes({ bucket: cloudBucket, id, backup, manifest, libraryBytes, manifestBytes });
              return new Response(archive, { headers: { "content-type": "application/zip", "content-length": String(archive.byteLength), "content-disposition": `attachment; filename="private-bookmarks-${id}.zip"`, "cache-control": "no-store", "access-control-allow-origin": "*" } });
            }
            const response = json({ backup, manifest });
            response.headers.set("cache-control", "no-store");
            response.headers.set("content-disposition", `attachment; filename=private-bookmarks-${id}.json`);
            return response;
          }
          if (request.method === "DELETE" && !backupMatch[2]) {
            if (!(await deleteCloudBackup({ store, bucket: cloudBucket, id }))) return error(404, "not_found", "Backup not found");
            return json({ ok: true, id });
          }
          if (request.method === "POST" && backupMatch[2] === "restore") {
            const input = await readJson(request);
            if (input.confirm !== true) return error(400, "invalid_backup", "Restore requires explicit confirmation");
            const { backup, manifest } = await readCloudBackup({ store, bucket: cloudBucket, id });
            if (restoreStatementCount(backup) > MAX_RESTORE_STATEMENTS) return error(413, "backup_too_large", `Backup is too large to restore in one D1 batch (maximum ${MAX_RESTORE_STATEMENTS} statements)`);
            let preRestoreBackup;
            try {
              preRestoreBackup = await createCloudBackup({ store, bucket: cloudBucket, kind: "pre_restore", includeMedia: manifest.includeMedia === true });
            } catch (reason) {
              console.error(reason);
              return error(503, "pre_restore_failed", "A pre-restore snapshot could not be created");
            }
            try {
              if (manifest.includeMedia === true) await restoreBackupMedia(cloudBucket, id, manifest);
              await store.replaceData(backup);
            } catch (reason) {
              try {
                if (preRestoreBackup.manifest.includeMedia === true) await restoreBackupMedia(cloudBucket, preRestoreBackup.metadata.id, preRestoreBackup.manifest);
              } catch (rollbackReason) { console.error(rollbackReason); }
              throw reason;
            }
            return json({ ok: true, id, preRestoreBackupId: preRestoreBackup.metadata.id });
          }
        }
        if (request.method === "POST" && pathname === "/v1/restore") {
          const input = await readJson(request);
          if (!input.confirm || input.backup?.format !== "private-bookmarks/v1") return error(400, "invalid_backup", "A confirmed Private Bookmarks backup is required");
          if (restoreStatementCount(input.backup) > MAX_RESTORE_STATEMENTS) return error(413, "backup_too_large", `Backup is too large to restore in one D1 batch (maximum ${MAX_RESTORE_STATEMENTS} statements)`);
          await store.replaceData(input.backup);
          return json({ ok: true });
        }
        if (request.method === "POST" && pathname === "/v1/import") {
          const input = await readJson(request);
          if (!Array.isArray(input?.items) || !input.items.length) return error(400, "invalid_import", "At least one bookmark is required");
          if (input.items.length > MAX_IMPORT_ITEMS) return error(413, "import_too_large", `Import batches cannot exceed ${MAX_IMPORT_ITEMS} bookmarks`);
          const items = input.items.map(bookmarkInput);
          const result = await store.importBookmarks(items);
          return json({ count: result.count ?? result.bookmarks?.length ?? items.length });
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
            capabilities: { mediaUpload: Boolean(mediaBucket), cloudBackup: Boolean(cloudBucket) },
          });
        }
        if (request.method === "POST" && pathname === "/v1/media") {
          if (!mediaBucket) return error(501, "not_available", "Media storage is not configured");
          const { value: type, kind } = mediaType(request);
          const declaredSize = Number(request.headers.get("content-length"));
          if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES) return error(413, "media_too_large", "文件不能超过 5 MB");
          const bytes = await request.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) return error(413, "media_too_large", "文件不能超过 5 MB");
          const requestedId = request.headers.get("x-private-bookmarks-id");
          if (requestedId && !normalizeImportId(requestedId)) throw new TypeError("媒体 ID 必须是 UUID");
          const id = requestedId || crypto.randomUUID();
          const rawName = request.headers.get("x-private-bookmarks-name")?.trim();
          let name = rawName || "";
          if (rawName) {
            try { name = decodeURIComponent(rawName); } catch { /* keep the encoded fallback */ }
          }
          await mediaBucket.put(mediaKey(id), bytes, {
            httpMetadata: {
              contentType: type,
              cacheControl: "public, max-age=31536000, immutable",
              ...(kind === "attachment" ? { contentDisposition: `attachment${name ? `; filename*=UTF-8''${encodeURIComponent(name)}` : ""}` } : {}),
            },
          });
          const url = new URL(request.url);
          url.pathname = `/v1/media/${id}`;
          url.search = `?token=${await mediaToken(id, key)}`;
          return json({ id, url: url.toString(), contentType: type, size: bytes.byteLength, kind, name: name || "" }, 201);
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
          const collectionId = searchParams.get("collection");
          const options = {
            collectionId,
            view: searchParams.get("view"),
            search: searchParams.get("search"),
            sort: searchParams.get("sort"),
          };
          if (collectionId) options.nestedViewLegacy = (await store.getPreferences()).nestedViewLegacy === true;
          return json(await store.listBookmarks(options));
        }
        if (request.method === "GET" && pathname === "/v1/tags") {
          const collectionId = searchParams.get("collection");
          const options = {
            collectionId,
            view: searchParams.get("view"),
            search: searchParams.get("search"),
            sort: searchParams.get("tagsSort") || "_id",
          };
          if (collectionId) options.nestedViewLegacy = (await store.getPreferences()).nestedViewLegacy === true;
          return json(await store.listTags(options));
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
        if (reason?.code === "backup_not_found") return error(404, "not_found", reason.message);
        if (reason?.code === "backup_checksum_mismatch") return error(409, reason.code, reason.message);
        if (reason?.code === "backup_too_large") return error(413, reason.code, reason.message);
        if (reason?.code === "media_backup_missing" || reason?.code === "media_backup_too_large" || reason?.code === "oauth_refresh_failed" || reason?.code === "oauth_token_invalid") return error(409, reason.code, reason.message);
        if (reason?.code === "oauth_not_available" || reason?.code === "oauth_not_configured") return error(501, reason.code, reason.message);
        if (reason?.code === "oauth_not_connected") return error(409, reason.code, reason.message);
        if (reason?.code === "cloud_upload_failed") return error(502, reason.code, reason.message);
        if (reason instanceof TypeError) return error(400, reason.code || "invalid_request", reason.message);
        console.error(reason);
        return error(500, "internal_error", "Unexpected server error");
      }
    },
  };
}
