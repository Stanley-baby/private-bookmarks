import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentRequest, shouldShowGlobalLoading } from "../extension/ui.js?v=20260811-navigation1";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");

test("global loading is reserved for the first render", () => {
  assert.equal(shouldShowGlobalLoading(false), true);
  assert.equal(shouldShowGlobalLoading(true), false);
});

test("stale collection responses cannot win a newer navigation", () => {
  assert.equal(isCurrentRequest(4, 4), true);
  assert.equal(isCurrentRequest(4, 5), false);
});

test("link checks are unavailable offline and handle request failures", () => {
  const button = library.match(/<button id="check-links"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(button, /\$\{state\.connectionInfo \? "" : " disabled"\}/);
  assert.match(button, /\$\{state\.connectionInfo \? t\("检查链接"\) : t\("连接私有实例后可用"\)\}/g);

  const handler = library.match(/root\.querySelector\("#check-links"\)\.onclick = ([\s\S]*?);\n  root\.querySelector\("\[data-theme-trigger\]"/)?.[1] || "";
  assert.doesNotMatch(handler, /onclick = async/);
  assert.match(handler, /\.then\(\(\) => load\(\)\)\.catch\(showError\)/);
});

test("extension context invalidation is ignored before logging or UI updates", () => {
  const showError = library.slice(library.indexOf("function showError"), library.indexOf('\n\nwindow.addEventListener("unhandledrejection"'));

  assert.match(showError, /function showError\(error\) \{\n  if \(\/Extension context invalidated\/i\.test\(String\(error\?\.message \|\| error\)\)\) return;\n  console\.error\(error\);/);
});

test("library rerenders preserve sidebar scroll position", () => {
  const render = library.slice(library.indexOf("function render()"), library.indexOf("\nlet cardPopoverPositionBound"));

  assert.match(render, /const navScrollTop = root\.querySelector\("\.nav"\)\?\.scrollTop;/);
  assert.match(render, /const nav = root\.querySelector\("\.nav"\);\n  if \(nav && navScrollTop != null\) nav\.scrollTop = navScrollTop;/);
});
