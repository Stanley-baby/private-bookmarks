import assert from "node:assert/strict";
import test from "node:test";
import { conflictRecoveryCopy, conflictRecoveryCopies } from "../extension/shared/local-model.js";

test("conflict resolution keeps the discarded bookmark as an outbox-ready recovery copy", () => {
  const conflict = {
    entity: "bookmark",
    local: { id: "bookmark", title: "Local", link: "https://local.example", collectionId: "unsorted", revision: 3 },
    remote: { id: "bookmark", title: "Cloud", link: "https://cloud.example", collectionId: "unsorted", revision: 4 },
  };

  assert.deepEqual(conflictRecoveryCopy(conflict, "local", "recovery"), {
    id: "recovery", title: "Cloud（冲突恢复副本）", link: "https://cloud.example", collectionId: "unsorted", revision: 1,
  });
  assert.equal(conflictRecoveryCopy(conflict, "cloud", "recovery").title, "Local（冲突恢复副本）");
  assert.deepEqual(conflictRecoveryCopies(conflict, { title: "cloud", link: "local" }).map((item) => item.title).sort(), ["Cloud（冲突恢复副本）", "Local（冲突恢复副本）"]);
});
