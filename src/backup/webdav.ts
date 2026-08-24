import { decodeBackup, encodeBackup, retainedBackupNames } from "./format.js";
import { exportLibrary, webdavSettings, setWebdavSettings } from "../../extension/shared/local-db.js";
import { restoreLocalLibrary } from "./recovery.js";

export type WebdavSettings = { enabled: boolean; endpoint: string; username: string; password: string; encryptionPassword: string; retention: number; lastBackupAt?: string; lastError?: string };

function auth(settings: WebdavSettings): Record<string, string> {
  return settings.username ? { authorization: `Basic ${btoa(`${settings.username}:${settings.password}`)}` } : {};
}

function directory(settings: WebdavSettings) { return `${settings.endpoint.replace(/\/$/, "")}/private-bookmarks`; }

export function webdavFailure(status: number, method = "GET") {
  const [code, message] = status === 0 ? ["webdav_network_error", "WebDAV 网络连接失败"]
    : status === 401 || status === 403 ? ["webdav_auth_failed", "WebDAV 认证失败"]
      : status === 404 && ["PUT", "MKCOL"].includes(method) ? ["webdav_path_not_writable", "WebDAV 备份路径不可写"]
        : ["webdav_request_failed", `WebDAV ${status}`];
  return Object.assign(new Error(message), { code, status });
}

async function dav(settings: WebdavSettings, path = "", init: RequestInit = {}) {
  let response;
  try { response = await fetch(`${directory(settings)}${path}`, { ...init, headers: { ...auth(settings), ...init.headers } }); }
  catch { throw webdavFailure(0); }
  const method = init.method || "GET";
  if (!response.ok && !(response.status === 404 && ["GET", "PROPFIND", "DELETE"].includes(method)) && !(response.status === 405 && ["PROPFIND", "MKCOL"].includes(method)) && !(response.status === 409 && method === "MKCOL")) throw webdavFailure(response.status, method);
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
  await dav(settings, "", { method: "MKCOL" });
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
  let backup;
  try { backup = await decodeBackup(new Uint8Array(await response.arrayBuffer()), settings.encryptionPassword); }
  catch (error: any) {
    if (error?.code === "backup_corrupt") throw error;
    throw Object.assign(new TypeError("WebDAV 备份密码错误"), { code: "webdav_backup_password_invalid" });
  }
  return restoreLocalLibrary(backup, mode);
}

export async function configureWebdav(input: Partial<WebdavSettings>) {
  if (input.endpoint) {
    const url = new URL(input.endpoint);
    if (url.protocol !== "https:") throw new TypeError("WebDAV地址必须使用HTTPS");
  }
  return setWebdavSettings(input);
}
