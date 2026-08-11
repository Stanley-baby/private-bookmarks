import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentRequest, shouldShowGlobalLoading } from "../extension/ui.js?v=20260811-navigation1";

test("global loading is reserved for the first render", () => {
  assert.equal(shouldShowGlobalLoading(false), true);
  assert.equal(shouldShowGlobalLoading(true), false);
});

test("stale collection responses cannot win a newer navigation", () => {
  assert.equal(isCurrentRequest(4, 4), true);
  assert.equal(isCurrentRequest(4, 5), false);
});
