import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("sort and view popovers stay anchored through resize, scroll, and tight bottom space", () => {
  assert.match(library, /let workspaceMenuPositionBound = false;/);
  assert.match(library, /window\.addEventListener\("resize", positionWorkspaceMenus\)/);
  assert.match(library, /document\.addEventListener\("scroll", positionWorkspaceMenus, true\)/);
  assert.match(library, /if \(top \+ height > window\.innerHeight - 8\) top = rect\.top - height;/);
  assert.match(library, /positionWorkspaceMenu\("\[data-sort-menu\]", "\[data-sort-trigger\]"\)/);
  assert.match(library, /positionWorkspaceMenu\("\[data-view-menu\]", "\[data-view-trigger\]"\)/);
});

test("collection management menus avoid sibling workspace headers", () => {
  assert.match(library, /root\.querySelectorAll\("\.workspace-head"\)/);
  assert.match(library, /candidateTop < head\.bottom && candidateTop \+ height > head\.top/);
  assert.match(library, /rect\.top - height - 4/);
  assert.match(library, /let clearBelowTop = rect\.bottom \+ 4/);
  assert.match(library, /clearBelowTop = head\.bottom \+ 4/);
});

test("fixed card-copy rows apply only to list and simple layouts", () => {
  assert.match(css, /\.cards:not\(\.layout-grid\):not\(\.layout-masonry\) \.bookmark-card\.view-fields-custom \.card-copy \{[^}]*grid-template-rows: var\(--card-copy-rows\)/);
  assert.doesNotMatch(css, /^\.bookmark-card\.view-fields-custom \.card-copy \{/m);
});
