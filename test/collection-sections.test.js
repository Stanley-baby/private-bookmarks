import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../extension/api.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("parent collection pages render one independent workspace per nested collection", () => {
  assert.match(library, /function collectionSections\(/);
  assert.match(library, /function collectionSectionMarkup\(/);
  assert.match(library, /data-section-id/);
  assert.match(library, /data-select-all/);
  assert.match(library, /function collectionDescendantIds\(collectionId\)[\s\S]*parentId/);
  assert.match(library, /function selectionItems\(/);
  assert.match(library, /function positionSelectionMoreMenu\(/);
  assert.match(css, /\.workspace/);
  assert.match(css, /\.selection-more-menu \{[^}]*position: fixed;/);
  assert.match(css, /\.bookmark-count-footer \{[^}]*height: 48px; min-height: 48px/);
  assert.match(library, /class="workspace-name workspace-title-link"/);
  assert.match(library, /function workspaceCollectionMenuMarkup\(/);
  assert.match(library, /data-workspace-collection-action/);
  assert.match(library, /workspace-scroll-empty/);
  assert.match(library, /data-compact="true"/);
  assert.match(library, /sortByCollectionId/);
  assert.match(css, /\.workspace-collection-menu \{[^}]*position: fixed;[^}]*z-index: 7/);
  assert.match(css, /\.workspace-scroll-empty \.empty:empty \{[^}]*min-height: 1px;[^}]*padding: 0/);
});

test("local collection queries include descendants like the Worker API", () => {
  assert.match(api, /nestedViewLegacy/);
  assert.match(api, /parentId/);
  assert.match(api, /scope\.has\(item\.collectionId\)/);
});
