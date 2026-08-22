import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigrationTransfer } from "../src/react/migration-transfer.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const buildRoot = `${repoRoot}.output/chrome-mv3`;
const entrypoints = ["library", "popup", "sidepanel", "welcome"];

test("the production WXT build mounts the shared React bundle on every user-facing page", () => {
  try {
    execFileSync(process.execPath, ["node_modules/wxt/bin/wxt.mjs", "build"], {
      cwd: repoRoot,
      env: { ...process.env, WXT_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    });
  } catch (error) {
    assert.fail(String(error?.stderr || error));
  }
  for (const name of entrypoints) {
    const html = readFileSync(`${buildRoot}/${name}.html`, "utf8");
    assert.match(html, /<div id="root"><\/div>/, `${name} needs a React mount`);
    assert.match(html, /<script type="module"[^>]+src="\/chunks\/main-[^\"]+\.js"/, `${name} needs the React bundle`);
    assert.doesNotMatch(html, /(?:src\/)?legacy\//, `${name} must not load the legacy runtime`);
  }
});

test("migration file selection previews without applying until an explicit decision", async () => {
  let applyCalls = 0;
  let previewOptions;
  const transfer = createMigrationTransfer({
    preview: async (value, options) => {
      assert.equal(value, "migration-package");
      previewOptions = options;
      return { status: "preview" };
    },
    apply: async (_value, mode) => {
      applyCalls += 1;
      return { status: mode === "cancel" ? "cancelled" : "applied", mode };
    },
  });

  assert.equal(await transfer.apply("import"), null);
  await assert.doesNotReject(() => transfer.select({ text: async () => "migration-package" }));
  assert.deepEqual(previewOptions, { includeCurrent: true });
  assert.equal(applyCalls, 0);
  assert.deepEqual(await transfer.apply("cancel"), { status: "cancelled", mode: "cancel" });
  assert.equal(applyCalls, 1);
});
