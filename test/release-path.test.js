import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("formal scripts and README do not treat the legacy runtime as a release path", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(packageJson.scripts.test, /test\/\*\.test\.js/);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.match(packageJson.scripts["build:extension"], /wxt zip/);
  assert.doesNotMatch(packageJson.scripts.test, /^node --test$/);
  assert.doesNotMatch(packageJson.scripts.check, /extension\/(?:api|background|content|import|library|popup|ui)\.js/);
  assert.doesNotMatch(readme, /Load the legacy extension/);
});
