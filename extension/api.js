const CONNECTION_KEY = "instanceConnection";

export async function connection() {
  return (await chrome.storage.local.get(CONNECTION_KEY))[CONNECTION_KEY] || null;
}

export async function connect(endpoint, key) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new TypeError("The Private Instance URL must use HTTPS");
  const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
  if (!granted) throw new TypeError("Permission for the Private Instance URL was not granted");
  const value = { endpoint: url.origin, key: String(key).trim() };
  if (!value.key) throw new TypeError("An access key is required");
  await chrome.storage.local.set({ [CONNECTION_KEY]: value });
  await api("/v1/health");
  return value;
}

export async function disconnect() {
  await chrome.storage.local.remove(CONNECTION_KEY);
}

export async function requestPagePermission(pageUrl) {
  const origin = new URL(pageUrl).origin;
  if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function api(path, init = {}) {
  const config = await connection();
  if (!config) throw new TypeError("Connect a Private Instance first");
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
