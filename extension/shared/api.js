import { localApi } from "./local-api.js";
import { workerClient } from "./worker-client.js";

export const connection = workerClient.connection;

export const connect = workerClient.connect;

export const disconnect = workerClient.disconnect;

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

export async function api(path, init = {}) {
  return (await workerClient.connection()) ? workerClient.request(path, init) : localApi.request(path, init);
}

export const uploadCover = (bytes, contentType, id) => workerClient.media.upload(bytes, contentType, id);

export function saveBookmark(bookmark) {
  return api("/v1/bookmarks", { method: "POST", body: JSON.stringify(bookmark) });
}
