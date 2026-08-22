import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

const reportMasonryIcon = '<g fill-rule="evenodd"><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 2 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006Z" opacity=".09"></path><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 2 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006ZM3 4h5v7H3V4Zm8 7h5v6h-5v-6Zm0-7h5v4h-5V4ZM3 14h5v3H3v-3Z"></path></g>';

test("masonry view icon matches the reference symbol and 20px currentColor surface", () => {
  const icon = library.match(/^  viewMasonry: '([^']+)'/m)?.[1];

  assert.equal(icon, reportMasonryIcon);
  assert.doesNotMatch(library, /treeIcons\.viewMasonry\s*=\s*treeIcons\.viewMasonry\.replaceAll/);
  assert.match(library, /viewBox="0 0 \$\{small \? "10 10" : "20 20"\}"[^>]*>\$\{treeIcons\[name\]\}/);
  assert.match(css, /\.view-option-icon \{[^}]*width: 20px; height: 20px/);
  assert.match(css, /\.view-option-icon \.tree-svg \{[^}]*width: 20px; height: 20px/);
  assert.match(css, /\.tree-svg \{[^}]*width: 20px; height: 20px; fill: currentColor/);
});
