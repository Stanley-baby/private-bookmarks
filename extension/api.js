const CONNECTION_KEY = "instanceConnection";
const extensionStorage = globalThis.chrome?.storage?.local;

function storedConnection() {
  try {
    return JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null");
  } catch {
    return null;
  }
}

function localAddress(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function connection() {
  return extensionStorage ? (await extensionStorage.get(CONNECTION_KEY))[CONNECTION_KEY] || null : storedConnection();
}

export async function connect(endpoint, key) {
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
  if (extensionStorage) await extensionStorage.remove(CONNECTION_KEY);
  else localStorage.removeItem(CONNECTION_KEY);
}

export async function requestPagePermission(pageUrl) {
  if (!extensionStorage) return true;
  const origin = new URL(pageUrl).origin;
  if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function api(path, init = {}) {
  const config = await connection();
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

export async function saveBookmark(bookmark) {
  return api("/v1/bookmarks", { method: "POST", body: JSON.stringify(bookmark) });
}
