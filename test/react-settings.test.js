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

test("React lock setup migrates the Worker connection into protected storage", async () => {
  const { enableAppLock } = await import("../src/react/settings.js");
  const lock = await import(`../extension/shared/lock.js?react-settings=${Date.now()}`);
  const connection = { endpoint: "https://worker.example", key: "secret" };

  await enableAppLock(lock.enablePin, "123456", "never", async () => connection);

  assert.equal(localStorage.getItem("instanceConnection"), null);
  await lock.lockNow();
  assert.deepEqual(await lock.activeConnection(), connection);
});
