import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");
const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const surface = readFileSync(new URL("../src/legacy/surface.js", import.meta.url), "utf8");
const popup = readFileSync(new URL("../src/entrypoints/popup.html", import.meta.url), "utf8");
const sidepanel = readFileSync(new URL("../src/entrypoints/sidepanel.html", import.meta.url), "utf8");

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped} \\{([^}]*)\\}`))?.[1] || "";
}

test("workspace controls keep full labels until the content becomes compact", () => {
  const sort = declarations(".workspace-sort");
  const view = declarations(".view-trigger");
  const compactRules = css.match(/@container \(width < 600px\) \{([\s\S]*?)\n\}/)?.[1] || "";

  assert.doesNotMatch(sort, /\bwidth:\s*\d/);
  assert.match(sort, /grid-template-columns: 20px max-content/);
  assert.doesNotMatch(view, /\bwidth:\s*\d/);
  assert.match(view, /grid-template-columns: 20px max-content/);
  assert.match(library, /class="workspace-tool-label workspace-sort-label"/);
  assert.match(compactRules, /\.workspace-tools \.workspace-tool-label \{ display: none; \}/);
  assert.match(compactRules, /\.workspace-sort,\s*\n\s*\.view-trigger,\s*\n\s*\.workspace-tools > \.export \{ width: 36px;/);
});

test("compact workspace controls share one 36 by 32 icon box", () => {
  const compactRules = css.match(/@container \(width < 600px\) \{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(compactRules, /\.workspace-sort,\s*\n\s*\.view-trigger,\s*\n\s*\.workspace-tools > \.export \{[^}]*min-width: 36px;[^}]*height: 32px;[^}]*min-height: 32px;/);
  assert.match(compactRules, /\.workspace-tools > \.export \{[^}]*grid-template-rows: 32px;/);
  assert.doesNotMatch(compactRules, /\.workspace-tools > \.export \{[^}]*grid-template-rows: 28px;/);
  assert.match(css, /\.workspace-sort-icon \.tree-svg,\s*\.view-trigger \.tree-svg,\s*\.workspace-tools > \.export \.tree-svg \{[^}]*width: 20px; height: 20px/);
});

test("bookmark editing keeps the list visible in a desktop split pane", () => {
  assert.match(library, /editingId: ""/);
  assert.match(library, /mountEditPanel\(editWasOpen\)/);
  assert.match(library, /editFormIsDirty/);
  assert.match(library, /editBookmarkDialog\.show\(\)/);
  assert.doesNotMatch(library, /editBookmarkDialog\.showModal\(\)/);
  assert.match(css, /\.library\.editing \{ grid-template-columns: var\(--sidebar-width\) minmax\(280px, 420px\) minmax\(0, 1fr\); \}/);
  assert.match(css, /\.edit-panel \{ position: static;/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.edit-panel \{ position: fixed;/);
});

test("search filters use the reference 20px icons and per-filter artwork", () => {
  assert.match(declarations(".search-filter-icon .tree-svg"), /width: 20px; height: 20px/);
  for (const icon of ["article", "audio", "document", "image", "video", "highlights", "reminder", "public", "broken"]) {
    assert.match(library, new RegExp(`\\n  ${icon}: '<`));
  }
  assert.match(css, /data-token="type"\]\[data-id="image"\].*color: #1aa051/);
  assert.match(css, /data-token="highlights"\].*color: #975da8/);
  assert.match(css, /data-token="reminder"\].*color: #e48748/);
  assert.match(css, /data-token="broken"\].*color: #e75d7b/);
});

test("settings text keeps readable colors in dark mode", () => {
  for (const selector of [
    ".settings-icon-button, .settings-mobile-menu",
    ".settings-outline-button",
    ".settings-button-group > .tree-svg",
  ]) assert.match(declarations(selector), /color: light-dark\(#4d4d4d, #d6d6d6\)/);

  for (const selector of [
    ".settings-label",
    ".settings-sub-label",
  ]) assert.match(declarations(selector), /color: light-dark\(#808080, #a9aaaf\)/);

  for (const selector of [
    ".settings-button-group-menu",
    ".settings-button-option",
    ".settings-search-relevance",
  ]) assert.match(declarations(selector), /color: light-dark\(#1a1a1a, #ececee\)/);
});

test("account settings route exposes self-hosted instance fields", () => {
  assert.match(library, /initialSettingsSection = \["app", "account", "import"\]/);
  assert.match(library, /\["account", "帐户", "user", true\]/);
  assert.match(library, /function accountSettingsMarkup\(\)/);
  assert.match(library, /data-account-instance-name/);
  assert.match(library, /data-account-settings-action="disconnect"/);
  assert.match(library, /state\.settingsSection = state\.settingsOpen \? section : "app"/);
  for (const selector of [
    ".settings-account-input-wrap",
    ".settings-account-value",
    ".settings-account-stat",
    ".settings-account-action",
  ]) assert.match(declarations(selector), /display:/);
});

test("import settings route matches the reference upload surface", () => {
  assert.match(library, /\["import", "导入", "upload", true\]/);
  assert.match(library, /function importSettingsMarkup\(\)/);
  assert.match(library, /data-import-file/);
  assert.match(library, /\.enex/);
  assert.match(library, /parseImportText\(text/);
  assert.match(library, /data-import-submit/);
  assert.match(declarations(".settings-import-grid"), /grid-template-columns: 26px/);
  assert.match(declarations(".settings-import-alert"), /background: var\(--sidebar\)/);
  for (const selector of [".settings-import-upload", ".settings-import-preview"]) assert.match(declarations(selector), /display:/);
});

test("primary font sizes match the reference plugin", () => {
  assert.match(declarations(":root"), /font: 14px\/1\.4 /);
  assert.match(declarations("body"), /font: inherit/);
  assert.match(declarations('[data-font-size="large"]'), /font-size: 15\.75px/);
  assert.match(declarations(".settings-shell"), /font: 15px\/21px /);

  for (const selector of [
    ".settings-outline-button",
    ".settings-check, .settings-radio",
    ".settings-button-group-menu",
    ".settings-button-option",
  ]) assert.match(declarations(selector), /font-size: 15px/);
});

test("P2 density tokens keep controls reachable and bookmark rows compact", () => {
  assert.match(declarations(":root"), /font: 14px\/1\.4 .*Helvetica, Arial, sans-serif/);
  assert.match(declarations(".topbar"), /height: 48px/);
  assert.match(declarations(".workspace-head"), /min-height: 48px/);
  assert.match(css, /\.tree-item, \.collection-row \{[^}]*min-height: 32px/);
  assert.match(declarations(".quick-search"), /height: 32px/);
  assert.match(declarations(".bookmark-card"), /min-height: 68px/);
  assert.match(css, /\.card-cover \{[^}]*width: 56px; height: 48px/);
  assert.match(css, /\.card-title \{[^}]*font-size: 15px;[^}]*line-height: 21px/);
  assert.match(declarations(".bookmark-count-footer"), /height: 32px; min-height: 32px/);
  assert.match(declarations(".empty"), /padding: 32px 16px/);
  assert.match(css, /button:focus-visible, input:focus-visible/);
  assert.match(css, /\.bookmark-card:hover \.card-actions/);
});

test("grid cards keep bounded columns, stable covers, readable clamped copy, and list invariants", () => {
  const grid = declarations(".cards.layout-grid");
  const gridCard = declarations(".layout-grid .bookmark-card");
  const gridCover = declarations(".layout-grid .card-cover");
  const gridTitle = declarations(".layout-grid .card-title");
  const gridActions = declarations(".layout-grid .card-actions");

  assert.match(grid, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 220px\), 1fr\)\)/);
  assert.match(grid, /gap: 16px/);
  assert.match(gridCard, /min-width: 0/);
  assert.match(gridCard, /min-height: 288px/);
  assert.match(gridCard, /border: 1px solid var\(--line\)/);
  assert.match(gridCover, /aspect-ratio: 16 \/ 9/);
  assert.match(css, /\.layout-grid \.card-cover img \{[^}]*object-fit: cover/);
  assert.match(css, /\.layout-grid \.card-cover img\[src\$="icons\/bookmark\.svg"\] \{[^}]*object-fit: contain/);
  assert.match(gridTitle, /font-size: 15px/);
  assert.match(gridTitle, /line-height: 21px/);
  assert.match(gridTitle, /-webkit-line-clamp: 2/);
  assert.match(css, /\.layout-grid \.card-note, \.layout-grid \.card-description \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.layout-grid \.card-tags \{[^}]*font-size: 12px/);
  assert.match(css, /\.layout-grid \.card-source \{[^}]*font-size: 12px/);
  assert.match(css, /\.layout-grid \.bookmark-card:hover \{[^}]*transform: translateY\(-1px\)/);
  assert.match(css, /\.layout-grid \.card-permalink:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(gridActions, /top: 8px/);
  assert.match(css, /@media \(hover: none\) \{ \.bookmark-card \.card-actions \{ display: inline-grid; \} \}/);
  assert.match(declarations(".bookmark-card"), /min-height: 68px/);
  assert.match(css, /\.card-cover \{[^}]*width: 56px; height: 48px/);
  assert.match(css, /body\.surface-sidepanel[\s\S]*?min-width: 0/);
  assert.match(css, /@media \(max-width: 519px\) \{[\s\S]*?body\.surface-sidepanel \.cards\.layout-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("empty states share centered geometry across layouts and surfaces", () => {
  const workspace = declarations(".workspace:has(.cards > .empty)");
  const cards = declarations(".cards:has(> .empty)");
  const empty = declarations(".cards:has(> .empty) > .empty");

  assert.match(workspace, /display: grid/);
  assert.match(workspace, /grid-template-rows: 48px minmax\(0, 1fr\) 32px/);
  assert.match(workspace, /min-height: calc\(100dvh - 48px\)/);
  assert.match(cards, /min-height: 0/);
  assert.match(cards, /padding: 0/);
  assert.match(cards, /grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(cards, /align-items: stretch/);
  assert.match(empty, /display: grid/);
  assert.match(empty, /align-self: stretch/);
  assert.match(empty, /place-content: center/);
  assert.match(empty, /justify-items: center/);
  assert.match(empty, /grid-column: 1 \/ -1/);
  assert.match(empty, /min-height: 0/);
  assert.match(empty, /padding: 32px 16px/);
  assert.doesNotMatch(css, /\.cards\.layout-masonry > \.empty/);
  assert.match(css, /\.library \{[^}]*height: 100vh/);
  assert.match(css, /body\.surface-popup \{[\s\S]*?min-height: 600px/);
  assert.match(css, /body\.surface-sidepanel \{[\s\S]*?min-height: 100vh/);
});

test("shared surfaces mark their host before rendering and keep distinct layouts", () => {
  assert.match(surface, /document\.documentElement\.dataset\.surface = surface/);
  assert.match(surface, /document\.body\.classList\.add\(marker\)/);
  assert.match(popup, /<body data-surface="popup">/);
  assert.match(sidepanel, /<body data-surface="sidepanel">/);
  assert.match(css, /body\.surface-popup[\s\S]*?min-width: 700px/);
  assert.match(css, /body\.surface-popup \.library[\s\S]*?grid-template-columns: 250px minmax\(360px, 1fr\)/);
  assert.match(css, /body\.surface-sidepanel \.library[\s\S]*?--sidebar-width: clamp\(240px, 30vw, 280px\)/);
  assert.match(css, /@media \(max-width: 519px\)[\s\S]*?body\.surface-sidepanel \.library\.sidebar-open \.sidebar/);
  assert.match(library, /function openFullPage\(route = "library\.html"\)/);
  assert.match(library, /isPopupSurface\(\)\s*\? openFullPage\("library\.html\?settings=import"\)/);
  assert.match(library, /isPopupSurface\(\)\s*\? openFullPage\("library\.html\?settings=backups"\)/);
});
