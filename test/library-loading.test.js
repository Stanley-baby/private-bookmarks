import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentRequest, shouldShowGlobalLoading } from "../extension/ui.js?v=20260811-navigation1";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const react = readFileSync(new URL("../src/react/main.tsx", import.meta.url), "utf8");

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

  const handler = library.match(/root\.querySelector\("#check-links"\)\.onclick = ([\s\S]*?);\n  const themeTrigger = root\.querySelector\("\[data-theme-trigger\]"/)?.[1] || "";
  assert.doesNotMatch(handler, /onclick = async/);
  assert.match(handler, /\.then\(\(\) => load\(\)\)\.catch\(showError\)/);
});

test("account settings exposes a Worker connection form without disabling local mode", () => {
  const account = library.slice(library.indexOf("function accountSettingsMarkup"), library.indexOf("\nfunction importCollectionPath"));
  assert.match(library, /import \{ api, connect, connection, disconnect(?:, requestPagePermission)? \} from "\.\/api\.js/);
  assert.match(account, /Cloudflare Worker/);
  assert.match(account, /<form data-account-connection-form>/);
  assert.match(account, /name="endpoint" type="url"/);
  assert.match(account, /name="key" type="password"/);
  assert.match(account, /value="" placeholder="\$\{currentConnection \? "重新输入访问密钥" : "访问密钥"\}"/);
  assert.doesNotMatch(account, /value="\$\{escapeHtml\(currentConnection\?\.key/);
  assert.match(account, /currentConnection \? "重新连接" : "连接私有实例"/);
  assert.match(account, /未连接 Worker；书签只保存在此设备。/);
  assert.match(account, /const disconnectAction = currentConnection \?/);
  assert.match(library, /const aiNote = state\.settingsSection === "app" \? root\.querySelector\("\.settings-sub-label"\) : null;/);

  const submit = library.slice(library.indexOf("async function submitAccountConnection"), library.indexOf("\nfunction bindSettings"));
  assert.match(submit, /event\.preventDefault\(\)/);
  assert.match(submit, /const value = await connect\(data\.get\("endpoint"\), data\.get\("key"\)\)/);
  assert.match(submit, /state\.connectionInfo = value;/);
  assert.match(submit, /await load\(\)/);
  assert.match(library, /root\.querySelector\("\[data-account-connection-form\]"\)\?\.addEventListener\("submit", submitAccountConnection\)/);
});

test("legacy export and React migration file transfer share the package seam", () => {
  assert.match(library, /exportMigrationPackage/);
  assert.match(library, /(?:importMigrationPackage|applyMigrationPackage)/);
  assert.match(library, /data-migration-export/);
  assert.match(library, /data-migration-import/);
  assert.match(library, /private-bookmarks-migration\.json/);
  assert.match(react, /importMigrationPackage/);
  assert.match(react, /exportMigrationPackage/);
  assert.match(react, /导入迁移包/);
});

test("add action uses the full editor and keeps the popup page passive until clicked", () => {
  assert.match(library, /async function currentPageDraft\(\) \{[\s\S]*?if \(!isExtensionSurface\(\) \|\| !globalThis\.chrome\?\.tabs\?\.query\) return \{\};/);
  assert.match(library, /const page = await currentPageDraft\(\);[\s\S]*?openEdit\(/);
  assert.match(library, /const saved = isNew\s*\n\s*\? await api\("\/v1\/bookmarks"/);
  assert.match(library, /if \(isNew && isExtensionSurface\(\)\) state\.addButtonSaved = true;/);
  assert.match(background, /message\.type === "private-bookmarks-page-metadata"/);
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

test("view-only navigation updates the workspace without rebuilding the library shell", () => {
  const viewOnlyStart = library.indexOf("if (viewOnly)");
  const viewOnlyEnd = library.indexOf("\n    const rawCollectionPath", viewOnlyStart);
  const viewOnly = library.slice(viewOnlyStart, viewOnlyEnd);
  const partialStart = library.indexOf("function renderViewOnly()");
  const partialEnd = library.indexOf("\nfunction render()", partialStart);
  const partial = library.slice(partialStart, partialEnd);
  const bindStart = library.indexOf("function bind()");
  const bindEnd = library.indexOf("\nfunction clearDropTargets", bindStart);
  const bind = library.slice(bindStart, bindEnd);

  assert.match(viewOnly, /renderViewOnly\(\);/);
  assert.doesNotMatch(viewOnly, /render\(\);/);
  assert.match(partial, /querySelector\("\.workspace-sections"\)/);
  assert.match(partial, /workspaceSections\.innerHTML/);
  assert.match(partial, /bind\(\);/);
  assert.match(bind, /search\.onfocus = openSearchMenu/);
  assert.match(bind, /search\.oninput = \(\) =>/);
  assert.doesNotMatch(bind, /search\.addEventListener/);
  assert.match(bind, /themeTrigger\.onclick/);
});

test("workspace collection titles use internal navigation", () => {
  const bindStart = library.indexOf("function bindWorkspaceHeader()");
  const bindEnd = library.indexOf("\nfunction refreshSelectionUi", bindStart);
  const bind = library.slice(bindStart, bindEnd);

  assert.match(bind, /querySelectorAll\("\.workspace-title-link"\)/);
  assert.match(bind, /event\.preventDefault\(\)/);
});
