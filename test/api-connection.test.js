import assert from "node:assert/strict";
import test from "node:test";

function store() {
  return {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
}

globalThis.localStorage = store();
globalThis.sessionStorage = store();
let healthStatus = 200;
globalThis.fetch = async () => ({
  status: healthStatus,
  ok: healthStatus >= 200 && healthStatus < 300,
  json: async () => healthStatus === 200 ? { ok: true } : { message: "Worker 不可用" },
});

const api = await import(`../extension/api.js?connection-test=${Date.now()}`);

test("failed Worker health checks do not leave a new local connection", async () => {
  localStorage.removeItem("instanceConnection");
  healthStatus = 503;
  await assert.rejects(() => api.connect("https://worker.example", "secret"), /Worker 不可用/);
  assert.equal(localStorage.getItem("instanceConnection"), null);
});

test("failed reconnects restore the previous local connection", async () => {
  const previous = { endpoint: "https://previous.example", key: "old-secret" };
  localStorage.setItem("instanceConnection", JSON.stringify(previous));
  healthStatus = 503;
  await assert.rejects(() => api.connect("https://worker.example", "new-secret"), /Worker 不可用/);
  assert.deepEqual(JSON.parse(localStorage.getItem("instanceConnection")), previous);
});

test("successful health checks persist the new connection", async () => {
  localStorage.removeItem("instanceConnection");
  healthStatus = 200;
  const value = await api.connect("https://worker.example/path", "secret");
  assert.deepEqual(value, { endpoint: "https://worker.example", key: "secret" });
  assert.deepEqual(JSON.parse(localStorage.getItem("instanceConnection")), value);
});
