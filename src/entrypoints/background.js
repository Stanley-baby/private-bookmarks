import { getActionMode, listBookmarks, saveBookmark, setActionMode, setSyncSettings, syncSettings } from "../local/db";
import { scheduleSync, syncOnce } from "../local/sync";
import { createWebdavBackup, configureWebdav, listBackups, restoreWebdavBackup } from "../backup/webdav";
import { extractPageMetadata } from "../../extension/page-metadata.js";

async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function saveTab(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new TypeError("只能保存 HTTP(S) 页面");
  let metadata = { link: tab.url, title: tab.title || tab.url };
  try { metadata = { ...metadata, ...(await pageMetadata(tab)) }; } catch { /* keep the existing quick-save fallback */ }
  const item = await saveBookmark(metadata);
  if (tab.id) await chrome.action.setBadgeText({ tabId: tab.id, text: "✓" });
  return item;
}

async function pageMetadata(tab) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageMetadata });
  return result.result;
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

export default defineBackground(() => {
  getActionMode().then((mode) => mode && applyActionMode(mode)).catch(() => {});
  scheduleSync();
  chrome.alarms.get("private-bookmarks-webdav-daily").then((alarm) => { if (!alarm) chrome.alarms.create("private-bookmarks-webdav-daily", { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 }); });
  chrome.runtime.onStartup.addListener(() => scheduleSync());
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "private-bookmarks-sync") syncOnce().catch(() => {});
    if (["private-bookmarks-webdav-idle", "private-bookmarks-webdav-daily"].includes(alarm.name)) createWebdavBackup().catch(() => {});
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
  const menus = () => chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: "保存页面", contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: "保存链接", contexts: ["link"] });
    chrome.contextMenus.create({ id: "open-side-panel", title: "打开侧边栏", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-library", title: "打开私有书签", contexts: ["action"] });
  });
  chrome.runtime.onInstalled.addListener((details) => {
    menus();
    if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
  chrome.runtime.onStartup.addListener(menus);
  menus();
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "save-page") await saveTab(tab);
    if (info.menuItemId === "save-link" && info.linkUrl) await saveBookmark({ link: info.linkUrl, title: info.linkUrl });
    if (info.menuItemId === "open-library") await chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    if (info.menuItemId === "open-side-panel") await chrome.sidePanel.open({ windowId: tab?.windowId });
  });
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "save_page") await saveTab(await activeTab());
    if (command === "open_side_panel") await chrome.sidePanel.open({ windowId: (await activeTab())?.windowId });
  });
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const needle = text.toLocaleLowerCase();
    suggest((await listBookmarks()).filter((item) => `${item.title} ${item.link} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(needle)).slice(0, 8).map((item) => ({ content: item.link, description: `${item.title} — ${item.link}` })));
  });
  chrome.omnibox.onInputEntered.addListener((url) => chrome.tabs.create({ url }));
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
});
