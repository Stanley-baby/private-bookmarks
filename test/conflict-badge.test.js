import assert from "node:assert/strict";
import test from "node:test";
import { conflictBadgeText } from "../extension/shared/conflict-badge.js";

test("conflict badge text stays readable for empty, ordinary, and large counts", () => {
  assert.equal(conflictBadgeText(0), "");
  assert.equal(conflictBadgeText(7), "7");
  assert.equal(conflictBadgeText(100), "99+");
});
