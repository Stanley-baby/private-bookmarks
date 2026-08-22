import { lockConfig, lockState } from "./lock.js";

const CONNECTION_KEY = "instanceConnection";
const BACKGROUND_CONNECTION_KEY = "instanceConnectionBackground";
const CONNECTION_LOCKED_MESSAGE = "请先解除 PIN 后修改私有实例连接";

export class WorkerClientError extends Error {
  constructor(message, status, code, cause) {
    super(message, { cause });
    this.name = "WorkerClientError";
    this.status = status;
    this.code = code;
  }
}

function fail(message, status, code, cause) {
  throw new WorkerClientError(message, status, code, cause);
}

function browserStorage() {
  const extensionStorage = globalThis.chrome?.storage?.local;
  if (extensionStorage) {
    return {
      async get(key) { return (await extensionStorage.get(key))?.[key]; },
      async set(key, value) { await extensionStorage.set({ [key]: value }); },
      async remove(key) { await extensionStorage.remove(key); },
    };
  }
  const local = globalThis.localStorage;
  return {
    async get(key) {
      try { return JSON.parse(local?.getItem(key) || "null"); } catch { return null; }
    },
    async set(key, value) { local?.setItem(key, JSON.stringify(value)); },
    async remove(key) { local?.removeItem(key); },
  };
}

function validEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { fail("私有实例地址无效", 400, "invalid_endpoint"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) fail("私有实例地址必须使用 HTTPS", 400, "invalid_endpoint");
  return url.origin;
}

function parseConnection(stored, key) {
  const value = stored?.[key] || stored;
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" || typeof value.key !== "string" || !value.key.trim()) return null;
  return { endpoint: value.endpoint, key: value.key };
}

export function createWorkerClient({
  fetchImpl = globalThis.fetch,
  storage = browserStorage(),
  permissions = globalThis.chrome?.permissions,
} = {}) {
  const readConnections = async () => ({
    primary: parseConnection(await storage.get(CONNECTION_KEY), CONNECTION_KEY),
    background: parseConnection(await storage.get(BACKGROUND_CONNECTION_KEY), BACKGROUND_CONNECTION_KEY),
  });
  const readConnection = async () => {
    const { primary, background } = await readConnections();
    return primary || background;
  };

  const connection = () => readConnection();
  const request = async (path, init = {}) => {
    const config = await readConnection();
    if (!config) fail("尚未配置私有实例", 503, "not_configured");
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) fail("Worker 请求路径必须是相对路径", 400, "invalid_path");
    const base = new URL(config.endpoint);
    const target = new URL(path, base);
    if (target.origin !== base.origin) fail("Worker 请求路径必须保持同源", 400, "invalid_path");
    const url = target.toString();
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-private-bookmarks-key": config.key,
          ...(init.headers || {}),
        },
      });
      let body = null;
      if (response.status !== 204) {
        if (typeof response.text === "function") {
          const text = await response.text();
          try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        } else body = await response.json();
      }
      if (!response.ok) {
        const message = typeof body === "object" && body?.message ? body.message : `Worker 请求失败（${response.status}）`;
        const code = typeof body === "object" && body?.code ? body.code : response.status >= 500 ? "server_error" : "request_failed";
        throw new WorkerClientError(message, response.status, code);
      }
      return body;
    } catch (error) {
      if (error instanceof WorkerClientError) throw error;
      throw new WorkerClientError("无法连接私有实例", 0, "network_error", error);
    }
  };

  const health = () => request("/v1/health");
  const connect = async (endpoint, key) => {
    const configuredLock = await lockConfig();
    if (configuredLock && (await lockState()).locked) throw Object.assign(new TypeError("请先解锁应用"), { code: "locked" });
    const previous = await readConnections();
    if (previous.background) fail(CONNECTION_LOCKED_MESSAGE, 423, "connection_locked");
    const normalizedEndpoint = validEndpoint(endpoint);
    const normalizedKey = String(key).trim();
    if (!normalizedKey) fail("需要访问密钥", 400, "invalid_key");
    if (permissions && !(await permissions.request({ origins: [`${normalizedEndpoint}/*`] }))) fail("未获得私有实例地址的访问权限", 403, "permission_denied");
    const next = { endpoint: normalizedEndpoint, key: normalizedKey };
    await storage.set(CONNECTION_KEY, next);
    try {
      await health();
      return next;
    } catch (error) {
      try {
        if (previous.primary) await storage.set(CONNECTION_KEY, previous.primary);
        else await storage.remove(CONNECTION_KEY);
      } catch { /* preserve the health or network failure */ }
      throw error;
    }
  };

  const disconnect = async () => {
    const { background } = await readConnections();
    if (background) fail(CONNECTION_LOCKED_MESSAGE, 423, "connection_locked");
    return storage.remove(CONNECTION_KEY);
  };
  const search = (query, options = {}) => {
    const params = new URLSearchParams({ ...options, search: query });
    return request(`/v1/bookmarks?${params}`);
  };
  const sync = {
    pull: ({ cursor = "", limit = 200 } = {}) => request(`/v1/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=${encodeURIComponent(String(limit))}`),
    push: (changes) => request("/v1/sync/push", { method: "POST", body: JSON.stringify({ changes }) }),
  };
  const upload = (bytes, contentType, id, options = {}) => request("/v1/media", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": contentType,
      ...(id ? { "x-private-bookmarks-id": id } : {}),
      ...(options.kind ? { "x-private-bookmarks-kind": options.kind } : {}),
      ...(options.name ? { "x-private-bookmarks-name": encodeURIComponent(options.name) } : {}),
    },
  });

  return { connection, connect, disconnect, request, health, search, sync, media: { upload } };
}

export const workerClient = createWorkerClient();
