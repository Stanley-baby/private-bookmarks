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
