import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { decodeBackup, encodeBackup, retainedBackupNames } from "../src/backup/format.js";

globalThis.btoa ||= (value) => Buffer.from(value, "binary").toString("base64");
globalThis.atob ||= (value) => Buffer.from(value, "base64").toString("binary");

test("WebDAV backup encryption round-trips and rejects the wrong password", async () => {
  const backup = { version: 1, bookmarks: [{ id: "one", title: "Private" }] };
  const encoded = await encodeBackup(backup, "correct horse", webcrypto);
  assert.equal(encoded.extension, "pbe");
  assert.deepEqual(await decodeBackup(encoded.body, "correct horse", webcrypto), backup);
  await assert.rejects(() => decodeBackup(encoded.body, "wrong", webcrypto));
});

test("WebDAV retention keeps the newest configured backup count", () => {
  const names = Array.from({ length: 12 }, (_, index) => `private-bookmarks-2026-08-${String(index + 1).padStart(2, "0")}T00-00-00.000Z.json`);
  assert.deepEqual(retainedBackupNames(names, 3), names.slice(-3).reverse());
  assert.equal(retainedBackupNames(names, 100).length, 12);
});

test("WebDAV backup keeps local custom cover data", async () => {
  const cover = "data:image/png;base64,AQID";
  const backup = { version: 1, bookmarks: [{ id: "one", cover }] };
  const encoded = await encodeBackup(backup);
  assert.equal((await decodeBackup(encoded.body)).bookmarks[0].cover, cover);
});
