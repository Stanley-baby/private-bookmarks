import assert from "node:assert/strict";
import test from "node:test";
import { exportCsv, exportHtml, exportTxt, exportZip, scopedExport } from "../extension/shared/export-formats.js";
import { parseImportText } from "../extension/import.js";

const backup = {
  format: "private-bookmarks/v1",
  bookmarks: [
    { id: "one", link: "https://example.com/one", title: "One", tags: ["read"], collectionId: "parent", createdAt: "2026-08-24T00:00:00.000Z" },
    { id: "two", link: "https://example.com/two", title: "Two", tags: [], collectionId: "child", createdAt: "2026-08-24T00:00:00.000Z" },
    { id: "three", link: "https://example.com/three", title: "Three", tags: [], collectionId: "other", createdAt: "2026-08-24T00:00:00.000Z" },
  ],
  collections: [{ id: "parent", name: "Parent", parentId: null }, { id: "child", name: "Child", parentId: "parent" }, { id: "other", name: "Other", parentId: null }],
};

test("scoped exports include only the requested collection tree or selection", () => {
  assert.deepEqual(scopedExport(backup, "parent").bookmarks.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(scopedExport(backup, null, ["three"]).bookmarks.map((item) => item.id), ["three"]);
});

test("CSV, HTML, and TXT exports round-trip through their import parsers", () => {
  const scoped = scopedExport(backup, "parent");
  assert.deepEqual(parseImportText(exportCsv(scoped), { name: "export.csv" }).items.map((item) => item.link), ["https://example.com/one", "https://example.com/two"]);
  assert.deepEqual(parseImportText(exportHtml(scoped), { name: "export.html" }).items.map((item) => item.link), ["https://example.com/one", "https://example.com/two"]);
  assert.deepEqual(parseImportText(exportTxt(scoped), { name: "export.txt" }).items.map((item) => item.link), ["https://example.com/one", "https://example.com/two"]);
});

test("ZIP exports bind media and metadata with a checksum manifest", async () => {
  const archive = await exportZip({ ...scopedExport(backup, "parent"), bookmarks: [{ ...backup.bookmarks[0], media: ["data:text/plain,hello"] }] });
  const names = [], view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength), decoder = new TextDecoder();
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const nameSize = view.getUint16(offset + 26, true), size = view.getUint32(offset + 18, true);
    names.push(decoder.decode(archive.slice(offset + 30, offset + 30 + nameSize)));
    offset += 30 + nameSize + size;
  }
  assert.deepEqual(names, ["library.json", "export.csv", "export.html", "export.txt", "uploads/data-1.txt", "uploads.json", "manifest.json"]);
  assert.match(decoder.decode(archive), /private-bookmarks\/export-zip-v1/);
  assert.match(decoder.decode(archive), /"sha256"/);
});
