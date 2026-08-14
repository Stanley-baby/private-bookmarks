import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("workspace header derives its icon from the active scope", () => {
  assert.match(library, /function workspaceIconMarkup\(\)/);
  assert.match(library, /state\.collectionId === "unsorted"/);
  assert.match(library, /favorites: "like"/);
  assert.match(library, /trash: "trash"/);
  assert.match(library, /broken: "broken"/);
  assert.match(library, /unknown: "link"/);
  assert.match(library, /collectionIconByCollectionId/);
  assert.match(library, /item\.icon/);
  assert.match(library, /emoji \? " collection-emoji" : ""/);
  assert.match(css, /\.workspace-icon\.collection-emoji \{[^}]*line-height: 20px;[^}]*place-items: center/);
  assert.match(library, /state\.tag/);
  assert.match(library, /parseSearchQuery\(state\.query\)/);
  assert.match(library, /workspaceIconMarkup\(\)/);
  assert.doesNotMatch(library, /state\.view === "all" && !state\.collectionId \? "cloudActive" : "cloud"/);
});
