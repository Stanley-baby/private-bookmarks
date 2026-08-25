import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("search popup keeps the reference eight suggestions and collection scope", () => {
  const suggestions = library.match(/const SEARCH_SUGGESTIONS = \[([\s\S]*?)\n\];/)?.[1] || "";
  assert.deepEqual([...suggestions.matchAll(/\{ id: "([^"]+)"/g)].map((match) => match[1]), ["favorite", "tags", "note", "type", "created", "info", "url", "untagged"]);
  assert.match(library, /searchInCollection: false/);
  assert.match(library, /data-search-scope/);
  assert.match(library, /state\.collectionId && state\.searchInCollection/);
  assert.match(library, /state\.collectionId && \(!state\.query\.trim\(\) \|\| state\.searchInCollection\)/);
  assert.match(library, /state\.collectionId && !state\.searchFilterGroup/);
  assert.match(library, /item\.id === "untagged" && searchSuggestionCount\(item\.id\) === 0/);
  assert.match(library, /aria-labelledby="search-filter-label"/);
});

test("search popup is a body portal with reference geometry and accessible navigation", () => {
  assert.match(library, /document\.body\.append\(menu\)/);
  assert.match(library, /aria-controls="search-filter-menu"/);
  assert.match(library, /aria-labelledby="search-filter-label"/);
  assert.match(library, /input\.getBoundingClientRect\(\)/);
  assert.match(library, /aria-activedescendant/);
  assert.match(library, /id="\$\{optionId\}" type="button" class="search-filter-item"/);
  assert.match(library, /role="option"[\s\S]*?aria-selected="\$\{/);
  for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape"]) assert.match(library, new RegExp(`event\\.key === "${key}"`));
  assert.match(css, /\.search-filter-menu \{[^}]*position: fixed;[^}]*z-index: 7;[^}]*width: 320px;[^}]*border: 1px solid rgba\(0, 0, 0, \.17\);[^}]*border-radius: 8px;[^}]*box-shadow: 0 10px 30px rgba\(0, 0, 0, \.15\);[^}]*transform: translate3d\(var\(--left/);
  assert.match(css, /\.search-filter-menu-content \{[^}]*width: 318px/);
});
