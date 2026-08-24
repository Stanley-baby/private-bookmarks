import { ensureDefaults, getActionMode, getPreferences, healthCandidates, healthProgress, listBookmarks, saveBookmark, setActionMode, setHealthProgress, setSyncSettings, syncSettings, updateHealth } from "../../extension/shared/local-db.js";
import { requestPagePermission } from "../../extension/shared/api.js";
import { lockState } from "../../extension/shared/lock.js";
import { fileToMedia } from "../../extension/shared/local-model.js";
import { workerClient } from "../../extension/shared/worker-client.js";
import { scheduleSync, syncOnce } from "../local/sync";
import { runHealthChecks } from "../health.js";
import { createWebdavBackup, configureWebdav, listBackups, restoreWebdavBackup } from "../backup/webdav";
import { extractPageMetadata } from "../../extension/shared/page-metadata.js";

async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function badge(tabId, text, color) {
  const target = tabId ? { tabId, text } : { text };
  await chrome.action.setBadgeText(target);
  if (color) await chrome.action.setBadgeBackgroundColor(tabId ? { tabId, color } : { color });
  if (text && text !== "🔒") setTimeout(() => chrome.action.setBadgeText(tabId ? { tabId, text: "" } : { text: "" }).catch(() => {}), 2_500);
}

async function unlocked(tab) {
  if (!(await lockState()).locked) return;
  await badge(tab?.id, "🔒", "#6b7280");
  throw new TypeError("应用已锁定，请先解锁再保存");
}

async function saveTab(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new TypeError("只能保存 HTTP(S) 页面");
  await unlocked(tab);
  let metadata = { link: tab.url, title: tab.title || tab.url };
  if (await requestPagePermission(tab.url)) {
    try { metadata = { ...metadata, ...(await pageMetadata(tab)) }; } catch { /* keep the existing quick-save fallback */ }
  }
  const item = await saveBookmark(metadata);
  await badge(tab.id, "✓", "#0d6efd");
  return item;
}

async function saveLink(link) {
  if (!/^https?:/.test(link || "")) throw new TypeError("只能保存 HTTP(S) 链接");
  await unlocked();
  return saveBookmark({ link, title: link });
}

async function saveCurrentWindow(tab) {
  if (!await chrome.permissions.request({ permissions: ["tabs"] })) throw new TypeError("未获得标签页权限");
  await badge(tab?.id, "…", "#6b7280");
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const results = await Promise.allSettled(tabs.filter((item) => /^https?:/.test(item.url || "")).map(saveTab));
  const bookmarks = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason?.message || "保存失败"] : []);
  await badge(tab?.id, bookmarks.length ? "✓" : "!", bookmarks.length ? "#0d6efd" : "#ca4b53");
  return { bookmarks, errors };
}

async function pageMetadata(tab) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageMetadata });
  return result.result;
}

async function ensureHighlighter(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "private-bookmarks-ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-scripts/content.js"] });
  }
}

function matchingBookmarks(url) {
  return listBookmarks().then((items) => items.filter((item) => item.link === url));
}

async function saveHighlight(tab, highlight, bookmarkId) {
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new TypeError("只能在 HTTP(S) 页面添加高亮");
  await unlocked(tab);
  if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
  const matches = await matchingBookmarks(tab.url);
  const target = bookmarkId ? matches.find((item) => item.id === bookmarkId) : matches[0];
  const bookmark = target || await saveTab(tab);
  const saved = await saveBookmark({ ...bookmark, highlights: [...(bookmark.highlights || []), highlight] });
  await applySavedHighlights(tab);
  return saved;
}

async function updateHighlight(tab, bookmarkId, highlightId, changes) {
  const bookmark = (await matchingBookmarks(tab.url)).find((item) => item.id === bookmarkId);
  if (!bookmark) throw new TypeError("已保存书签不存在");
  const current = (bookmark.highlights || []).find((item) => item.id === highlightId);
  if (!current) throw new TypeError("高亮不存在");
  if (Number(changes?.expectedRevision) !== Number(current.revision || 0)) throw new TypeError("高亮已更新，请刷新后重试");
  const next = { ...changes };
  delete next.deleted;
  delete next.expectedRevision;
  const highlights = (bookmark.highlights || []).flatMap((item) => item.id === highlightId && changes?.deleted ? [] : [item.id === highlightId ? { ...item, ...next, revision: Number(item.revision || 0) + 1 } : item]);
  const saved = await saveBookmark({ ...bookmark, highlights });
  await applySavedHighlights(tab);
  return saved;
}

async function captureScreenshot(tab) {
  if (!tab?.id || tab.windowId == null || !/^https?:/.test(tab.url || "")) throw new TypeError("只能截取 HTTP(S) 页面");
  await unlocked(tab);
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const media = await fileToMedia({ name: "screenshot.png", type: "image/png", arrayBuffer: async () => (await fetch(image)).arrayBuffer() }, await workerClient.connection() ? workerClient.media.upload : undefined);
  const bookmark = (await matchingBookmarks(tab.url))[0] || await saveTab(tab);
  const saved = await saveBookmark({ ...bookmark, cover: media.url, media: [...(bookmark.media || []), media] });
  await badge(tab.id, "✓", "#0d6efd");
  return saved;
}

async function applySavedHighlights(tab) {
  if (!tab?.id || !tab?.url || !/^https?:/.test(tab.url)) return;
  const origin = `${new URL(tab.url).origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) return;
  const highlights = (await matchingBookmarks(tab.url)).flatMap((item) => item.highlights || []);
  if (!highlights.length) return badge(tab.id, "", "");
  await ensureHighlighter(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-apply", highlights });
  await badge(tab.id, "✓", "#0d6efd");
}

async function applyActionMode(mode) {
  if (mode === "sidepanel") {
    await chrome.action.setPopup({ popup: "" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    await chrome.action.setPopup({ popup: "popup.html" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
}

let healthTask = null;
let cancelHealthTask = null;

function runLocalHealthChecks(scope = null) {
  if (healthTask) return healthTask;
  let errors = 0;
  cancelHealthTask = () => { cancelHealthTask.cancelled = true; };
  healthTask = (async () => {
    await setHealthProgress({ status: "running", scope, checked: 0, total: 0, errors: 0 });
    const result = await runHealthChecks({ getPreferences, healthCandidates, updateHealth }, fetch, scope, {
      isCancelled: () => cancelHealthTask?.cancelled,
      onProgress: async (progress) => {
        errors += progress.errors || 0;
        await setHealthProgress({ status: "running", scope, checked: progress.checked, total: progress.total, errors });
      },
    });
    return setHealthProgress({ status: result.cancelled ? "cancelled" : "complete", scope, checked: result.checked, errors });
  })().catch(async (error) => setHealthProgress({ status: "error", scope, error: error.message || "链接检查失败" })).finally(() => { healthTask = null; cancelHealthTask = null; });
  return healthTask;
}

async function startLocalHealthChecks(scope = null) {
  if (healthTask) return healthProgress();
  const progress = await setHealthProgress({ status: "running", scope, checked: 0, total: 0, errors: 0 });
  runLocalHealthChecks(scope);
  return progress;
}

export default defineBackground(() => {
  const menus = () => chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: "保存页面", contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: "保存链接", contexts: ["link"] });
    chrome.contextMenus.create({ id: "save-highlight", title: "添加高亮", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "save-tabs", title: "保存此窗口的全部标签页", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-side-panel", title: "打开侧边栏", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-library", title: "打开私有书签", contexts: ["action"] });
  });
  const initializeBackground = () => Promise.all([
    ensureDefaults(),
    getActionMode().then((mode) => mode && applyActionMode(mode)),
    scheduleSync(),
    workerClient.connection(),
    healthProgress().then((progress) => progress.status === "running" && setHealthProgress({ ...progress, status: "interrupted" })),
    chrome.commands.getAll().then((commands) => {
      commands.filter((command) => ["save_page", "open_side_panel", "open_library", "focus_search"].includes(command.name) && !command.shortcut).forEach((command) => console.warn(`快捷键不可用: ${command.name}`));
    }),
  ]).catch(() => {});
  initializeBackground();
  chrome.alarms.get("private-bookmarks-webdav-daily").then((alarm) => { if (!alarm) chrome.alarms.create("private-bookmarks-webdav-daily", { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 }); });
  chrome.alarms.get("private-bookmarks-health-weekly").then((alarm) => { if (!alarm) chrome.alarms.create("private-bookmarks-health-weekly", { delayInMinutes: 7 * 24 * 60, periodInMinutes: 7 * 24 * 60 }); });
  chrome.runtime.onStartup.addListener(() => { initializeBackground(); menus(); });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "private-bookmarks-sync") syncOnce().catch(() => {});
    if (["private-bookmarks-webdav-idle", "private-bookmarks-webdav-daily"].includes(alarm.name)) createWebdavBackup().catch(() => {});
    if (alarm.name === "private-bookmarks-health-weekly") runLocalHealthChecks().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!String(message.type).startsWith("private-bookmarks-webdav-")) return;
    const actions = {
      "private-bookmarks-webdav-configure": () => configureWebdav(message.settings),
      "private-bookmarks-webdav-backup": () => createWebdavBackup(),
      "private-bookmarks-webdav-list": () => listBackups(),
      "private-bookmarks-webdav-restore": () => restoreWebdavBackup(message.name, message.mode),
    };
    actions[message.type]().then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-capture-screenshot") return;
    activeTab().then(captureScreenshot).then((bookmark) => sendResponse({ bookmark })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-health-check") return;
    startLocalHealthChecks(message.scope).then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "private-bookmarks-health-status") {
      healthProgress().then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "private-bookmarks-health-cancel") {
      if (cancelHealthTask) cancelHealthTask();
      healthProgress().then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-sync") return;
    syncOnce().then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-sync-settings") return;
    setSyncSettings(message.settings).then(async (settings) => { await scheduleSync(); sendResponse({ settings }); }).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-sync-status") return;
    syncSettings().then((settings) => sendResponse({ settings })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onInstalled.addListener((details) => {
    menus();
    initializeBackground();
    if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
  menus();
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
      if (info.menuItemId === "save-page") await saveTab(tab);
      if (info.menuItemId === "save-link") await saveLink(info.linkUrl);
      if (info.menuItemId === "save-highlight" && tab?.id) {
        if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
        await ensureHighlighter(tab.id);
        await chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-save-selection" });
      }
      if (info.menuItemId === "save-tabs") await saveCurrentWindow(tab);
      if (info.menuItemId === "open-library") await chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
      if (info.menuItemId === "open-side-panel" && tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      await badge(tab?.id, "!", "#ca4b53").catch(() => {});
      console.warn("private-bookmarks action failed", error);
    }
  });
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tab = await activeTab();
      if (command === "save_page") await saveTab(tab);
      if (command === "open_side_panel" && tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
      if (command === "open_library") await chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
      if (command === "focus_search") await chrome.tabs.create({ url: chrome.runtime.getURL("library.html?focus=search") });
    } catch (error) {
      await badge((await activeTab())?.id, "!", "#ca4b53").catch(() => {});
      console.warn("private-bookmarks command failed", error);
    }
  });
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const needle = text.toLocaleLowerCase();
    const results = (await listBookmarks()).filter((item) => `${item.title} ${item.link} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(needle)).slice(0, 7).map((item) => ({ content: item.link, description: `${item.title} — ${item.link}` }));
    suggest([{ content: "private-bookmarks:library", description: "打开私有书签资料库" }, ...results]);
  });
  chrome.omnibox.onInputEntered.addListener((value) => chrome.tabs.create({ url: value === "private-bookmarks:library" ? chrome.runtime.getURL("library.html") : /^https?:/.test(value) ? value : chrome.runtime.getURL(`library.html?search=${encodeURIComponent(value)}`) }));
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => { if (change.status === "complete") applySavedHighlights({ ...tab, id: tabId }).catch(() => {}); });
  chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId).then(applySavedHighlights).catch(() => {}));
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-page-metadata") return;
    (async () => {
      const tab = message.tabId ? await chrome.tabs.get(message.tabId) : await activeTab();
      if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new TypeError("只能保存 HTTP(S) 页面");
      sendResponse({ metadata: await pageMetadata(tab) });
    })().catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-set-action-mode") return;
    setActionMode(message.mode).then(async (mode) => { await applyActionMode(mode); sendResponse({ mode }); }).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-save-current") return;
    activeTab().then(saveTab).then((bookmark) => sendResponse({ bookmark })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "private-bookmarks-save-tabs") return;
    activeTab().then(saveCurrentWindow).then((result) => sendResponse({ result })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "private-bookmarks-bookmarks-by-link") {
      matchingBookmarks(sender.tab?.url).then((bookmarks) => sendResponse({ bookmarks })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "private-bookmarks-highlight") {
      saveHighlight(sender.tab, message.highlight, message.bookmarkId).then((bookmark) => sendResponse({ bookmark })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "private-bookmarks-update-highlight") {
      updateHighlight(sender.tab, message.bookmarkId, message.highlightId, { ...message.changes, expectedRevision: message.expectedRevision }).then((bookmark) => sendResponse({ bookmark })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "private-bookmarks-save-selection") {
      activeTab().then(async (tab) => {
        if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
        await ensureHighlighter(tab.id);
        return chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-save-selection" });
      }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
  });
});
