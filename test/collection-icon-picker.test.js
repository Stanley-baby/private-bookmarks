import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../extension/library.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("collection icon picker keeps the reference catalog and modal geometry", () => {
  assert.match(html, /id="collection-icon-picker-dialog" class="collection-icon-picker"/);
  assert.match(html, /id="collection-icon-picker-search"[^>]+placeholder="搜索图标\.\.\."/);
  assert.match(html, /data-collection-icon-delete/);
  assert.match(html, /id="collection-icon-picker-upload"/);
  assert.match(library, /back\.innerHTML = treeIcon\("back"\);/);
  assert.match(library, /close\.innerHTML = treeIcon\("close"\);/);
  assert.match(library, /category: "Colors circle"/);
  assert.match(library, /category: "Flat fun"/);
  assert.match(library, /category: "Hockey"/);
  assert.match(library, /category: "Landscape"/);
  const files = [...library.matchAll(/files: \[([^\]]+)\]/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]));
  assert.equal(files.length, 116);
  assert.match(css, /\.collection-icon-picker \{[^}]*width: min\(500px/);
  assert.match(css, /\.collection-icon-picker \{[^}]*height: 90dvh/);
  assert.match(css, /\.collection-icon-picker-header \{[^}]*flex: 0 0 48px/);
  assert.match(css, /\.collection-icon-picker-grid \{[^}]*minmax\(40px/);
  assert.match(css, /\.collection-icon-picker-item \{[^}]*height: 44px/);
  assert.match(css, /\.collection-icon-picker-item img \{[^}]*width: 28px; height: 28px/);
});

test("collection icon search, save, and image rendering share one helper", () => {
  assert.match(library, /!value \|\| `\$\{group\.category\} \$\{icon\.name\}`/);
  assert.match(library, /async function saveCollectionIconValue\(collectionId, value\)/);
  assert.match(library, /collectionIconByCollectionId/);
  assert.match(library, /<img data-collection-icon-image src=/);
  assert.match(library, /collectionIconMarkup\(icon, collectionActive\)/);
  assert.match(library, /collectionIconMarkup\(collectionIconValue\(item\.collectionId\)/);
  assert.match(library, /readCollectionIconFile\(file\)/);
  assert.match(library, /COLLECTION_ICON_UPLOAD_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(library, /collectionIconPickerDialog\.addEventListener|document\.addEventListener\("error"/);
});
