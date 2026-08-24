import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../wxt.config.ts", import.meta.url), "utf8");

test("WXT config requests tab and page access only when a capture flow needs it", () => {
  assert.match(config, /optional_permissions\s*:\s*\[[^\]]*\btabs\b/);
  assert.match(config, /optional_host_permissions\s*:\s*\[[^\]]*http:\/\/\*\/\*/);
  assert.match(config, /optional_host_permissions\s*:\s*\[[^\]]*https:\/\/\*\/\*/);
  assert.match(config, /watchOptions:\s*\{\s*ignored:\s*\[\s*["']\*\*\/\.output\/\*\*["']/);
});
