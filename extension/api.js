import { activeConnection, forgetPin, lockConfig, lockState } from "./lock.js?v=20260808-pin2";

const CONNECTION_KEY = "instanceConnection";
const extensionStorage = globalThis.chrome?.storage?.local;

function localAddress(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function connection() {
  return activeConnection();
}

export async function connect(endpoint, key) {
  const configuredLock = await lockConfig();
  if (configuredLock && (await lockState()).locked) throw Object.assign(new TypeError("请先解锁应用"), { code: "locked" });
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && (extensionStorage || url.protocol !== "http:" || !localAddress(url))) throw new TypeError("私有实例地址必须使用 HTTPS");
  if (extensionStorage && !await chrome.permissions.request({ origins: [`${url.origin}/*`] })) throw new TypeError("未获得私有实例地址的访问权限");
  const value = { endpoint: url.origin, key: String(key).trim() };
  if (!value.key) throw new TypeError("需要访问密钥");
  if (extensionStorage) await extensionStorage.set({ [CONNECTION_KEY]: value });
  else localStorage.setItem(CONNECTION_KEY, JSON.stringify(value));
  await api("/v1/health");
  return value;
}

export async function disconnect() {
  if (await lockConfig()) {
    await forgetPin();
    if (extensionStorage) return extensionStorage.remove([CONNECTION_KEY, "instanceConnectionBackground"]);
    localStorage.removeItem(CONNECTION_KEY);
    localStorage.removeItem("instanceConnectionBackground");
    return;
  }
  if (extensionStorage) await extensionStorage.remove(CONNECTION_KEY);
  else localStorage.removeItem(CONNECTION_KEY);
}

export async function requestPagePermission(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { throw new TypeError("只能保存 HTTP(S) 页面"); }
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("只能保存 HTTP(S) 页面");
  if (!extensionStorage) return true;
  const origin = url.origin;
  if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function api(path, init = {}) {
  const config = await activeConnection();
  if (!config) throw new TypeError("请先连接私有实例");
  const response = await fetch(`${config.endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-private-bookmarks-key": config.key,
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.message || "Request failed"), { status: response.status, code: body?.code });
  return body;
}

export async function uploadCover(bytes, contentType, id) {
  return api("/v1/media", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": contentType,
      ...(id ? { "x-private-bookmarks-id": id } : {}),
    },
  });
}

export async function saveBookmark(bookmark) {
  return api("/v1/bookmarks", { method: "POST", body: JSON.stringify(bookmark) });
}
