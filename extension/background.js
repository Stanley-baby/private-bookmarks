import { api, requestPagePermission, saveBookmark } from "./api.js";

function message(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function metadata(tab) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const meta = (...names) => [...document.querySelectorAll(names.map((name) => `meta[property="${name}"],meta[name="${name}"]`).join(","))].at(-1)?.content?.trim();
      const cover = meta("og:image", "twitter:image", "twitter:image:src");
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
        try { return JSON.parse(node.textContent); } catch { return []; }
      }).flat();
      const structured = jsonLd.find((item) => item?.headline || item?.name) || {};
      const structuredImage = typeof structured.image === "string" ? structured.image : structured.image?.url || "";
      const structuredType = String(structured["@type"] || "").toLocaleLowerCase();
      const pageType = String(meta("og:type") || "").toLocaleLowerCase();
      const type = meta("og:video") ? "video" : meta("og:audio") ? "audio" : pageType.includes("article") || structuredType.includes("article") ? "article" : "link";
      const images = [...document.images].filter((image) => image.complete && image.naturalWidth >= 100 && image.naturalHeight >= 100).map((image) => image.currentSrc || image.src).slice(0, 9);
      return {
        link: location.href,
        type,
        title: meta("og:title", "twitter:title") || structured.headline || structured.name || document.title,
        description: meta("og:description", "twitter:description", "description") || structured.description || "",
        cover: cover ? new URL(cover, location.href).href : structuredImage ? new URL(structuredImage, location.href).href : images[0] || "",
        media: [...new Set([cover, structuredImage, ...images].filter(Boolean).map((value) => new URL(value, location.href).href))],
      };
    },
  });
  return result.result;
}

async function saveTab(tab, collectionId = "unsorted") {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new TypeError("只能保存 HTTP(S) 页面");
  if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
  const bookmark = await saveBookmark({ ...(await metadata(tab)), collectionId });
  await chrome.action.setBadgeText({ tabId: tab.id, text: "✓" });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#0d6efd" });
  return bookmark;
}

async function ensureHighlighter(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "private-bookmarks-ping" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

async function saveHighlight(tab, highlight, bookmarkId, force = false) {
  if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
  const matches = await api(`/v1/bookmarks/by-link?link=${encodeURIComponent(tab.url)}`);
  if (!matches.length) return saveTab(tab).then((bookmark) => api(`/v1/bookmarks/${bookmark.id}`, { method: "PATCH", body: JSON.stringify({ revision: bookmark.revision, highlights: [highlight] }) }));
  const existing = bookmarkId ? matches.find((item) => item.id === bookmarkId) : matches.length === 1 ? matches[0] : null;
  if (!existing) throw new TypeError("请选择要添加此高亮的已保存书签");
  const bookmark = await api(`/v1/bookmarks/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ revision: existing.revision, highlights: [...existing.highlights, highlight], force }),
  });
  await chrome.action.setBadgeText({ tabId: tab.id, text: "✓" });
  return bookmark;
}

async function applySavedHighlights(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return;
  const origin = `${new URL(tab.url).origin}/*`;
  if (!await chrome.permissions.contains({ origins: [origin] })) return;
  try {
    const items = await api(`/v1/bookmarks/by-link?link=${encodeURIComponent(tab.url)}`);
    if (!items.length) return chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await ensureHighlighter(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-apply", highlights: items.flatMap((item) => item.highlights) });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "✓" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#0d6efd" });
  } catch (error) {
    console.debug("无法应用已保存的高亮", error);
  }
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: message("savePage", "保存页面"), contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: message("saveLink", "保存链接"), contexts: ["link"] });
    chrome.contextMenus.create({ id: "save-highlight", title: message("saveHighlight", "添加高亮"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: "save-tabs", title: message("saveTabs", "保存此窗口的全部标签页"), contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-side-panel", title: message("openSidePanel", "打开侧边栏"), contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-library", title: message("openBookmarks", "打开私有书签"), contexts: ["action"] });
  });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);
setupContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "open-library") return chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    if (info.menuItemId === "open-side-panel") return chrome.sidePanel.open({ windowId: tab.windowId });
    if (info.menuItemId === "save-tabs") {
      const granted = await chrome.permissions.request({ permissions: ["tabs"] });
      if (!granted) throw new TypeError("未获得标签页权限");
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return Promise.all(tabs.filter((entry) => /^https?:/.test(entry.url || "")).map((entry) => saveTab(entry)));
    }
    if (info.menuItemId === "save-link") return saveBookmark({ link: info.linkUrl, title: info.linkUrl, collectionId: "unsorted" });
    if (info.menuItemId === "save-page") return saveTab(tab);
    if (info.menuItemId === "save-highlight") {
      if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
      await ensureHighlighter(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-save-selection" });
    }
  } catch (error) {
    console.error(error);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open_side_panel") {
    const tab = await activeTab();
    return chrome.sidePanel.open({ windowId: tab.windowId });
  }
  if (command === "save_page") return saveTab(await activeTab());
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") applySavedHighlights({ ...tab, id: tabId });
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await applySavedHighlights(await chrome.tabs.get(tabId));
  } catch {}
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const items = await api(`/v1/bookmarks?search=${encodeURIComponent(text)}`);
    suggest(items.slice(0, 8).map((item) => ({ content: item.link, description: `${item.title || item.link} — ${item.link}` })));
  } catch {
    suggest([]);
  }
});

chrome.omnibox.onInputEntered.addListener((link) => chrome.tabs.create({ url: link }));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "private-bookmarks-save-current") return sendResponse({ bookmark: await saveTab(await activeTab(), message.collectionId) });
    if (message.type === "private-bookmarks-highlight") {
      let bookmark;
      try {
        bookmark = await saveHighlight(sender.tab, message.highlight, message.bookmarkId, message.force);
      } catch (error) {
        if (error.code === "editing_conflict") return sendResponse({ conflict: true });
        throw error;
      }
      await applySavedHighlights(sender.tab);
      return sendResponse({ bookmark });
    }
    if (message.type === "private-bookmarks-bookmarks-by-link") {
      return sendResponse({ bookmarks: await api(`/v1/bookmarks/by-link?link=${encodeURIComponent(sender.tab.url)}`) });
    }
    if (message.type === "private-bookmarks-save-selection") {
      const tab = await activeTab();
      if (!await requestPagePermission(tab.url)) throw new TypeError("未获得此网站的访问权限");
      await ensureHighlighter(tab.id);
      return sendResponse(await chrome.tabs.sendMessage(tab.id, { type: "private-bookmarks-save-selection" }));
    }
    if (message.type === "private-bookmarks-open-library") return sendResponse(await chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }));
  })().catch((error) => sendResponse({ error: error.message }));
  return true;
});
