import assert from "node:assert/strict";
import test from "node:test";
import { restoreLocalLibrary, runRemoteRecovery } from "../src/backup/recovery.js";

test("local restore validates a safety snapshot, pauses sync, and resumes only after validation", async () => {
  const original = { bookmarks: [{ id: "local", revision: 1 }], collections: [], preferences: { theme: "dark" } };
  const incoming = { bookmarks: [{ id: "remote", revision: 2 }], collections: [], preferences: { theme: "light" } };
  const calls = [];
  let library = structuredClone(original);

  const result = await restoreLocalLibrary(incoming, "replace", {
    exportLibrary: async () => structuredClone(library),
    exportSafety: async () => ({ format: "private-bookmarks/migration", checksum: "safe" }),
    validateSafety: async (safety) => { calls.push(["validateSafety", safety.checksum]); },
    replaceLibrary: async (value) => { calls.push(["replace", value.bookmarks[0].id]); library = structuredClone(value); },
    mergeLibrary: async () => assert.fail("replace must not merge"),
    syncSettings: async () => ({ enabled: true, intervalMinutes: 15 }),
    setSyncSettings: async (value) => { calls.push(["sync", value.enabled]); },
    setRecoveryState: async (value) => { calls.push(["recovery", value]); },
    stopSync: async () => { calls.push(["stop"]); },
    scheduleSync: async () => { calls.push(["schedule"]); },
  });

  assert.deepEqual(library, incoming);
  assert.deepEqual(result.safety, { format: "private-bookmarks/migration", checksum: "safe" });
  assert.deepEqual(calls, [["validateSafety", "safe"], ["recovery", true], ["sync", false], ["stop"], ["replace", "remote"], ["sync", true], ["schedule"], ["recovery", false]]);
});

test("failed local restore leaves sync paused and rolls back a replace", async () => {
  const original = { bookmarks: [{ id: "local", revision: 1 }], collections: [], preferences: {} };
  const incoming = { bookmarks: [{ id: "remote", revision: 2 }], collections: [], preferences: {} };
  const calls = [];
  let library = structuredClone(original);

  await assert.rejects(() => restoreLocalLibrary(incoming, "replace", {
    exportLibrary: async () => structuredClone(library),
    exportSafety: async () => ({ checksum: "safe" }),
    validateSafety: async () => {},
    replaceLibrary: async (value) => { calls.push(["replace", value.bookmarks[0].id]); library = structuredClone(value); },
    mergeLibrary: async () => assert.fail("replace must not merge"),
    syncSettings: async () => ({ enabled: true }),
    setSyncSettings: async (value) => { calls.push(["sync", value.enabled]); },
    setRecoveryState: async (value) => { calls.push(["recovery", value]); },
    stopSync: async () => { calls.push(["stop"]); },
    scheduleSync: async () => { calls.push(["schedule"]); },
    validateRestored: async () => { throw new Error("restore validation failed"); },
  }), /restore validation failed/);

  assert.deepEqual(library, original);
  assert.deepEqual(calls, [["recovery", true], ["sync", false], ["stop"], ["replace", "remote"], ["replace", "local"], ["recovery", false]]);
});

test("failed recovery stays locked when its safety rollback also fails", async () => {
  const calls = [];
  let replacements = 0;

  await assert.rejects(() => restoreLocalLibrary({ bookmarks: [], collections: [] }, "merge", {
    exportLibrary: async () => ({ bookmarks: [], collections: [] }),
    exportSafety: async () => ({ checksum: "safe" }),
    validateSafety: async () => {},
    mergeLibrary: async () => { throw new Error("merge failed"); },
    replaceLibrary: async () => { replacements += 1; throw new Error("rollback failed"); },
    syncSettings: async () => ({ enabled: true }),
    setSyncSettings: async (value) => { calls.push(["sync", value.enabled]); },
    setRecoveryState: async (value) => { calls.push(["recovery", value]); },
    stopSync: async () => { calls.push(["stop"]); },
    scheduleSync: async () => assert.fail("failed recovery must not resume sync"),
  }), /merge failed/);

  assert.equal(replacements, 1);
  assert.deepEqual(calls, [["recovery", true], ["sync", false], ["stop"]]);
});

test("remote restore shares the safety snapshot and sync pause coordinator", async () => {
  const calls = [];
  const result = await runRemoteRecovery(async () => "remote-restored", {
    exportSafety: async () => ({ checksum: "safe" }),
    validateSafety: async () => { calls.push(["validate"]); },
    syncSettings: async () => ({ enabled: true }),
    setSyncSettings: async (value) => { calls.push(["sync", value.enabled]); },
    setRecoveryState: async (value) => { calls.push(["recovery", value]); },
    stopSync: async () => { calls.push(["stop"]); },
    scheduleSync: async () => { calls.push(["schedule"]); },
  });

  assert.deepEqual(result, { safety: { checksum: "safe" }, result: "remote-restored" });
  assert.deepEqual(calls, [["validate"], ["recovery", true], ["sync", false], ["stop"], ["sync", true], ["schedule"], ["recovery", false]]);
});
