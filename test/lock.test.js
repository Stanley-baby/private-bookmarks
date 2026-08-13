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

test("PIN can protect a local-only library without touching bookmarks or connection state", async () => {
  localStorage.removeItem("privateBookmarksLock");
  localStorage.removeItem("instanceConnection");
  localStorage.removeItem("instanceConnectionBackground");
  localStorage.setItem("local-bookmark", JSON.stringify({ title: "kept" }));
  await lock.enablePin("654321", "never");
  assert.equal((await lock.lockState()).locked, false);
  await lock.lockNow();
  assert.equal((await lock.lockState()).locked, true);
  assert.equal(localStorage.getItem("local-bookmark"), JSON.stringify({ title: "kept" }));
  await assert.rejects(() => lock.unlock("654320"), { code: "invalid_pin" });
  await lock.unlock("654321");
  await lock.changePin("654321", "123456");
  await lock.lockNow();
  await assert.rejects(() => lock.unlock("654321"), { code: "invalid_pin" });
  await lock.unlock("123456");
  await lock.disablePin("123456");
  assert.equal((await lock.lockState()).enabled, false);
  assert.equal(localStorage.getItem("local-bookmark"), JSON.stringify({ title: "kept" }));
});

test("locked UI retains the background connection for sync", async () => {
  localStorage.removeItem("privateBookmarksLock");
  const value = { endpoint: "https://background.example", key: "secret" };
  await lock.enablePin("123456", "never", value);
  await lock.lockNow();
  assert.deepEqual(await lock.activeConnection(), value);
  await lock.forgetPin();
  assert.deepEqual(JSON.parse(localStorage.getItem("instanceConnection")), value);
});
