import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacy = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");

test("legacy migration UI previews the verified package and exposes explicit decisions", () => {
  assert.match(legacy, /previewMigrationPackage/);
  assert.match(legacy, /source\.extensionId/);
  assert.match(legacy, /data-migration-action="import"/);
  assert.match(legacy, /data-migration-action="replace"/);
  assert.match(legacy, /data-migration-action="merge"/);
  assert.match(legacy, /data-migration-action="cancel"/);
  assert.match(legacy, /data-migration-download-safety/);
});
