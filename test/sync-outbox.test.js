import assert from "node:assert/strict";
import test from "node:test";
import { confirmedOutboxIds } from "../src/local/sync.ts";

test("incremental sync retains outbox records not explicitly acknowledged by the server", () => {
  const pending = [
    { id: "applied", entity: "bookmark", record: { id: "applied" } },
    { id: "unknown", entity: "bookmark", record: { id: "unknown" } },
    { id: "conflicted", entity: "collection", record: { id: "conflicted" } },
  ];
  const pushed = {
    applied: [{ entity: "bookmark", record: { id: "applied" } }],
    conflicts: [{ entity: "collection", id: "conflicted" }],
  };

  assert.deepEqual(confirmedOutboxIds(pending, pushed), ["applied"]);
});
