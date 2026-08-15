import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("workspace header derives its icon from the active scope", () => {
  assert.match(library, /function workspaceIconMarkup\(collectionId = state\.collectionId\)/);
  assert.match(library, /state\.collectionId === "unsorted"/);
  assert.match(library, /collectionIconByCollectionId/);
  assert.match(library, /item\.icon/);
  assert.match(library, /emoji \? " collection-emoji" : ""/);
  assert.match(library, /treeIcons\.tag = treeIcons\.searchTag;/);
  assert.doesNotMatch(library, /treeIcon\(icon, icon === "tag"\)/);
  assert.match(css, /\.workspace-icon\.collection-emoji \{[^}]*line-height: 20px;[^}]*place-items: center/);
  const iconMarkup = library.match(/function workspaceIconMarkup\(collectionId = state\.collectionId\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(iconMarkup, /state\.tag|parseSearchQuery\(state\.query\)/);
  assert.match(iconMarkup, /state\.view === "all"/);
  assert.match(library, /workspaceIconMarkup\([^)]*\)/);
  assert.doesNotMatch(library, /state\.view === "all" && !state\.collectionId \? "cloudActive" : "cloud"/);
});

test("quick filters reset stale navigation scope before searching", () => {
  const handler = library.match(/root\.querySelectorAll\("\[data-search-query\]"\)\.forEach\(\(button\) => button\.onclick = \(\) => \{([\s\S]*?)\n  \}\);\n  root\.querySelectorAll\("\[data-tag\]"\)/)?.[1] || "";
  assert.match(library, /quick\("untagged", "tag", "没有标签"[\s\S]*"notag:true"\)/);
  assert.match(handler, /state\.view = "all";[\s\S]*state\.collectionId = null;[\s\S]*state\.tag = "";[\s\S]*state\.selected\.clear\(\);[\s\S]*commitSearch/);
  assert.match(library, /找到 \$\{items\.length\} 个书签/);
});
