import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");
const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");

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

test("primary font sizes match the reference plugin", () => {
  assert.match(declarations(":root"), /font: 14px\/1\.4 /);
  assert.match(declarations('[data-font-size="large"]'), /font-size: 15\.75px/);
  assert.match(declarations(".settings-shell"), /font: 15px\/21px /);

  for (const selector of [
    ".settings-outline-button",
    ".settings-check, .settings-radio",
    ".settings-button-group-menu",
    ".settings-button-option",
  ]) assert.match(declarations(selector), /font-size: 15px/);
});
