import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoints = ["library", "popup", "sidepanel", "welcome"];

test("all user-facing WXT pages mount the same React entrypoint", () => {
  for (const name of entrypoints) {
    const html = readFileSync(new URL(`../src/entrypoints/${name}.html`, import.meta.url), "utf8");
    assert.match(html, /<div id="root"><\/div>/, `${name} needs a React mount`);
    assert.match(html, /<script type="module" src="\.\.\/react\/main\.tsx"><\/script>/, `${name} needs the React entrypoint`);
    assert.doesNotMatch(html, /(?:src\/)?legacy\//, `${name} must not load the legacy runtime`);
  }
});

test("React startup keeps local setup explicit and migration decisions user-driven", () => {
  const main = readFileSync(new URL("../src/react/main.tsx", import.meta.url), "utf8");
  assert.match(main, /initialized\(\)\.then\(setReady\)/);
  assert.match(main, /创建空资料库/);
  assert.match(main, /导入迁移包/);
  assert.match(main, /previewMigrationPackage/);
  assert.match(main, /applyMigrationPackage/);
});
