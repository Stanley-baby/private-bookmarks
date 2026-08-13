import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../wxt.config.ts", import.meta.url), "utf8");

test("WXT config keeps permissions disjoint and ignores generated output", () => {
  assert.doesNotMatch(config, /optional_permissions\s*:\s*\[[^\]]*\btabs\b/);
  assert.match(config, /watchOptions:\s*\{\s*ignored:\s*\[\s*["']\*\*\/\.output\/\*\*["']/);
});
