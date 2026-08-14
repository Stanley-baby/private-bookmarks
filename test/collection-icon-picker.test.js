import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COLLECTION_ICON_CACHE_TTL,
  COLLECTION_ICON_DEFAULT_CATALOG,
  fetchCollectionIconCatalog,
  normalizeCollectionIconCatalog,
  readCollectionIconCache,
  writeCollectionIconCache,
} from "../extension/collection-icon-catalog.js";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../extension/library.html", import.meta.url), "utf8");
const sourceHtml = readFileSync(new URL("../src/entrypoints/library.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("close icon matches the reference path", () => {
  const closePath = '<path fill-rule="evenodd" d="m10.95 10.25 6.4 6.4c.2.2.2.52 0 .7-.2.2-.5.2-.7 0l-6.4-6.4-6.4 6.4c-.2.2-.52.2-.7 0-.2-.18-.2-.5 0-.7l6.4-6.4-6.4-6.4c-.2-.2-.2-.5 0-.7.18-.2.5-.2.7 0l6.4 6.4 6.4-6.4c.2-.2.5-.2.7 0 .2.2.2.5 0 .7l-6.4 6.4Z"></path>';
  assert.ok(library.includes(`close: '${closePath}'`));
});

test("collection icon picker keeps the reference catalog and modal geometry", () => {
  assert.match(html, /id="collection-icon-picker-dialog" class="collection-icon-picker"/);
  assert.match(html, /id="collection-icon-picker-search"[^>]+placeholder="搜索图标\.\.\."/);
  assert.match(html, /data-collection-icon-delete/);
  assert.match(html, /id="collection-icon-picker-upload"/);
  assert.match(library, /back\.innerHTML = treeIcon\("back"\);/);
  assert.match(library, /close\.innerHTML = treeIcon\("close"\);/);
  assert.deepEqual(COLLECTION_ICON_DEFAULT_CATALOG.slice(0, 4).map((group) => group.category), ["Colors circle", "Flat fun", "Hockey", "Landscape"]);
  const defaultIcons = COLLECTION_ICON_DEFAULT_CATALOG.flatMap((group) => group.icons.map((icon) => icon.url));
  assert.equal(COLLECTION_ICON_DEFAULT_CATALOG.length, 22);
  assert.equal(defaultIcons.length, 961);
  assert.equal(new Set(defaultIcons).size, 961);
  assert.match(css, /\.collection-icon-picker \{[^}]*width: min\(500px/);
  assert.match(css, /\.collection-icon-picker \{[^}]*height: 90dvh/);
  assert.match(css, /\.collection-icon-picker-header \{[^}]*flex: 0 0 48px/);
  assert.match(css, /\.collection-icon-picker-grid \{[^}]*minmax\(40px/);
  assert.match(css, /\.collection-icon-picker-item \{[^}]*display: block[^}]*height: 44px/);
  assert.match(css, /\.collection-icon-picker-item img \{[^}]*width: 28px; height: 28px; margin: 0 -2\.5px/);
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

test("collection icon header keeps intrinsic actions and named icon wrappers", () => {
  for (const markup of [html, sourceHtml]) {
    assert.match(markup, /class="collection-icon-picker-upload-icon" data-collection-icon-upload-icon/);
    assert.match(markup, /class="collection-icon-picker-last-action"><button[^>]+id="collection-icon-picker-close"/);
  }
  assert.match(css, /\.collection-icon-picker-header\s*>\s*:not\(:last-child\):not\(\.collection-icon-picker-space\)\s*\{[^}]*margin-right:\s*4px/);
  assert.match(css, /\.collection-icon-picker-upload-icon\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.collection-icon-picker-last-action\s*\{[^}]*margin-right:\s*-8px/);
  assert.match(css, /\.collection-icon-picker-header \.collection-icon-picker-delete\s*\{[^}]*width:\s*auto/);
});

test("remote catalog normalization validates, deduplicates, and preserves stable totals", () => {
  const counts = [30, 14, 22, 50, 8, 35, 20, 41, 44, 34, 27, 44, 48, 23, 23, 9, 20, 26, 273, 138, 17, 15];
  const payload = {
    result: true,
    items: counts.map((count, groupIndex) => ({
      title: `Group ${groupIndex}`,
      icons: Array.from({ length: count }, (_, iconIndex) => ({ png: `https://icons.example/${groupIndex}/${iconIndex}.png` })),
    })),
  };
  payload.items[0].icons.push({ png: payload.items[0].icons[0].png }, { png: "javascript:alert(1)" }, { png: "data:image/png;base64,AAAA" });
  const catalog = normalizeCollectionIconCatalog(payload);
  assert.equal(catalog.length, 22);
  assert.equal(catalog.reduce((total, group) => total + group.icons.length, 0), 961);
  assert.equal(new Set(catalog.flatMap((group) => group.icons.map((icon) => icon.url))).size, 961);
  assert.equal(catalog[0].icons[0].name, "0.png");
});

test("catalog cache is fresh for 24 hours and network failures leave fallback choice intact", async () => {
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const catalog = [{ category: "Cached", icons: [{ name: "one.png", url: "https://icons.example/one.png" }] }];
  const now = 10_000;
  writeCollectionIconCache(adapter, catalog, now);
  assert.deepEqual(readCollectionIconCache(adapter, now + COLLECTION_ICON_CACHE_TTL - 1), catalog);
  assert.equal(readCollectionIconCache(adapter, now + COLLECTION_ICON_CACHE_TTL), null);
  await assert.rejects(() => fetchCollectionIconCatalog(async () => { throw new Error("offline"); }));
  assert.deepEqual(readCollectionIconCache(adapter, now + 1), catalog);
});

test("opening the icon picker does not trigger a remote catalog refresh", () => {
  const opening = library.match(/function openCollectionIconPicker\(item\) \{([\s\S]*?)\n\}\n\ndocument\.addEventListener\("error"/)?.[1] || "";
  assert.doesNotMatch(opening, /^\s*refreshCollectionIconCatalog\(\);/m);
});

test("icon picker exposes an explicit catalog refresh action", () => {
  for (const markup of [html, sourceHtml]) assert.match(markup, /data-collection-icon-refresh[^>]*>手动更新图标目录</);
  assert.match(library, /api\(["']\/v1\/icon-catalog["']/);
  assert.match(library, /normalizeCollectionIconCatalog/);
  assert.match(library, /writeCollectionIconCache/);
});
