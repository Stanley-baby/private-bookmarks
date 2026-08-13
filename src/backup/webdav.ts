import { decodeBackup, encodeBackup, retainedBackupNames } from "./format.js";
import { exportLibrary, replaceLibrary, mergeLibrary, webdavSettings, setWebdavSettings } from "../local/db";

export type WebdavSettings = { enabled: boolean; endpoint: string; username: string; password: string; encryptionPassword: string; retention: number; lastBackupAt?: string; lastError?: string };

function auth(settings: WebdavSettings): Record<string, string> {
  return settings.username ? { authorization: `Basic ${btoa(`${settings.username}:${settings.password}`)}` } : {};
}

function directory(settings: WebdavSettings) { return `${settings.endpoint.replace(/\/$/, "")}/private-bookmarks`; }

async function dav(settings: WebdavSettings, path = "", init: RequestInit = {}) {
  const response = await fetch(`${directory(settings)}${path}`, { ...init, headers: { ...auth(settings), ...init.headers } });
  if (!response.ok && response.status !== 404 && response.status !== 405) throw new Error(`WebDAV ${response.status}`);
  return response;
}

export async function listBackups(input?: WebdavSettings) {
  const settings = input || await webdavSettings();
  const response = await dav(settings, "", { method: "PROPFIND", headers: { depth: "1" } });
  if (response.status === 404) return [];
  const text = await response.text();
  return [...text.matchAll(/private-bookmarks-[^<%/]+\.(?:json|pbe)/g)].map((match) => decodeURIComponent(match[0])).filter((name, index, all) => all.indexOf(name) === index).sort().reverse();
}

export async function createWebdavBackup(input?: WebdavSettings) {
  const settings = input || await webdavSettings();
  if (!settings.enabled || !settings.endpoint) return { skipped: true };
  await fetch(directory(settings), { method: "MKCOL", headers: auth(settings) });
  const encoded = await encodeBackup(await exportLibrary(), settings.encryptionPassword);
  const stamp = new Date().toISOString().replace(/:/g, "-");
  const name = `private-bookmarks-${stamp}.${encoded.extension}`;
  await dav(settings, `/${name}`, { method: "PUT", headers: { "content-type": encoded.contentType }, body: encoded.body });
  const names = await listBackups(settings);
  const retained = new Set(retainedBackupNames(names, settings.retention));
  await Promise.all(names.filter((item) => !retained.has(item)).map((item) => dav(settings, `/${encodeURIComponent(item)}`, { method: "DELETE" })));
  await setWebdavSettings({ lastBackupAt: new Date().toISOString(), lastError: "" });
  return { name };
}

export async function restoreWebdavBackup(name: string, mode: "replace" | "merge", input?: WebdavSettings) {
  const settings = input || await webdavSettings();
  const response = await dav(settings, `/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error("找不到WebDAV备份");
  const backup = await decodeBackup(new Uint8Array(await response.arrayBuffer()), settings.encryptionPassword);
  const safety = await exportLibrary();
  if (mode === "replace") await replaceLibrary(backup);
  else await mergeLibrary(backup);
  return { safety, restored: backup };
}

export async function configureWebdav(input: Partial<WebdavSettings>) {
  if (input.endpoint) {
    const url = new URL(input.endpoint);
    if (url.protocol !== "https:") throw new TypeError("WebDAV地址必须使用HTTPS");
  }
  return setWebdavSettings(input);
}
