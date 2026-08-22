import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const db = readFileSync(new URL("../extension/shared/local-db.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/entrypoints/background.js", import.meta.url), "utf8");

test("action mode is persisted and applied to the browser action", () => {
  assert.match(db, /put\(mode, "actionMode"\)/);
  assert.match(background, /setPopup\(\{ popup: "" \}\)/);
  assert.match(background, /setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/);
  assert.match(background, /welcome\.html/);
});
