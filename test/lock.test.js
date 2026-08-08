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
const lock = await import(`../extension/lock.js?test=${Date.now()}`);

test("PIN lock encrypts connection, unlocks, and auto-locks idle sessions", async () => {
  const value = { endpoint: "https://example.test", key: "secret" };
  localStorage.setItem("instanceConnection", JSON.stringify(value));
  await lock.enablePin("123456", "1", value);

  assert.equal(localStorage.getItem("instanceConnection"), null);
  assert.equal((await lock.lockState()).locked, false);
  await lock.lockNow();
  assert.equal((await lock.lockState()).locked, true);
  await assert.rejects(() => lock.unlock("123457"), { code: "invalid_pin" });
  assert.deepEqual(await lock.unlock("123456"), value);

  const session = JSON.parse(sessionStorage.getItem("privateBookmarksUnlocked"));
  session.lastActivityAt = Date.now() - 61_000;
  sessionStorage.setItem("privateBookmarksUnlocked", JSON.stringify(session));
  assert.equal((await lock.lockState()).locked, true);
  await lock.forgetPin();
  assert.equal((await lock.lockState()).enabled, false);
});
