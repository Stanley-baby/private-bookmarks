import { activeConnection, lockConfig, lockState } from "./lock.js?v=20260808-pin2";
import { localApi } from "./shared/local-api.js";
import { workerClient } from "./shared/worker-client.js";

export async function connection() {
  return activeConnection();
}

export async function connect(endpoint, key) {
  const configuredLock = await lockConfig();
  if (configuredLock && (await lockState()).locked) throw Object.assign(new TypeError("请先解锁应用"), { code: "locked" });
  return workerClient.connect(endpoint, key);
}

export async function disconnect() {
  return workerClient.disconnect();
}

export async function requestPagePermission(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { throw new TypeError("只能保存 HTTP(S) 页面"); }
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("只能保存 HTTP(S) 页面");
  const extensionStorage = globalThis.chrome?.storage?.local;
  if (!extensionStorage) return true;
  const origin = url.origin;
  if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

// Compatibility forwarding for legacy pages: the shared modules own both routes.
export async function api(path, init = {}) {
  return (await activeConnection()) ? workerClient.request(path, init) : localApi.request(path, init);
}

export function uploadCover(bytes, contentType, id) {
  return api("/v1/media", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": contentType,
      ...(id ? { "x-private-bookmarks-id": id } : {}),
    },
  });
}

export function saveBookmark(bookmark) {
  return api("/v1/bookmarks", { method: "POST", body: JSON.stringify(bookmark) });
}
