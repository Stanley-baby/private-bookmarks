import { collectionSubtreeIds } from "./collection-model.js";
import { mediaArchiveEntries } from "./media-archive.js";

/** @param {any} backup @param {string | null} collectionId @param {string[] | null} selectedIds */
export function scopedExport(backup, collectionId = null, selectedIds = null) {
  const selected = selectedIds?.length ? new Set(selectedIds) : null;
  const collectionIds = collectionId ? collectionSubtreeIds(backup.collections || [], collectionId) : null;
  const bookmarks = (backup.bookmarks || []).filter((item) => !item.deletedAt && (selected ? selected.has(item.id) : !collectionIds || collectionIds.has(item.collectionId)));
  const usedCollections = new Set(bookmarks.map((item) => item.collectionId));
  if (collectionId) usedCollections.add(collectionId);
  return {
    ...backup,
    bookmarks,
    collections: selected || collectionIds ? (backup.collections || []).filter((item) => usedCollections.has(item.id)) : backup.collections || [],
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportCsv(backup) {
  const rows = [["id", "title", "note", "excerpt", "url", "tags", "created", "cover", "highlights", "favorite"]];
  for (const item of backup.bookmarks || []) rows.push([
    item.id || "", item.title || "", item.note || "", item.description || "", item.link || "", (item.tags || []).join(","), item.createdAt || "", item.cover || item.coverRef?.url || "", item.highlights?.length ? JSON.stringify(item.highlights) : "", item.favorite ? "true" : "false",
  ]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function exportTxt(backup) {
  const links = (backup.bookmarks || []).map((item) => item.link).filter(Boolean);
  return links.length ? `${links.join("\n")}\n` : "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function exportHtml(backup) {
  const links = (backup.bookmarks || []).map((item) => {
    const tags = (item.tags || []).join(","), cover = item.cover || item.coverRef?.url || "";
    return `<DT><A HREF="${escapeHtml(item.link)}" TAGS="${escapeHtml(tags)}" DATA-COVER="${escapeHtml(cover)}" DATA-IMPORTANT="${item.favorite ? "true" : "false"}">${escapeHtml(item.title || item.link)}</A>${item.note ? `\n<DD>${escapeHtml(item.note)}` : ""}`;
  }).join("\n");
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Private Bookmarks</TITLE>\n<H1>Private Bookmarks</H1>\n<DL><p>\n${links}\n</DL><p>\n`;
}

function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function zip(entries) {
  const encoder = new TextEncoder(), local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes), checksum = crc32(bytes);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x800, true); header.setUint32(14, checksum, true); header.setUint32(18, bytes.byteLength, true); header.setUint32(22, bytes.byteLength, true); header.setUint16(26, name.byteLength, true);
    local.push(new Uint8Array(header.buffer), name, bytes);
    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true); directory.setUint16(8, 0x800, true); directory.setUint32(16, checksum, true); directory.setUint32(20, bytes.byteLength, true); directory.setUint32(24, bytes.byteLength, true); directory.setUint16(28, name.byteLength, true); directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name); offset += 30 + name.byteLength + bytes.byteLength;
  }
  const localBytes = concat(local), centralBytes = concat(central), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, centralBytes.byteLength, true); end.setUint32(16, localBytes.byteLength, true);
  return concat([localBytes, centralBytes, new Uint8Array(end.buffer)]);
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function exportZip(backup, options = {}) {
  const encoder = new TextEncoder(), media = await mediaArchiveEntries(backup, { continueOnError: true, ...options });
  const files = [
    { name: "library.json", bytes: encoder.encode(`${JSON.stringify(backup, null, 2)}\n`) },
    { name: "export.csv", bytes: encoder.encode(exportCsv(backup)) },
    { name: "export.html", bytes: encoder.encode(exportHtml(backup)) },
    { name: "export.txt", bytes: encoder.encode(exportTxt(backup)) },
    ...media,
  ];
  const manifest = { format: "private-bookmarks/export-zip-v1", files: await Promise.all(files.map(async ({ name, bytes }) => ({ name, bytes: bytes.byteLength, sha256: await sha256(bytes) }))), failures: media.failures || [] };
  const archive = zip([...files, { name: "manifest.json", bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) }]);
  archive.failures = media.failures || [];
  return archive;
}

export function exportSummary(backup) {
  const media = (backup.bookmarks || []).flatMap((item) => [item.cover, ...(item.media || [])]).filter(Boolean);
  return { bookmarks: (backup.bookmarks || []).length, collections: (backup.collections || []).length, media: media.length, estimatedBytes: new TextEncoder().encode(JSON.stringify(backup)).byteLength };
}
