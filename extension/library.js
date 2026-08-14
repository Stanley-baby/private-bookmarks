import { api, connection, disconnect } from "./api.js?v=20260808-pin2";
import { COLLECTION_ICON_DEFAULT_CATALOG, readCollectionIconCache } from "./collection-icon-catalog.js";
import { bookmarkType, dateFilterSuggestions, duplicateLinks, languageFilterSuggestions, matchesSearchFilters, parseSearchQuery } from "./filters.js";
import { canonicalImportLink, parseImportText } from "./import.js";
import { disablePin, enablePin, lockNow, lockState, prepareLock, setAutoLock, startLockMonitor } from "./lock.js?v=20260808-pin2";
import { renderMarkdown } from "./markdown.js";
import { recommendBookmark } from "./recommendations.js";
import { collectionOptions, connectionView, escapeHtml, isCurrentRequest, lockView, shouldShowGlobalLoading } from "./ui.js?v=20260811-navigation3";

const root = document.querySelector("#app");
const collectionValueDialog = document.querySelector("#collection-value-dialog");
const collectionIconPickerDialog = document.querySelector("#collection-icon-picker-dialog");
const collectionShareDialog = document.querySelector("#collection-share-dialog");
const bookmarkDialog = document.querySelector("#bookmark-dialog");
const editBookmarkDialog = document.querySelector("#edit-bookmark-dialog");
const coverPickerDialog = document.querySelector("#cover-picker-dialog");
const coverUrlDialog = document.querySelector("#cover-url-dialog");
const collectionPickerDialog = document.querySelector("#collection-picker-dialog");
const batchTagDialog = document.querySelector("#batch-tag-dialog");
const defaultViewDialog = document.querySelector("#default-view-dialog");
const SEARCH_HISTORY_KEY = "private-bookmarks.search-history";
const IMPORT_PROGRESS_KEY = "private-bookmarks.import-progress";
const BACKUP_HISTORY_KEY = "private-bookmarks.backup-history";
const initialRoute = new URL(location.href).searchParams;
const initialSetting = initialRoute.get("settings");
const initialSettingsSection = ["app", "account", "import"].includes(initialSetting) ? initialSetting : initialSetting === "backups" ? "backups" : initialSetting === "pin" ? "pin" : "";
const initialSettingsRoute = Boolean(initialSettingsSection);

function surfaceName() {
  return document.body?.dataset.surface || document.documentElement?.dataset.surface || "library";
}

function isPopupSurface() {
  return surfaceName() === "popup";
}

function openFullPage(route = "library.html") {
  const href = globalThis.chrome?.runtime?.getURL?.(route) || new URL(route, location.href).href;
  if (globalThis.chrome?.tabs?.create) return globalThis.chrome.tabs.create({ url: href });
  return globalThis.open?.(href, "_blank", "noopener");
}

const DEFAULT_BUTTON_GROUP = Object.freeze({ select: true, current_tab: false, new_tab: true, preview: false, web: false, copy: false, ask: false, important: false, tags: false, edit: true, remove: true });
const BUTTON_GROUP_OPTIONS = [
  ["select", "选择", "selectAll"], ["current_tab", "直接在浏览器打开", "click"], ["new_tab", "在新标签页中打开", "open"],
  ["preview", "预览模式", "show"], ["web", "Web", "web"], ["copy", "将链接复制到剪贴板", "duplicates"], ["ask", "询问", "ai"],
  ["important", "添加到收藏夹", "like"], ["tags", "标签", "tagAction"], ["edit", "编辑", "edit"], ["remove", "删除", "trash"],
];

function readSearchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history.filter((item) => item && typeof item.query === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function readImportProgress() {
  try {
    const value = JSON.parse(sessionStorage.getItem(IMPORT_PROGRESS_KEY) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function persistImportProgress(preview) {
  try {
    if (preview) sessionStorage.setItem(IMPORT_PROGRESS_KEY, JSON.stringify(preview));
    else sessionStorage.removeItem(IMPORT_PROGRESS_KEY);
  } catch {
    try { sessionStorage.removeItem(IMPORT_PROGRESS_KEY); } catch { /* storage is optional */ }
  }
}

function readBackupHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(BACKUP_HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history.filter((item) => item && item.backup?.format === "private-bookmarks/v1").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function persistBackupHistory(history) {
  try {
    const serialized = JSON.stringify(history.slice(0, 5));
    localStorage.setItem(BACKUP_HISTORY_KEY, serialized);
    return localStorage.getItem(BACKUP_HISTORY_KEY) === serialized;
  } catch {
    return false;
  }
}

const state = {
  view: initialRoute.get("view") || "all", collectionId: initialRoute.get("collection"), query: initialRoute.get("search") || "", tag: "", selected: new Set(), favoriteCount: 0, tags: [],
  items: [], allItems: [], collections: [], collectionCounts: {}, trashCount: 0, trashedCollections: [], preferences: null, layout: "list",
  collapsedCollections: new Set(), dragBookmark: null, dragCollection: null, searchTimer: null, sidebarWidth: null, cardMenuId: null, cardActionProxies: null, editingId: "", editSnapshot: "",
  searchMenuOpen: false, searchFilterGroup: null, sortMenuOpen: false, viewMenuOpen: false, themeMenuOpen: false, recentSearches: readSearchHistory(), groupMenuId: null, collectionMenuId: null, pickerCollectionMenuId: null, pickerGroupMenuId: null, inlineCollectionCreate: null, tagMenuOpen: false, tagItemMenu: null, collectionValueAction: null, collectionValueId: null, collectionSelection: null,
  selectionMoreOpen: false, selectionScreenshotWorking: false, sidebarOpen: false, accountMenuOpen: false, mediaUploadEnabled: false, aiRecommendationsAvailable: false, aiSettings: null, aiBusy: false,
  settingsOpen: initialSettingsRoute, settingsSection: initialSettingsSection || "app", settingsMenu: null, settingsNeedsReload: false, settingsSavePromise: null, connectionInfo: null,
  viewSwitching: false,
  loading: false,
  importPreview: readImportProgress(), importBusy: false, backups: readBackupHistory(), backupSource: "local", backupBusy: false, backupLoading: false, backupIncludeMedia: false, cloudConnections: [], cloudBackups: { dropbox: [], google: [], onedrive: [] }, cloudBackupLoading: {}, cloudBackupErrors: {}, cloudBusy: false, lock: { enabled: false, locked: false, autoLock: "15" },
};

function setGlobalLoading(loading) {
  if (!root) return;
  state.loading = Boolean(loading);
  root.setAttribute("aria-busy", String(state.loading));
  root.classList.toggle("is-loading", state.loading);
  let indicator = root.querySelector("[data-global-loading]");
  if (state.loading && !indicator) {
    root.insertAdjacentHTML("beforeend", `<div class="global-loading" data-global-loading role="status" aria-live="polite"><span class="global-loading-spinner" aria-hidden="true"></span><span>${t("正在加载…")}</span></div>`);
  } else if (!state.loading) {
    indicator?.remove();
  }
}

function setSettingsRoute(open, section = state.settingsSection || "app") {
  const url = new URL(location.href);
  const nextSection = ["app", "account", "import", "backups", "pin"].includes(section) ? section : "app";
  if (open) url.searchParams.set("settings", nextSection);
  else url.searchParams.delete("settings");
  history.pushState({ settings: open }, "", `${url.pathname}${url.search}${url.hash}`);
  state.settingsOpen = Boolean(open);
  state.settingsSection = open ? nextSection : "app";
  state.settingsMenu = null;
  if (open) return render();
  const refresh = () => state.settingsNeedsReload ? (state.settingsNeedsReload = false, load().catch(showError)) : render();
  if (state.settingsSavePromise) state.settingsSavePromise.then(refresh, refresh);
  else refresh();
}

const EN_TEXT = Object.freeze({
  " 个书签": " bookmarks",
  "默认模式": "Default mode", "基础模式": "Basic mode", "严格模式": "Strict mode",
  "使用此封面": "Use this cover", "此书签还没有可用的候选封面。": "This bookmark has no candidate covers.", "正在加载…": "Loading…", "正在创建…": "Creating…", "上传文件（需要配置 R2）": "Upload file (R2 required)", "正在上传封面…": "Uploading cover…", "已保存 ": "Saved ", "删除标签": "Remove tag", "编辑 Markdown": "Edit Markdown",
  "打开所有书签": "Open all bookmarks", "展开所有收藏集": "Expand all collections", "折叠所有收藏集": "Collapse all collections", "按名称排序所有收藏集": "Sort all collections by name", "删除所有空收藏集": "Delete all empty collections", "没有找到收藏集": "No collections found",
  "全部": "All", "搜索图标...": "Search icons...", "没有找到图标": "No icons found",
  "应用": "App", "帐户": "Account", "订阅": "Subscription", "导入": "Import", "整合方式": "Integrations", "备份": "Backups", "帮助": "Help", "设置": "Settings", "私有书签": "Private Bookmarks", "私有实例": "Private instance", "实例名称": "Instance name", "实例地址": "Instance address", "访问密钥": "Access key", "已配置（仅存储在此设备）": "Configured (stored on this device only)", "头像": "Avatar", "固定实例图标": "Fixed instance icon", "认证方式": "Authentication", "访问密钥认证": "Access key authentication", "实例类型": "Instance type", "自托管实例": "Self-hosted instance", "数据统计": "Data", "书签数量": "Bookmarks", "收藏夹数量": "Collections", "废纸篓项目数": "Trash items", "媒体上传": "Media uploads", "已启用": "Enabled", "未配置": "Not configured", "断开当前设备": "Disconnect this device", "确认断开当前设备吗？": "Disconnect this device?", "档案": "File", "上传书签文件 (html、csv 或 txt)": "Upload bookmark file (html, csv, or txt)", "上传书签文件 (html、csv、txt 或 enex)": "Upload bookmark file (html, csv, txt, or enex)", "你可以从浏览器或服务的“导出书签”部分得到这个文件": "You can get this file from the browser or service's bookmark export section", "如何使用？": "How to use?", "上传文件…": "Upload file…", "导入预览": "Import preview", "文件": "File", "格式": "Format", "有效书签": "Valid bookmarks", "重复书签": "Duplicate bookmarks", "无效项目": "Invalid items", "跳过重复项目": "Skip duplicates", "导入这些书签": "Import these bookmarks", "恢复私有书签备份": "Restore Private Bookmarks backup", "备份会替换整个资料库": "This backup replaces the entire library", "当前快照已下载": "The current snapshot was downloaded", "正在解析…": "Parsing…", "正在导入…": "Importing…", "导入完成": "Import complete", "没有可导入的书签": "No bookmarks to import", "清除": "Clear", "条": " items", "个": " ",
  "语言": "Language", "界面样式": "Interface theme", "字体大小": "Font size", "大": "Large", "默认视图模式": "Default view", "默认视图已更改": "Default view changed", "新收藏夹现在将使用": "New collections will now use", "视图模式。": "view mode.", "是否将此更改应用于所有现有收藏夹？": "Apply this change to all existing collections?", "保持不变": "Keep unchanged", "全部更新": "Update all", "列表": "List", "卡片": "Cards", "标题": "Title", "心情看板": "Moodboard", "点击书签时": "When clicking bookmarks", "在新标签页中打开": "Open in new tab", "在当前标签页中打开": "Open in current tab", "按钮组": "Button group", "搜索": "Search", "按相关性排序": "Sort by relevance", "排序标签": "Sort tags", "按名称": "By name", "按书签数量": "By bookmark count", "失效链接": "Broken links", "嵌套收藏": "Nested collections", "旧视图": "Legacy view", "询问 AI": "Ask AI", "推荐的收藏集和标签": "Recommended collections and tags", "AI 推荐标签和备注": "AI suggested tags and note", "仅 Pro 可用。AI 功能暂未接入。": "Only available for Pro. AI is not connected yet.", "AI 功能暂未接入。": "AI is not connected yet.", "推荐功能使用本地已有书签，不会上传数据。": "Recommendations use existing bookmark data and do not upload it.", "AI 版需要在 Worker 中配置 Workers AI。": "The AI version requires a Workers AI binding on the Worker.",
  "所有书签": "All bookmarks", "未分类": "Unsorted", "星标": "Favorites", "待检查": "Pending check", "废纸篓": "Trash", "收藏": "Collections", "快速过滤…": "Quick filters…", "备注": "Notes", "高亮": "Highlights", "提醒": "Reminders", "重复书签": "Duplicates", "没有标签": "Untagged", "标签": "Tags", "链接": "Links", "文章": "Articles", "图片": "Images", "视频": "Videos", "音频": "Audio", "文档": "Documents", "建议的": "Suggested", "最近使用的": "Recently used", "删除最近项": "Remove recent item", "搜索帮助": "Search help", "排序": "Sort", "网站": "Website", "视图": "View", "封面": "Cover", "图标": "Icon", "左": "Left", "右": "Right", "书签信息": "Bookmark info", "描述": "Description", "在列表中显示": "Show in list", "在卡片中显示": "Show in cards", "在标题中显示": "Show in titles", "在心情看板中显示": "Show in moodboard", "应用到全部": "Apply to all", "添加": "Add", "导出书签": "Export bookmarks", "检查链接": "Check links", "导入书签": "Import bookmarks", "直接在浏览器打开": "Open in browser", "移动": "Move", "添加标签": "Add tags", "删除": "Delete", "取消": "Cancel", "更多": "More", "选择所有": "Select all", "创建页面截图": "Create page screenshot", "正在创建页面截图…": "Creating page screenshot…", "刷新预览": "Refresh preview", "添加到收藏夹": "Add to favorites", "从收藏夹移除": "Remove from favorites", "移除标签": "Remove tags", "此视图中还没有书签。": "No bookmarks in this view.", "主题：": "Theme: ", "主题": "Theme", "浅色": "Light", "深色": "Dark", "跟随系统": "System", "日落": "Sunset", "Default mode": "Default mode", "中文（汉语）": "中文（汉语）", "新标签": "New tag", "显示": "Show", "隐藏标签": "Hide tags", "按名称排序标签": "Sort tags by name", "按书签数排序标签": "Sort tags by count", "显示侧边栏": "Show sidebar", "关闭侧边栏": "Close sidebar",
  "关闭": "Close", "返回书签": "Back to bookmarks", "显示设置菜单": "Show settings menu", "可选": "Optional", "选项": " options", "书签详情": "Bookmark details", "暂未支持": "Not supported yet", "打开原网页": "Open original page", "更改图标": "Change icon", "添加描述": "Add description", "添加备注": "Add note", "预览 Markdown": "Preview Markdown", "添加标签…": "Add tags…", "最喜爱的": "Favorite", "添加 URL…": "Add URL…", "上传封面文件": "Upload cover file", "可用封面": "Available covers", "分享收藏夹": "Share collection", "复制": "Copy", "系统分享": "Share", "添加书签": "Add bookmark", "编辑": "Edit", "询问": "Ask", "Web存档": "Web archive", "保存": "Save", "添加 URL": "Add URL", "选择收藏集": "Select collection", "查找或创建新的收藏集…": "Find or create a collection…", "网址": "URL", "收藏夹": "Collection", "封面 URL": "Cover URL", "选择": "Select", "选择全部": "Select all", "恢复": "Restore", "截屏": "Screenshot", "创建嵌套的集合": "Create nested collection", "创建收藏集": "Create collection", "改名": "Rename", "分享": "Share", "显示分组": "Show group", "隐藏分组": "Hide group", "展开": "Expand", "折叠": "Collapse", "收起": "Collapse", "创建群组": "Create group", "删除分组": "Delete group", "新建收藏夹": "New collection", "新收藏": "New collection", "新群组": "New group", "更多操作": "More actions", "复制链接": "Copy link", "将链接复制到剪贴板": "Copy link to clipboard", "列表视图": "List view", "网格视图": "Grid view", "手动排序": "Manual order", "最近添加": "Recently added", "标题 (A-Z)": "Title (A-Z)", "网站 (A-Z)": "Website (A-Z)", "调整侧边栏宽度": "Resize sidebar", "当前标签页": "Current tab", "预览模式": "Preview mode", "Web 预览模式": "Web preview mode", "搜索设置 / 筛选": "Search settings / filters", "缩小搜索范围": "Narrow your search", "在条件前添加短横(-) 将其排除在搜索范围之外": "Prefix a condition with a hyphen (-) to exclude it from search", "浏览器扩展": "Browser extension", "下载应用": "Download app", "帮助与支持": "Help and support", "博客": "Blog", "更新内容?": "What's new?", "注销": "Log out", "按日期 ↑": "By date ↑", "按日期 ↓": "By date ↓", "类型": "Type", "创建日期": "Created", "在标题/描述中": "In title/description", "在URL中": "In URL", "移动到…": "Move to…", "移动到": "Move to", "全选": "Select all", "取消星标": "Remove favorite", "添加星标": "Add favorite", "收藏选项": "Collection options", "收藏集选项": "Collection options", "收藏夹名称": "Collection name", "高亮颜色": "Highlight color", "（无备注）": "(No note)", "应用锁": "App lock", "定时锁定": "Auto-lock", "每次打开": "Every time opened", "1 分钟": "1 minute", "5 分钟": "5 minutes", "15 分钟": "15 minutes", "30 分钟": "30 minutes", "1 小时": "1 hour", "从不": "Never", "启用应用锁": "Enable app lock", "关闭应用锁": "Disable app lock", "立即锁定": "Lock now", "当前已启用": "Enabled on this device", "永远不用担心数据丢失。创建本地快照，保存收藏夹、书签、标签和高亮。": "Never worry about losing your data. Create a local snapshot of collections, bookmarks, tags and highlights.", "创建的快照只保存在此浏览器，完整内容仍可随时下载到本地。": "Snapshots are stored only in this browser and can be downloaded locally at any time.", "创建新的备份": "Create new backup", "备份正在创建": "Your new backup is being created. You can leave this page and come back later.", "下载完整备份": "Get backup", "下载上传文件": "Download uploaded files", "恢复备份": "Restore backup", "历史备份": "Backup history", "云备份": "Cloud backup", "云备份在自托管实例中暂不可用。": "Cloud backup is not available for this self-hosted instance.", "没有历史备份": "No backups created on this device yet.", "下载 JSON": "JSON", "备份创建于": "Created", "云端": "Cloud", "返回导入": "Go to import", "推荐": "Recommendations", "推荐收藏集": "Suggested collection", "推荐标签": "Suggested tags", "应用本地建议": "Apply local suggestions", "生成 AI 建议": "Generate AI suggestions", "应用 AI 建议": "Apply AI suggestions", "正在分析…": "Analyzing…", "没有足够相似的书签": "No similar bookmarks yet", "AI 返回了空建议": "AI returned no suggestions", "AI 建议": "AI suggestions"
});

const EXTRA_EN_TEXT = Object.freeze({
  "没有匹配的书签。": "No matching bookmarks.", "废纸篓为空。": "Trash is empty.", "此收藏夹还没有书签。": "This collection is empty.", "清除搜索": "Clear search", "返回所有书签": "Back to all bookmarks", "添加书签": "Add bookmark", "询问功能暂未接入。": "Ask is not connected yet.", "预览功能暂未接入。": "Preview is not connected yet.", "重试": "Retry", "修改收藏夹名称": "Rename collection", "更改收藏夹图标": "Change collection icon", "输入图标或 Emoji，留空恢复默认": "Enter an icon or emoji; leave blank for default",
  "系统推荐收藏集": "System suggested collection", "AI 推荐收藏集": "AI suggested collection", "新收藏集": "New collection", "创建并选中": "Create and select", "已创建并选中": "Created and selected",
  "应用建议": "Apply suggestions", "已应用": "Applied", "AI 配置": "AI configuration", "提供商": "Provider", "Cloudflare Workers AI": "Cloudflare Workers AI", "外部 OpenAI 兼容 API": "External OpenAI-compatible API", "模型": "Model", "免费额度": "Free quota", "API 地址": "API base URL", "API Key": "API key", "已配置，留空保持不变": "Configured; leave blank to keep", "输入 API Key": "Enter API key", "清除已保存的 API Key": "Clear saved API key", "Prompt": "Prompt", "保存 AI 设置": "Save AI settings", "恢复默认 Prompt": "Restore default prompt", "尚未配置可用 AI": "No usable AI is configured", "Worker 已配置 Workers AI": "Workers AI is configured on this Worker", "外部 API 已配置": "External API is configured", "请在下方配置 Workers AI。": "Configure Workers AI below.", "请在下方配置外部 OpenAI 兼容 API。": "Configure an external OpenAI-compatible API below.", "外部 API 会收到当前书签和相似书签的元数据。": "The external API receives the current bookmark and similar-bookmark metadata.", "自定义 Prompt 会保留固定 JSON 输出约束。": "Custom prompts keep the fixed JSON output contract.", "免费额度受 Cloudflare 账户限制，不代表无限免费。": "Free quota is subject to your Cloudflare account and is not unlimited.", "启用思考模式": "Enable thinking mode", "思考模式会增加等待时间和 Neurons 消耗，建议提高 max_tokens。": "Thinking mode takes longer and uses more Neurons; a higher max_tokens is recommended.", "最大输出 tokens（max_tokens）": "Maximum output tokens (max_tokens)", "控制单次 AI 请求的输出上限，范围为 128–4096。": "Controls the output limit for one AI request; range: 128–4096.", "AI 推荐说明": "AI recommendation details", "AI 建议可能需要更长时间；失败时会保留本地建议。": "AI suggestions may take longer; local suggestions are kept if AI fails.", "思考模式会增加等待时间和 Cloudflare Neurons 消耗。": "Thinking mode takes longer and uses more Cloudflare Neurons.", " 是单次输出上限，不是账户每日额度。": " is the output limit for one request, not your account's daily quota.", "如果思考模式在上限内没有返回最终 JSON，系统会自动关闭思考模式重试一次。两次都失败时不会覆盖当前内容；本地建议也不会自动覆盖当前内容。": "If thinking uses the limit before returning final JSON, the system retries once with thinking disabled. If both attempts fail, current content is not changed; local suggestions are never applied automatically.", "已自动关闭思考模式重试并生成建议": "Thinking mode was disabled for one automatic retry and suggestions were generated.", "模型未在 max_tokens 内返回最终 JSON，已保留本地建议。": "The model did not return final JSON within max_tokens; local suggestions were kept.", "模型在自动回退后仍未返回有效 JSON，已保留本地建议。": "The model still did not return valid JSON after automatic fallback; local suggestions were kept.", "Cloudflare 今日免费额度可能已用尽，请稍后再试或更换模型。": "Your Cloudflare free quota may be exhausted; try again later or choose another model.", "Cloudflare AI 暂时没有可用容量，请稍后再试。": "Cloudflare AI is temporarily out of capacity; try again later.", "该模型需要付费计划，请更换模型或检查账户。": "This model requires a paid plan; choose another model or check your account.", "外部 API Key 无效，请检查 AI 设置。": "The external API key is invalid; check AI settings.", "AI 服务尚未配置，请检查 AI 设置。": "AI is not configured; check AI settings.", "AI 服务不可用，已保留本地建议。": "AI is unavailable; local suggestions were kept.", "配置已保存": "Settings saved"
});

function languageIsEnglish() {
  return state.preferences?.language === "en";
}

function t(text) {
  return languageIsEnglish() ? EN_TEXT[text] || EXTRA_EN_TEXT[text] || text : text;
}

const translationEntries = Object.entries({ ...EN_TEXT, ...EXTRA_EN_TEXT }).sort(([a], [b]) => b.length - a.length);

function translateText(text) {
  if (!languageIsEnglish()) return text;
  const value = String(text ?? "");
  return translationEntries.find(([source]) => source === value)?.[1] || value;
}

function localizeHtml(markup) {
  if (!languageIsEnglish() || typeof document === "undefined") return markup;
  const template = document.createElement("template");
  template.innerHTML = markup;
  const dynamic = ".bookmark-card, .card-title, .card-note, .card-description, .card-tags, .workspace-name, .collection-name, .collection-emoji, .collection-picker-item-name, .settings-profile-copy, .settings-import-preview, .recommendation-note, .recommendation-new-collection strong, .search-recent-item, .collection-trash-card";
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest(dynamic)) continue;
    const source = node.nodeValue || "";
    const value = source.trim();
    if (!value) continue;
    const translated = translateText(value);
    if (translated !== value) node.nodeValue = source.replace(value, translated);
  }
  template.content.querySelectorAll("[title], [aria-label], [placeholder]").forEach((element) => {
    if (element.closest(dynamic)) return;
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute) || "";
      element.setAttribute(attribute, translateText(value));
    }
  });
  return template.innerHTML;
}

const dialogTextSources = new WeakMap();
const dialogAttributeSources = new WeakMap();
const dialogDynamicSelector = "#cover-picker-items, #collection-picker-list, #collection-icon-picker-content, #batch-tag-menu, #edit-tag-menu, #edit-tag-tokens, #edit-note-preview";

function localizeDialogs() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue.trim() || node.parentElement?.closest(dialogDynamicSelector)) continue;
      if (!dialogTextSources.has(node)) dialogTextSources.set(node, node.nodeValue);
      node.nodeValue = translateText(dialogTextSources.get(node));
    }
    dialog.querySelectorAll("[title], [aria-label], [placeholder]").forEach((element) => {
      if (element.closest(dialogDynamicSelector) && !element.matches(dialogDynamicSelector)) return;
      for (const attribute of ["title", "aria-label", "placeholder"]) {
        if (!element.hasAttribute(attribute)) continue;
        let sources = dialogAttributeSources.get(element);
        if (!sources) dialogAttributeSources.set(element, sources = {});
        if (!(attribute in sources)) sources[attribute] = element.getAttribute(attribute);
        element.setAttribute(attribute, translateText(sources[attribute]));
      }
    });
  });
}

const treeIcons = {
  arrow: '<path fill-rule="evenodd" d="m5 8 4.995 5 4.995-5H5Z"></path>',
  caret: '<path fill-rule="evenodd" d="m7 9 2.995 3 2.995-3H7Z"></path>',
  add: '<path d="M10 3H9v6H3v1h6v6h1v-6h6V9h-6z"></path>',
  menu: '<path fill-rule="evenodd" d="M3 4h14v1H3V4Zm0 5h14v1H3V9Zm0 5h14v1H3v-1Z"></path>',
  app: '<g fill-rule="evenodd"><path d="M2 3h16v14H2z" opacity=".1"></path><path fill-rule="nonzero" d="M17 2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14Zm0 1H3a1 1 0 0 0-.993.883L2 4v12a1 1 0 0 0 .883.993L3 17h14a1 1 0 0 0 .993-.883L18 16V4a1 1 0 0 0-.883-.993L17 3Z"></path><path d="M3 6h14v1H3V6Z"></path></g>',
  user: '<g fill-rule="evenodd"><path d="M10 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 18a7 7 0 0 1 14 0H3Zm1.05-1h11.9a6 6 0 0 0-11.9 0Z"></path></g>',
  diamond: '<path fill-rule="evenodd" d="m10 1 8 9-8 9-8-9 8-9Zm0 1.5L3.34 10 10 17.5 16.66 10 10 2.5Z"></path>',
  integrations: '<g fill-rule="evenodd"><path d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 1a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"></path><path d="M2 9h16v1H2V9Zm7.5-7.5h1v17h-1v-17Z"></path></g>',
  backup: '<g fill-rule="evenodd"><path d="M10 2a6 6 0 0 1 5.92 5H16a3 3 0 1 1 0 6h-1v-1h1a2 2 0 1 0 0-4h-1v-.5A5 5 0 1 0 5.5 9H5a5 5 0 0 1 5-7Z"></path><path d="M10 8v7.293l2.146-2.147.708.708L10 16.707l-2.854-2.853.708-.708L9 15.293V8h1Z"></path></g>',
  export: '<g fill-rule="evenodd"><path d="M16.25 8.25V9.5A3.755 3.755 0 0 1 20 13.25 3.755 3.755 0 0 1 16.25 17H5c-2.758 0-5-2.242-5-5 0-2.364 1.654-4.339 3.862-4.858C4.388 4.225 6.932 2 10 2a6.257 6.257 0 0 1 6.25 6.25Z" opacity=".12" /><path d="M16.25 8.25V9.5A3.755 3.755 0 0 1 20 13.25 3.755 3.755 0 0 1 16.25 17H5c-2.758 0-5-2.242-5-5 0-2.364 1.654-4.339 3.862-4.858C4.388 4.225 6.932 2 10 2a6.257 6.257 0 0 1 6.25 6.25Zm-1 0A5.257 5.257 0 0 0 10 3a5.249 5.249 0 0 0-5.153 4.32l-.117.646-.639.15A4.001 4.001 0 0 0 1 12c0 2.205 1.795 4 4 4h11.25A2.755 2.755 0 0 0 19 13.25a2.755 2.755 0 0 0-2.75-2.75h-1V8.25Z" /><path d="M10 12.929 11.688 11H13l-3.5 4L6 11h1.313L9 12.929V6h1v6.929Z" /></g>',
  backupReady: '<g fill-rule="evenodd"><path d="M5 18a5 5 0 0 1-.949-9.91C4.433 4.653 6.951 2 10 2c3.314 0 6 3.134 6 7 .34 0 .676-.02 1.004-.061L16 10a4 4 0 1 1 0 8H5Z" opacity=".15"></path><path d="m17.27 3.626.748.665a.5.5 0 0 1 .044.703l-7.002 9.003-.316.354a.5.5 0 0 1-.686.059l-.412-.334-3-3a.5.5 0 0 1-.036-.666l.624-.78a.5.5 0 0 1 .744-.042l2.284 2.284 6.3-8.201a.5.5 0 0 1 .709-.045Z"></path></g>',
  dropbox: '<path fill-rule="evenodd" d="M19 4.485 13.705 1 10 4.117l5.339 3.323L19 4.485Zm-8.99 6.948-3.715 3.108-1.59-1.046v1.173l5.306 3.207 5.306-3.207v-1.173l-1.59 1.046-3.716-3.108ZM6.296 1 1 4.485 4.661 7.44l5.34-3.323L6.294 1ZM10 10.762 6.295 13.88 1 10.395 4.661 7.44 10 10.762l5.339-3.323 3.66 2.956-5.294 3.485L10 10.762Z"></path>',
  gdrive: '<path d="m4.142 17.467 11.802.03L19 12.648 7.04 12.45l-2.898 5.017ZM12.948 2H6.992l5.462 10.045 6.3.085L12.948 2ZM1 12.14l2.524 5.281L9.44 7.465 6.63 2.163 1 12.141Z"></path>',
  onedrive: '<g fill-rule="evenodd"><path d="m4.99 5.861-.042.072h-.015l-.222.429c-.241.464-.515 1.002-.832 1.633l-.08.16c-.067.132-2.272 4.357-2.458 4.713.136-2.68 1.734-5.118 3.98-5.679ZM10.38 4l.221.005c1.171.054 2.386.528 3.363 1.293.512.414.963.914 1.331 1.48l.078.124c.057.1.11.201.16.305a8.595 8.595 0 0 0-.671-.033c-1.052 0-2.025.347-2.806.933A6.013 6.013 0 0 0 6.4 6.934C7.456 5.127 8.806 4 10.38 4Zm2.393 6.01c.284-.263.67-.424 1.094-.424.45 0 .857.18 1.145.47a2.79 2.79 0 0 1 .768-.107c1.227 0 2.22.994 2.22 2.22a2.22 2.22 0 0 1-2.22 2.22H6.23a4.23 4.23 0 0 1 0-8.46c.148 0 .294.008.438.023A6.018 6.018 0 0 1 12.773 10.01Z"></path></g>',
  lock: '<path fill-rule="evenodd" d="M6 8V6a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1Zm1 0h6V6a3 3 0 1 0-6 0v2Zm-2 1v8h10V9H5Z"></path>',
  selectAll: '<path fill-rule="evenodd" d="M2 3.5c0-.276.232-.5.5-.5H3v1H2v-.5ZM2 5h1v1H2V5Zm0 2h1v1H2V7Zm0 2h1v1H2V9Zm0 2h1v1H2v-1Zm0 2h1v1H2v-1Zm0 2h1v1H2v-1Zm0 2h1v1h-.5a.505.505 0 0 1-.5-.5V17ZM16 5h1v1h-1V5Zm0 2h1v1h-1V7Zm0 2h1v1h-1V9Zm0 2h1v1h-1v-1Zm0 2h1v1h-1v-1Zm0 2h1v1h-1v-1ZM4 3h1v1H4V3Zm2 0h1v1H6V3Zm2 0h1v1H8V3Zm2 0h1v1h-1V3Zm2 0h1v1h-1V3Zm2 0h1v1h-1V3Zm2 0h.5c.276 0 .5.232.5.5V4h-1V3ZM4 17h1v1H4v-1Zm2 0h1v1H6v-1Zm2 0h1v1H8v-1Zm2 0h1v1h-1v-1Zm2 0h1v1h-1v-1Zm2 0h1v1h-1v-1Zm2 0h1v.5c0 .276-.232.5-.5.5H16v-1Zm-8.747-2.664 1.372-.117L4.5 10.321v1.46l3.617 3.593 7.383-8.71V4.97z"></path>',
  edit: '<path d="m11.653 2.903-8.75 8.75a1.375 1.375 0 0 0-.403.972v3.5c0 .76.616 1.375 1.375 1.375h3.5c.365 0 .714-.145.972-.403l8.75-8.75a1.375 1.375 0 0 0 0-1.944l-3.5-3.5a1.375 1.375 0 0 0-1.944 0Zm1.237.707 3.5 3.5a.375.375 0 0 1 0 .53l-8.75 8.75a.375.375 0 0 1-.265.11h-3.5a.375.375 0 0 1-.375-.375v-3.5c0-.1.04-.195.11-.265l8.75-8.75a.375.375 0 0 1 .53 0Z"></path>',
  all: '<path d="M14.95 3.973a6.597 6.597 0 0 1 2.042 4.44 5 5 0 0 1-1.775 9.582L15 18H5a5 5 0 0 1-1.99-9.588 6.59 6.59 0 0 1 2.04-4.439c2.734-2.63 7.166-2.63 9.9 0Zm-4.527-.958-.126-.008-.387-.006-.364.016-.032.002a6.093 6.093 0 0 0-3.77 1.675 5.615 5.615 0 0 0-1.706 3.4l.031-.007c-.03.199-.05.4-.061.605L4 9l.002.125a3.975 3.975 0 0 0-.975.395l-.046.026a4.002 4.002 0 0 0-.522.365l-.203.179-.164.163-.112.124-.123.149-.15.203-.112.171-.133.231-.047.092-.075.162-.055.13a3.97 3.97 0 0 0-.117.333l-.041.15-.045.193-.042.243-.03.272-.005.088L1 13l.005.2.026.297c.033.266.092.525.175.772l.109.29.085.187.094.18.109.186.139.21.115.152.088.108.19.21.166.16.152.132.18.14.144.102.247.152.159.086.157.076.128.056.154.06.204.069.192.054c.19.048.386.082.585.102l.197.014L5 17h9.979l.195-.004.205-.014.194-.023.239-.041.04-.01c.164-.034.322-.08.477-.134l.205-.078.188-.085.036-.017a3.924 3.924 0 0 0 .65-.4 4.017 4.017 0 0 0 1.135-1.335l.085-.173.102-.24A3.966 3.966 0 0 0 19 13l-.003-.157-.011-.184-.028-.242-.057-.305-.06-.23-.066-.208-.079-.206-.103-.228-.096-.184-.07-.12a3.99 3.99 0 0 0-.181-.274l-.119-.156-.09-.109-.15-.167-.143-.14-.153-.137-.132-.108-.226-.164-.174-.111-.106-.061a3.966 3.966 0 0 0-.704-.31l-.25-.073L16 9c0-.31-.024-.615-.069-.913l.031.005a5.614 5.614 0 0 0-1.706-3.398 6.083 6.083 0 0 0-3.496-1.648l-.337-.031Z"></path>',
  inbox: '<g fill-rule="evenodd"><path d="M2 10h5l3 3 3-3h5v7H2z" opacity=".1"></path><path fill-rule="nonzero" d="M17 2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14ZM2 16a1 1 0 0 0 .883.993L3 17h14a1 1 0 0 0 .993-.883L18 16v-6h-5.019l-.014.168c-.184 1.763-1.128 2.754-2.767 2.828L10 13c-1.762 0-2.776-.998-2.967-2.832L7.018 10H2v6ZM17 3H3a1 1 0 0 0-.993.883L2 4v5h5.5a.5.5 0 0 1 .5.5c0 1.742.632 2.5 2 2.5 1.368 0 2-.758 2-2.5a.5.5 0 0 1 .41-.492L12.5 9H18V4a1 1 0 0 0-.883-.993L17 3Z"></path></g>',
  folder: '<g fill-rule="evenodd"><path d="M2 7h16v10H2z" opacity=".12"></path><path d="M2 16h16v1H2z" opacity=".12"></path><path d="M1 16.5c0 .82.67 1.5 1.5 1.5h15c.83 0 1.5-.68 1.5-1.5v-11c0-.83-.67-1.5-1.5-1.5h-9l.35.15-2-2L6.7 2H2.5C1.67 2 1 2.67 1 3.5v13ZM18 7v10H2V7h16ZM6.5 3l-.35-.15 2 2L8.3 5h9.2c.28 0 .5.22.5.5V6H2V3.5c0-.28.22-.5.5-.5h4Z"></path></g>',
  note: '<g fill-rule="evenodd"><path fill-rule="nonzero" d="M16 2a2 2 0 0 1 2 2v7.586a1 1 0 0 1-.293.707l-5.414 5.414a1 1 0 0 1-.707.293H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12Zm0 1H4a1 1 0 0 0-.993.883L3 4v12a1 1 0 0 0 .883.993L4 17h7.586L17 11.586V4a1 1 0 0 0-.883-.993L16 3Z"></path><path d="M12 11h6l-7 7v-6a1 1 0 0 1 1-1Z" opacity=".5"></path><path fill-rule="nonzero" d="m18 11-1 1h-5v5l-1 1v-6a1 1 0 0 1 1-1h6Z"></path></g>',
  link: '<path fill-rule="evenodd" d="M1 9.5C1 7.015 3.012 5 5.496 5h9.008a4.501 4.501 0 0 1 0 9H5.496A4.501 4.501 0 0 1 1 9.5Zm1 0C2 7.567 3.563 6 5.491 6h9.018A3.498 3.498 0 0 1 18 9.5c0 1.933-1.563 3.5-3.491 3.5H5.49A3.498 3.498 0 0 1 2 9.5ZM9 5h2v1H9V5Zm0 8h2v1H9v-1ZM6 9h8v1H6V9Z"></path>',
  star: '<path fill-rule="evenodd" d="m10 1.75 2.48 5.025 5.546.806-4.013 3.911.947 5.524L10 14.409l-4.96 2.607.947-5.524-4.013-3.911 5.546-.806L10 1.75Zm0 2.26L8.18 7.7l-4.073.592 2.947 2.873-.696 4.057L10 13.308l3.642 1.914-.696-4.057 2.947-2.873-4.073-.592L10 4.01Z"></path>',
  like: '<g fill-rule="evenodd"><path d="M2 7.935c0 2.033 1.305 4.219 3.844 6.29 1.244 1.03 2.762 2.002 3.881 2.555l-.443.896.288-.957c-.01-.004-.005-.002.008 0 .042.008.09.014.115.017l-.11.994-.1-.995a.937.937 0 0 0 .071-.01.388.388 0 0 0-.106.04c1.096-.529 2.621-1.505 3.882-2.558 2.534-2.057 3.835-4.232 3.835-6.272A3.929 3.929 0 0 0 13.23 4c-.1 0-.231.03-.39.096-.392.164-.863.51-1.356.984a11.022 11.022 0 0 0-1.097 1.232l-.84 1.138-.792-1.171C7.645 4.639 6.902 4 5.935 4A3.929 3.929 0 0 0 2 7.935Z" opacity=".09"></path><path d="M9.315 16.568a22.405 22.405 0 0 1-3.471-2.344C3.305 12.154 2 9.968 2 7.935c0-.161.01-.32.028-.477.204 1.882 1.494 3.872 3.816 5.766 1.244 1.032 2.762 2.003 3.881 2.556l-.394.797c.085.045.168.089.25.13v.013h-.003c-.013-.003-.019-.005-.008-.001l-.288.957.443-.896a12.46 12.46 0 0 1-.14-.07l-.001.01c.04.007.085.013.11.016l-.111.994-.1-.995a.937.937 0 0 0 .071-.01.388.388 0 0 0-.106.04l.132-.064-.097-.966a.937.937 0 0 0 .071-.01.388.388 0 0 0-.106.04c1.096-.529 2.621-1.505 3.882-2.558 2.318-1.882 3.605-3.862 3.807-5.748a4 4 0 0 1 .028.476c0 2.04-1.301 4.215-3.835 6.272-1.209 1.01-2.66 1.948-3.744 2.49l.107-.96a1.87 1.87 0 0 1-.115-.018c-.013-.002-.019-.004-.008 0l-.255.849Z" opacity=".09"></path><path d="M2 7.935c0 2.033 1.305 4.219 3.844 6.29 1.244 1.03 2.762 2.002 3.881 2.555l-.443.896.288-.957c-.01-.004-.005-.002.008 0 .042.008.09.014.115.017l-.11.994-.1-.995a.937.937 0 0 0 .071-.01.388.388 0 0 0-.106.04c1.096-.529 2.621-1.505 3.882-2.558 2.534-2.057 3.835-4.232 3.835-6.272A3.929 3.929 0 0 0 13.23 4c-.1 0-.231.03-.39.096-.392.164-.863.51-1.356.984a11.022 11.022 0 0 0-1.097 1.232l-.84 1.138-.792-1.171C7.645 4.639 6.902 4 5.935 4A3.929 3.929 0 0 0 2 7.935Zm6.976-3.066a8.095 8.095 0 0 0-.198.255l.395.008c.14.192.276.388.41.586 0 0 .174-.235.46-.568l.368.008-.163-.238C10.975 4.118 12.178 3 13.23 3a4.93 4.93 0 0 1 4.935 4.935c0 2.392-1.47 4.828-4.205 7.049-1.502 1.255-3.144 2.231-4.077 2.682-.086.043-.3.064-.3.064s-.193-.021-.3-.054c-.934-.461-2.576-1.437-4.077-2.682C2.47 12.763 1 10.317 1 7.935A4.93 4.93 0 0 1 5.935 3c1.309 0 2.24.83 3.041 1.87Z"></path></g>',
  tag: '<path fill-rule="evenodd" d="M6.21 7H3.22l-.225 1.57a.5.5 0 0 1-.99-.14L2.209 7H.51A.51.51 0 0 1 0 6.5c0-.276.222-.5.51-.5h1.842l.286-2H1.51A.51.51 0 0 1 1 3.5c0-.276.222-.5.51-.5h1.27l.225-1.57a.5.5 0 0 1 .99.14L3.791 3h2.99l.224-1.57a.5.5 0 0 1 .99.14L7.791 3h1.7a.51.51 0 0 1 .509.5c0 .276-.222.5-.51.5H7.648l-.286 2H8.49a.51.51 0 0 1 .51.5c0 .276-.222.5-.51.5H7.22l-.225 1.57a.5.5 0 0 1-.99-.14L6.209 7Zm.142-1h-2.99l.286-2h2.99l-.286 2Z"></path>',
  tagAction: '<g fill-rule="evenodd"><path fill-rule="nonzero" d="m13.307 3 .09.004a.5.5 0 0 1 .436.47l-.004.09L13.39 7h3.278a.5.5 0 0 1 .09.992l-.09.008H13.26l-.512 4h3.92a.5.5 0 0 1 .09.992l-.09.008H12.62l-.456 3.564a.5.5 0 0 1-.996-.037l.004-.09.44-3.437H7.62l-.456 3.564a.5.5 0 0 1-.996-.037l.004-.09L6.61 13H3.333a.5.5 0 0 1-.09-.992l.09-.008H6.74l.513-4h-3.92a.5.5 0 0 1-.09-.992L3.333 7H7.38l.457-3.564a.5.5 0 0 1 .47-.435l.09.003a.5.5 0 0 1 .436.47l-.004.09L8.39 7h3.991l.457-3.564a.5.5 0 0 1 .47-.435Zm-1.568 9 .513-4H8.26l-.512 4h3.992Z"></path><path d="M9 9h3l-1 2H8z" opacity=".1"></path></g>',
  searchTag: '<g fill-rule="evenodd"><path fill-rule="nonzero" d="m13.307 3 .09.004a.5.5 0 0 1 .436.47l-.004.09L13.39 7h3.278a.5.5 0 0 1 .09.992l-.09.008H13.26l-.512 4h3.92a.5.5 0 0 1 .09.992l-.09.008H12.62l-.456 3.564a.5.5 0 0 1-.996-.037l.004-.09.44-3.437H7.62l-.456 3.564a.5.5 0 0 1-.996-.037l.004-.09L6.61 13H3.333a.5.5 0 0 1-.09-.992l.09-.008H6.74l.513-4h-3.92a.5.5 0 0 1-.09-.992L3.333 7H7.38l.457-3.564a.5.5 0 0 1 .47-.435l.09.003a.5.5 0 0 1 .436.47l-.004.09L8.39 7h3.991l.457-3.564a.5.5 0 0 1 .47-.435Zm-1.568 9 .513-4H8.26l-.512 4h3.992Z"></path><path d="M9 9h3l-1 2H8z" opacity=".1"></path></g>',
  search: '<path d="M9 3a6 6 0 1 1 0 12A6 6 0 0 1 9 3Zm0 1a5 5 0 1 0 0 10A5 5 0 0 0 9 4Z"></path><path d="M12.646 12.646a.5.5 0 0 1 .638-.057l.07.057 3.5 3.5a.5.5 0 0 1-.638.765l-.07-.057-3.5-3.5a.5.5 0 0 1 0-.708Z"></path>',
  info: '<path d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 1a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 11V9.99A1 1 0 0 0 10 9H9v5.01a1 1 0 0 0 1 .99h1v-1h1v-1h-1ZM8 9h1v1H8V9Zm1-4h2v2H9V5Z"></path>',
  type: '<path fill-rule="evenodd" d="M1 5h18v1H1zm3 4h12v1H4zm3 4h6v1H7z"></path>',
  article: '<g fill-rule="evenodd"><path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-1a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-3.5-5H14v-1H6v1h.5Zm0 2H14v-1H6v1h.5Zm5.833-6H14V7h-2v1h.333Zm0 2H14V9h-2v1h.333Z"></path><path d="m7.185 9-.543 1H5.5l3-5.5 3 5.5h-1.145l-.542-1H7.185Zm.543-1L8.5 6.58 9.27 8H7.728Z"></path></g>',
  audio: '<path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0 1a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-1-7.95V6h5v2h-3v4.5a2.5 2.5 0 1 1-2-2.45Z"></path>',
  document: '<path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0 1a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.688-5H11v-1H6v1h.313Zm1.021-4H14V8H6v1h1.333Zm0 2H14v-1H6v1h1.333Z"></path>',
  image: '<g fill-rule="evenodd"><path d="m4 14 3.418-4.665L11.12 13l2.24-1.52 3.053 2.813-2.747 2.445-5.493.622L5 16l-1-2Z" opacity=".1"></path><path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0 1a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"></path><path d="m8.21 9.26 2.997 2.997 2.293-1.293 3.205 3.28-1.132.204-2.78-2.776 1.198.164-2.293 1.292-.661.373-.537-.537-3.64-3.64L3.2 13.77l1.06.276L8.21 9.26Zm-.638.766.615-.738L7.5 8.55l-.635.802.707.674ZM11 6h2v2h-2z"></path></g>',
  video: '<path fill-rule="evenodd" d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0 1a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM8 7l5 3-5 3V7Z"></path>',
  highlights: '<g fill-rule="evenodd"><path d="M11.619 4.313 14.077 2 18 6.041l-2.364 2.461z" opacity=".3"></path><rect width="14" height="1" x="4" y="17" opacity=".5" rx=".5"></rect><path fill-rule="nonzero" d="m14.707 1.707 3.586 3.586a1 1 0 0 1 0 1.414l-11 11a1 1 0 0 1-.707.293H3a1 1 0 0 1-1-1v-3.586a1 1 0 0 1 .293-.707l11-11a1 1 0 0 1 1.414 0Zm-3.354 3.354L3 13.414V17h3.586l8.351-8.353-3.584-3.586ZM14 2.414l-1.94 1.94 3.584 3.586L17.586 6 14 2.414Z"></path></g>',
  reminder: '<path d="M3.869 15a1 1 0 0 1-.833-1.555L4 12V8a6 6 0 1 1 12 0v4l.964 1.445A1 1 0 0 1 16.13 15H13a3 3 0 0 1-6 0H3.869ZM12 15H8l.005.15A2 2 0 0 0 12 15ZM10 3a5 5 0 0 0-5 5v4.303l-.168.252L3.87 14h12.26l-.963-1.445-.168-.252V8a5 5 0 0 0-5-5Z"></path>',
  public: '<path d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm3.152 1.645c-.553.373-1.312.902-1.577 1.265-.135.185-.327 1.132-.95 1.21-.162.02-.381.006-.613-.009-.622-.04-1.472-.095-1.744.644-.173.468-.203 1.74.356 2.4.09.105.107.3.046.519-.08.287-.241.462-.292.498-.096-.056-.288-.279-.419-.43-.313-.365-.705-.82-1.211-.96-.184-.051-.386-.093-.583-.135-.549-.115-1.17-.246-1.315-.554-.106-.226-.105-.537-.105-.865 0-.417 0-.888-.204-1.345a1.276 1.276 0 0 0-.306-.43 8 8 0 0 0 8.817 12.944c.115-.75-.137-1.47-.24-1.722-.23-.56-.988-1.517-2.253-2.844-.338-.355-.316-.628-.195-1.437l.013-.091c.082-.554.22-.882 2.085-1.178.948-.15 1.197.228 1.542.753l.116.172c.328.48.571.59.938.756.165.075.37.17.645.325.611.35.65.742.652 1.549v.272c0 .391-.038.735-.098 1.034a8.002 8.002 0 0 0-3.105-12.341Z"></path>',
  broken: '<g fill-rule="evenodd"><path d="M6 8h2v2H6zm6 0h2v2h-2z" opacity=".1"></path><path fill-rule="nonzero" d="M10 1a8 8 0 0 1 8 8v8.147a1 1 0 0 1-1.858.514L15 15.757l-1.793 1.793a1 1 0 0 1-1.415 0L10 15.757 8.207 17.55a1 1 0 0 1-1.415 0L5 15.757l-1.143 1.905A1 1 0 0 1 2 17.148V9a8 8 0 0 1 8-8Zm0 1a7 7 0 0 0-6.996 6.76L3 9l-.001 8.343 1.294-2.293a1 1 0 0 1 1.32-.083l.094.083L7.5 16.842l1.794-1.792a1 1 0 0 1 1.32-.083l.094.083 1.792 1.792 1.794-1.792a1 1 0 0 1 1.32-.083l.094.083L17 17.342V9a7 7 0 0 0-6.76-6.996L10 2ZM7 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM7 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"></path><path fill-rule="nonzero" d="m16.999 17.342-1.292-2.292-.094-.083a1 1 0 0 0-1.32.083l-1.794 1.792-1.792-1.792-.094-.083a1 1 0 0 0-1.32.083l-1.794 1.792-1.792-1.792-.094-.083a1 1 0 0 0-1.32.083l-1.294 2.293v-3l1.294-2.293a1 1 0 0 1 1.32-.083l.094.083L7.5 13.842l1.794-1.792a1 1 0 0 1 1.32-.083l.094.083 1.792 1.792 1.794-1.792a1 1 0 0 1 1.32-.083l.094.083L17 14.342v3Z" opacity=".1"></path></g>',
  calendar: '<g fill-rule="evenodd"><path d="M3 8h14v9H3z" opacity=".1"></path><path fill-rule="nonzero" d="M7 1v2h6V1h1v2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2V1h1ZM3 8v8a1 1 0 0 0 .883.993L4 17h12a1 1 0 0 0 .993-.883L17 16V8H3Zm0-1h14V5a1 1 0 0 0-.883-.993L16 4h-2v2h-1V4H7v2H6V4H4a1 1 0 0 0-.993.883L3 5v2Z"></path></g>',
  settings: '<path d="m5.253 15.152 1.648-.915a1.167 1.167 0 0 1 1.074-.031c.157.076.319.143.484.2.358.126.632.417.736.781L9.713 17h.574l.518-1.813c.104-.364.378-.655.736-.78a4.63 4.63 0 0 0 .484-.201 1.167 1.167 0 0 1 1.074.03l1.648.916.405-.405-.915-1.648a1.167 1.167 0 0 1-.031-1.074 4.63 4.63 0 0 0 .2-.484c.126-.358.417-.632.781-.736L17 10.287v-.574l-1.813-.518a1.167 1.167 0 0 1-.78-.736 4.63 4.63 0 0 0-.201-.484 1.167 1.167 0 0 1 .03-1.074l.916-1.648-.405-.405-1.648.915a1.167 1.167 0 0 1-1.074.031 4.63 4.63 0 0 0-.484-.2 1.167 1.167 0 0 1-.736-.781L10.287 3h-.574l-.518 1.813a1.167 1.167 0 0 1-.736.78 4.63 4.63 0 0 0-.484.201 1.167 1.167 0 0 1-1.074-.03l-1.648-.916-.405.405.915 1.648c.184.332.196.732.031 1.074a4.63 4.63 0 0 0-.2.484 1.167 1.167 0 0 1-.781.736L3 9.713v.574l1.813.518c.364.104.655.378.78.736.058.165.125.327.201.484a1.17 1.17 0 0 1-.03 1.074l-.916 1.648.405.405ZM2.55 11.3a.792.792 0 0 1-.55-.734V9.434c0-.319.248-.648.55-.734l2.055-.587c.07-.203.153-.401.246-.593L3.813 5.65a.792.792 0 0 1 .13-.908l.8-.8a.808.808 0 0 1 .908-.13L7.52 4.85c.192-.093.39-.175.593-.246L8.7 2.55A.792.792 0 0 1 9.434 2h1.132c.319 0 .648.248.734.55l.587 2.055c.203.07.401.153.593.246l1.869-1.038a.792.792 0 0 1 .908.13l.8.8a.808.808 0 0 1 .13.908L15.15 7.52c.093.192.175.39.246.593l2.055.587c.304.087.55.402.55.734v1.132a.808.808 0 0 1-.55.734l-2.055.587a5.678 5.678 0 0 1-.246.593l1.038 1.869a.792.792 0 0 1-.13.908l-.8.8a.808.808 0 0 1-.908.13l-1.87-1.037c-.192.093-.39.175-.593.246L11.3 17.45a.792.792 0 0 1-.734.55H9.434a.808.808 0 0 1-.734-.55l-.587-2.055a5.678 5.678 0 0 1-.593-.246l-1.87 1.038a.792.792 0 0 1-.908-.13l-.8-.8a.808.808 0 0 1-.13-.908L4.85 12.48a5.678 5.678 0 0 1-.246-.593L2.55 11.3ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"></path>',
  extension: '<path d="M8 1a1 1 0 0 0-.993.883L7 2v3H2a1 1 0 0 0-.993.883L1 6v3h1.037l.186.008a3 3 0 0 1-.047 5.987L2 15H1v3a1 1 0 0 0 .883.993L2 19h3v-1.037l.008-.186a3 3 0 0 1 5.987.047L11 18v1h3a1 1 0 0 0 .993-.883L15 18v-5h3a2 2 0 1 0 0-4h-3V6a1 1 0 0 0-.883-.993L14 5H9V2a1 1 0 0 0-1-1Z"></path>',
  install: '<path d="M10 12.962 13.679 9H15l-5.5 6L4 9h1.321L9 12.962V4h1z"></path><path d="M9.5 1a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm0 1a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z"></path>',
  history: '<path d="M2 4.002v9.996c0 .162.186.455.335.525l7.59 3.572h-.85l7.59-3.572c.15-.07.335-.36.335-.525V4.002c0 .184.352.408.516.33l-7.59 3.573-.426.2-.426-.2-7.59-3.572c.16.076.516-.148.516-.33Zm-1 0c0-.553.41-.81.91-.574L9.5 7l7.59-3.572c.503-.236.91.028.91.574v9.996c0 .553-.41 1.195-.91 1.43L9.5 19l-7.59-3.572c-.503-.236-.91-.884-.91-1.43V4.002Z"></path>',
  exit: '<g fill-rule="evenodd"><path d="M7 4h10v11H7z" opacity=".09"></path><path d="M7 10v4c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H9c-1.1 0-2 1.1-2 2v4H4.143L5 6 2 9.5 5 13l-.857-3H7v2h1v-2H7Zm1 0v4.154c0 .474.45.846 1 .846h7c.54 0 1-.38 1-.846V4.846C17 4.372 16.55 4 16 4H9c-.54 0-1 .38-1 .846V9h5v1H8Zm0-1V7H7v2h1Z"></path></g>',
  help: '<g fill-rule="evenodd"><path d="M10 18c-4.417 0-8-3.583-8-8s3.583-8 8-8 8 3.583 8 8-3.583 8-8 8Z" opacity=".1"></path><path fill-rule="nonzero" d="M19 10c0-4.974-4.026-9-9-9s-9 4.026-9 9 4.026 9 9 9 9-4.026 9-9Zm-9 7.94A7.942 7.942 0 0 1 2.06 10 7.942 7.942 0 0 1 10 2.06 7.942 7.942 0 0 1 17.94 10 7.942 7.942 0 0 1 10 17.94Z"></path><path fill-rule="nonzero" d="M10 14a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm.129-10a3.132 3.132 0 0 1 3.128 3.13c0 1.568-1.16 2.87-2.667 3.094v1.823a.462.462 0 0 1-.923 0V9.796c0-.255.207-.462.462-.462a2.207 2.207 0 0 0 2.205-2.205c0-1.216-.99-2.206-2.205-2.206-1.217 0-2.206.99-2.206 2.206a.462.462 0 0 1-.923 0A3.132 3.132 0 0 1 10.129 4Z"></path></g>',
  microTune: '<path fill-rule="evenodd" d="M2.5 5a2.5 2.5 0 0 1 2.45 2H10v1H4.95A2.5 2.5 0 1 1 2.5 5Zm0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5-6a2.5 2.5 0 1 1-2.45 3H0V2h5.05A2.5 2.5 0 0 1 7.5 0Zm0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"></path>',
  microArrow: '<path d="m2 4 2.995 3L7.99 4z"></path>',
  microOpen: '<path fill-rule="evenodd" d="M7.293 2H3.5a.5.5 0 1 1 0-1h5a.498.498 0 0 1 .5.5v5a.5.5 0 1 1-1 0V2.707L1.854 8.854a.5.5 0 0 1-.708-.708L7.293 2Z"></path>',
  microClose: '<path fill-rule="evenodd" d="M5 5.707 2.211 8.496a.995.995 0 0 1-1.416.006l.703.703a1.006 1.006 0 0 1 .006-1.416L4.293 5 1.504 2.211A.995.995 0 0 1 1.498.795l-.703.703a1.006 1.006 0 0 1 1.416.006L5 4.293l2.789-2.789A.997.997 0 0 1 9.207 1.5L8.5.793a1.006 1.006 0 0 1-.004 1.418L5.707 5l2.789 2.789c.4.4.395 1.028.004 1.418l.707-.707a1.006 1.006 0 0 1-1.418-.004L5 5.707Z"></path>',
  microAdd: '<path fill-rule="evenodd" d="M5 0H4v4H0v1h4v4h1V5h4V4H5z"></path>',
  microAi: '<path d="M4.5 1c.244 0 .463.152.548.381l.93 2.528a.19.19 0 0 0 .113.114l2.528.93a.584.584 0 0 1 0 1.095l-2.528.93a.191.191 0 0 0-.114.113l-.93 2.528a.584.584 0 0 1-1.095 0l-.93-2.528a.191.191 0 0 0-.113-.114l-2.528-.93a.584.584 0 0 1 0-1.095l2.528-.93a.191.191 0 0 0 .114-.113l.93-2.528A.584.584 0 0 1 4.5 1ZM9 0v1h1v1H9v1H8V2H7V1h1V0h1Z"></path>',
  microArticle: '<path fill-rule="evenodd" d="M0 2C0 .895.887 0 2 0h6c1.105 0 2 .887 2 2v6c0 1.105-.887 2-2 2H2c-1.105 0-2-.887-2-2V2Zm2 1h6v1H2V3Zm0 3h4v1H2V6Z"></path>',
  microAudio: '<path fill-rule="evenodd" d="M4 5.05A2.5 2.5 0 1 0 6 7.5L5 2h5V0H3l1 5.05Z"></path>',
  microBook: '<path fill-rule="evenodd" d="M3.493 9.383A1 1 0 0 0 2.5 8.5H2a1 1 0 0 0-1 1 .5.5 0 0 1-1 0v-8A1.5 1.5 0 0 1 1.5 0H3a1.5 1.5 0 0 1 1.5 1.5v8a.5.5 0 0 1-1 0l-.007-.117Zm5.5 0A1 1 0 0 0 8 8.5h-.5a1 1 0 0 0-1 1 .5.5 0 0 1-1 0v-8A1.5 1.5 0 0 1 7 0h1.5A1.5 1.5 0 0 1 10 1.5v8a.5.5 0 0 1-1 0l-.007-.117Z"></path>',
  microBroken: '<path d="M5 0a5 5 0 0 1 5 5v5L7.5 8l-2.499 2L2.5 8 0 10V5a5 5 0 0 1 5-5ZM3 3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"></path>',
  microCacheFailed: '<path fill-rule="evenodd" d="M1.817 4.094 6.415 9H2.5a2.5 2.5 0 0 1-.683-4.906ZM5 1c1.657 0 3 1.567 3 3.5 0 .17-.01.338-.03.502L8 5a2 2 0 0 1 .429 3.954L2.477 2.606C3.01 1.64 3.94 1 5 1Z"></path>',
  microCalendar: '<path d="M4 0v1h2V0h1v1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h2V0h1ZM3 2H1v7h8V2H7v1H6V2H4v1H3V2ZM1 4h8v1H1V4Z"></path>',
  microCloud: '<path fill-rule="evenodd" d="M8.125 4.125v.625C9.159 4.75 10 5.591 10 6.625A1.877 1.877 0 0 1 8.125 8.5H2.5A2.503 2.503 0 0 1 0 6a2.5 2.5 0 0 1 1.931-2.429A3.124 3.124 0 0 1 5 1a3.129 3.129 0 0 1 3.125 3.125Z"></path>',
  microColapse: '<path fill-rule="evenodd" d="M1.938 8H.5L5 3l4.5 5H8.062L5 4.5 1.937 8Z"></path>',
  microComment: '<path d="M8 0a2 2 0 0 1 2 2v8L6 8H2a2 2 0 0 1-2-2V2C0 .9.9 0 2 0h6ZM2 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"></path>',
  microDocument: '<path d="M6 0v4h4v5a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1h5Zm2 6H2v1h6V6ZM4 3H2v1h2V3Zm3-3 3 3H7V0Z"></path>',
  microDownload: '<path d="M4.5 0a.5.5 0 0 1 .5.5v7.792l3.146-3.146.07-.057a.5.5 0 0 1 .695.695l-.057.07-4 4-.042.037-.062.042-.094.042-.067.017L4.5 10l-.053-.003-.074-.013-.081-.03-.076-.043-.057-.046L.146 5.854a.5.5 0 0 1 .638-.765l.07.057L4 8.293V.5a.5.5 0 0 1 .5-.5Z"></path>',
  microDuplicate: '<path d="M6 0a1 1 0 0 1 1 1v2H4a1 1 0 0 0-.993.883L3 4v3H1a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1h5Zm1 4v2a1 1 0 0 1-1 1H4V4h3Z"></path><path d="M9 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7h1v2h5V4H7V3h2Z"></path>',
  microEdit: '<path fill-rule="evenodd" d="M6 1H2.062C1.476 1 1 1.476 1 2.062v5.876C1 8.524 1.476 9 2.062 9h5.876C8.524 9 9 8.524 9 7.938V4h-.882v4.056H2.017V2.019H6V1Zm3.64.067L10 .711 9.281 0l-.36.356-4.688 4.577-.36.356.72.711.359-.356L9.64 1.067Z"></path>',
  microImage: '<path fill-rule="evenodd" d="M4 6 3 4 1 8h8L6 2 4 6ZM0 2C0 .895.887 0 2 0h6c1.105 0 2 .887 2 2v6c0 1.105-.887 2-2 2H2c-1.105 0-2-.887-2-2V2Z"></path>',
  microImportant: '<path fill-rule="evenodd" d="m5.55 3.092.028-.031a2.42 2.42 0 0 0 .14-.168c.035-.048.035-.048.077-.121.09-.176.123-.33-.03-.55l-.417.291.377.342c.456-.504.917-.838 1.184-.838a2.07 2.07 0 0 1 2.074 2.074c0 1.073-.683 2.215-2.013 3.294-.66.552-1.46 1.063-2.034 1.34a.191.191 0 0 1 .052-.02.502.502 0 0 1-.039.006L5 9.217l.056-.505a.992.992 0 0 1-.061-.01 11.764 11.764 0 0 1-1.961-1.308C1.702 6.308 1.017 5.16 1.017 4.09a2.07 2.07 0 0 1 2.074-2.074c.42 0 .773.24 1.189.78l.402-.31-.396-.319c-.219.272-.158.448 0 .69.04.06.087.119.153.196l.023.026.117.136.346.51.435-.436c.048-.048.118-.12.19-.198ZM5 2.93l.421-.285c-.04-.06.057.055-.19-.231l-.02-.023a1.236 1.236 0 0 1-.075-.093c.1.15.138.263-.057.506l.25-.311-.244-.317C4.496 1.412 3.89 1 3.091 1A3.088 3.088 0 0 0 0 4.091C0 5.507.843 6.92 2.388 8.18c.712.59 1.574 1.142 2.23 1.466.144.048.144.048.193.058.05.01.098.016.133.02h.107c.037-.004.084-.01.136-.02a.74.74 0 0 0 .198-.065c.642-.31 1.512-.866 2.232-1.468C9.157 6.92 10 5.512 10 4.09A3.088 3.088 0 0 0 6.909 1c-.658 0-1.293.46-1.938 1.172l-.271.3.23.331c-.103-.259-.103-.259-.078-.386.022-.078.022-.078.038-.108l.013-.024c-.014.02-.043.053-.08.095l-.023.024c-.06.066-.12.129-.16.168L5 2.93Z"></path>',
  microImportantActive: '<path fill-rule="evenodd" d="M4.647 2.09c-.05.06-.089.111-.116.148l.23.004c.082.112.161.226.239.342 0 0 .101-.138.269-.331l.213.004a13.466 13.466 0 0 0-.095-.139C5.811 1.651 6.512 1 7.125 1A2.871 2.871 0 0 1 10 3.875c0 1.394-.856 2.813-2.45 4.106-.875.732-1.831 1.3-2.375 1.563-.05.025-.175.037-.175.037s-.113-.012-.175-.031c-.544-.269-1.5-.837-2.375-1.562C.856 6.688 0 5.262 0 3.875A2.871 2.871 0 0 1 2.875 1c.763 0 1.305 .484 1.772 1.09Z"></path>',
  microLink: '<g fill-rule="evenodd"><path d="M3 7c-1.108 0-2-.89-2-2 0-1.102.902-2 2.01-2h.98C5.101 3 6 3.895 6 5v.966h1V5c0-1.658-1.348-3-3.01-3h-.98A3.008 3.008 0 0 0 0 5c0 1.663 1.34 3 3 3V7Z"></path><path d="M7 3c1.108 0 2 .89 2 2 0 1.102-.902 2-2.01 2h-.98A2.004 2.004 0 0 1 4 5V3.95H3V5c0 1.658 1.348 3 3.01 3h.98A3.008 3.008 0 0 0 10 5c0-1.663-1.34-3-3-3v1Z"></path></g>',
  microList: '<path fill-rule="evenodd" d="M0 2h10v1H0V2Zm0 3h10v1H0V5Zm0 3h10v1H0V8Z"></path>',
  microNext: '<path fill-rule="evenodd" d="M2.5 1.438V0l5 4.5-5 4.5V7.562L6 4.5z"></path>',
  microProgress: '<path fill-rule="evenodd" d="M1.464 8.536A5.002 5.002 0 0 0 9.9 6H8.874a4.002 4.002 0 0 1-6.702 1.828L4 6H0v4l1.464-1.464ZM.1 4a5.002 5.002 0 0 1 8.436-2.536L10 0l-.007 4H6l1.828-1.828A4.002 4.002 0 0 0 1.126 4H.1Z"></path>',
  microPublic: '<path d="M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0ZM1.009 4.734a3.998 3.998 0 0 0 3.94 4.264c.01-.265-.173-.398-.549-.398-.732 0-1.16-.586-1.284-1.758Zm5.71-3.346-.02.052A1 1 0 0 1 5.8 2H4.4v.926l-.007.117a1 1 0 0 1-.993.883h-.8V5h3.2l.117.007A1 1 0 0 1 6.8 6v1.4l.205.009c.415.026.749.103 1 .23A4 4 0 0 0 6.72 1.388Z"></path>',
  microReminder: '<g fill-rule="evenodd"><path fill-rule="nonzero" d="M1 8V4a4 4 0 1 1 8 0v4H7a2 2 0 1 1-4 0H1Zm5 0H4l.007.117A1 1 0 0 0 6 8ZM5 1a3 3 0 0 0-3 3v3h6V4a3 3 0 0 0-2.824-2.995L5 1Z"></path><path d="M0 7h10v1H0z"></path></g>',
  microScreenshot: '<path fill-rule="evenodd" d="M0 .995C0 .445.456 0 .995 0h8.01c.55 0 .995.456.995.995v8.01c0 .55-.456.995-.995.995H.995C.445 10 0 9.544 0 9.005V.995ZM1 1h1v1H1V1Zm2 0h1v1H3V1Zm2 0h1v1H5V1ZM1 3h8v6H1V3Z"></path>',
  microSearch: '<path d="M4 0a4 4 0 0 1 3.16 6.453l2.694 2.693a.5.5 0 0 1-.638.765l-.07-.057L6.453 7.16A4 4 0 1 1 4 0Zm0 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"></path>',
  microTag: '<path fill-rule="evenodd" d="M6.21 7H3.22l-.225 1.57a.5.5 0 0 1-.99-.14L2.209 7H.51A.51.51 0 0 1 0 6.5c0-.276.222-.5.51-.5h1.842l.286-2H1.51A.51.51 0 0 1 1 3.5c0-.276.222-.5.51-.5h1.27l.225-1.57a.5.5 0 0 1 .99.14L3.791 3h2.99l.224-1.57a.5.5 0 0 1 .99.14L7.791 3h1.7a.51.51 0 0 1 .509.5c0 .276-.222.5-.51.5H7.648l-.286 2H8.49a.51.51 0 0 1 .51.5c0 .276-.222.5-.51.5H7.22l-.225 1.57a.5.5 0 0 1-.99-.14L6.209 7Zm.142-1h-2.99l.286-2h2.99l-.286 2Z"></path>',
  microUser: '<path d="M1 6h8v2L8 9H2L1 8z" opacity=".1"></path><path d="M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0Zm0 6a3.744 3.744 0 0 0-3 1.5C2.684 8.41 3.773 9 5 9a3.744 3.744 0 0 0 3-1.5A3.744 3.744 0 0 0 5 6Zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"></path>',
  microVideo: '<path fill-rule="evenodd" d="M0 5c0-2.761 2.244-5 5-5 2.761 0 5 2.244 5 5 0 2.761-2.244 5-5 5-2.761 0-5-2.244-5-5Zm8 0L3 8V2l5 3Z"></path>',
  back: '<path fill-rule="evenodd" d="M4.115 10 11 15.594V17L2 9.5 11 2v1.406L4.115 9H17v1H4.115Z"></path>',
  more: '<path fill-rule="evenodd" d="M4 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"></path>',
  click: '<path fill-rule="evenodd" d="M9.5 2a.5.5 0 0 1 .5.5v5.792l4.096-4.095a.5.5 0 0 1 .707.707l-4.096 4.095L16.5 9a.5.5 0 1 1 0 1l-5.794-.001 4.097 4.097a.5.5 0 0 1-.707.707L10 10.707V16.5a.5.5 0 1 1-1 0v-5.794l-4.096 4.097a.5.5 0 0 1-.707-.707L8.292 10H2.5a.5.5 0 0 1 0-1h5.793L4.197 4.904a.5.5 0 0 1 .707-.707L9 8.293V2.5a.5.5 0 0 1 .5-.5Z"></path>',
  open: '<path fill-rule="evenodd" d="M17.993 7V2.5c0-.277-.222-.5-.5-.5h-4.5c-.277 0-.5.222-.5.5s.223.5.5.5h3.246l-8.392 8.392a.5.5 0 1 0 .707.707l8.44-8.44V7a.5.5 0 1 0 1 0ZM14 16l-9.033.017a.984.984 0 0 1-.983-.984L4 6c0-.543.457-1 1-1h4.5V4H5C3.913 4 3 5.11 3 6.197v8.836C3 16.119 3.881 17 4.967 17h8.836C14.889 17 16 16.086 16 15v-4.5h-1V15c0 .543-.457 1-1 1Z"></path>',
  moveTo: '<path d="M1 8h11v2l3 3h1v3H1z" opacity=".12"></path><path d="M1 15h15v1H1z" opacity=".12"></path><path d="m6 3 2 2h7v1H7.5l-2-2H1v3h11v1H1v8h15v-3h1v2.998C17 16.55 16.545 17 16 17H1c-.552 0-1-.45-1-1.007V4.007C0 3.45.451 3 .99 3H6Zm11 0v6.929L18.688 8H20l-3.5 4L13 8h1.313L16 9.929V3h1Z"></path>',
  close: '<path fill-rule="evenodd" d="m10.95 10.25 6.4 6.4c.2.2.2.52 0 .7-.2.2-.5.2-.7 0l-6.4-6.4-6.4 6.4c-.2.2-.52.2-.7 0-.2-.18-.2-.5 0-.7l6.4-6.4-6.4-6.4c-.2-.2-.2-.5 0-.7.18-.2.5-.2.7 0l6.4 6.4 6.4-6.4c.2-.2.5-.2.7 0 .2.2.2.5 0 .7l-6.4 6.4Z"></path>',
  show: '<path d="M10 4c4.09 0 7.585 2.545 9 6.136-1.415 3.592-4.91 6.137-9 6.137s-7.585-2.545-9-6.137C2.415 6.545 5.91 4 10 4Zm0 1a8.673 8.673 0 0 0-7.843 4.979l-.072.157.072.158a8.674 8.674 0 0 0 7.553 4.974l.29.005a8.673 8.673 0 0 0 7.843-4.979l.071-.158-.071-.157a8.674 8.674 0 0 0-7.553-4.974L10 5Zm0 1.682a3.451 3.451 0 0 1 3.455 3.454A3.451 3.451 0 0 1 10 13.591a3.451 3.451 0 0 1-3.455-3.455A3.451 3.451 0 0 1 10 6.682Zm0 1a2.451 2.451 0 0 0-2.455 2.454A2.451 2.451 0 0 0 10 12.591a2.451 2.451 0 0 0 2.455-2.455A2.451 2.451 0 0 0 10 7.682Z"></path><path d="M10 4c4.09 0 7.585 2.545 9 6.136-1.415 3.592-4.91 6.137-9 6.137s-7.585-2.545-9-6.137C2.415 6.545 5.91 4 10 4Zm0 3.682a2.451 2.451 0 0 0-2.455 2.454A2.451 2.451 0 0 0 10 12.591a2.451 2.451 0 0 0 2.455-2.455A2.451 2.451 0 0 0 10 7.682Z" opacity=".1"></path>',
  web: '<g fill-rule="evenodd"><path d="M13 8h4v8h-4z" opacity=".15"></path><path d="M2 4.007C2 3.45 2.445 3 3 3h14c.552 0 1 .45 1 1.007v11.986C18 16.55 17.555 17 17 17H3c-.552 0-1-.45-1-1.007V4.007ZM3 4h14v12H3V4Zm0 3h14v1H3V7Zm9 1h1v8h-1V8ZM4 5h1v1H4V5Zm2 0h1v1H6V5Zm2 0h1v1H8V5Z"></path></g>',
  refresh: '<path fill-rule="evenodd" d="M14.94 5.041A7 7 0 1 0 17 10h-1a6 6 0 1 1-1.766-4.251L11.987 8h4.991V3l-2.037 2.041Z"></path>',
  upload: '<g fill-rule="evenodd"><path d="M4 2h9.586L17 5.414V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm0 1v14h12V6h-3a1 1 0 0 1-1-1V3H4Z"></path><path d="M10.5 14V8.707l1.646 1.647.708-.708L10 6.793l-2.854 2.853.708.708L9.5 8.707V14h1Z"></path></g>',
  themeSystem: '<g fill-rule="evenodd"><path d="M3 3h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5v1h3v1H5v-1h3v-1H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H3Z"></path><path d="M3 5h14v7H3V5Z" opacity=".12"></path></g>',
  themeLight: '<path fill-rule="evenodd" d="M10 1h1v3h-1V1Zm0 15h1v3h-1v-3ZM1 10h3v1H1v-1Zm15 0h3v1h-3v-1ZM3.64 2.93l2.12 2.12-.7.71-2.13-2.12.71-.71Zm10.6 10.61 2.12 2.12-.7.71-2.13-2.12.71-.71ZM3.64 16.36l-.71-.7 2.13-2.13.7.71-2.12 2.12Zm10.6-10.6-.71-.71 2.13-2.12.7.7-2.12 2.13ZM10.5 6a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"></path>',
  themeDark: '<path fill-rule="evenodd" d="M13.5 2.1a7.8 7.8 0 1 0 4.4 14.2A8 8 0 0 1 13.5 2.1Zm0 1.1a6.7 6.7 0 1 0 3.1 12.6A7.1 7.1 0 0 1 13.5 3.2Z"></path>',
  duplicates: '<g fill-rule="evenodd"><path d="M6 14h13v4a1 1 0 0 1-.999 1H7a.997.997 0 0 1-1-1v-4Zm7-8h5.01c.546 0 .99.453.99.997V14h-6V6Z" opacity=".12"></path><path d="M6 18h1v1h-.5a.505.505 0 0 1-.5-.5V18Zm0-2h1v1H6v-1Zm0-2h1v1H6v-1Zm2 4h1v1H8v-1Zm2 0h1v1h-1v-1Zm2 0h1v1h-1v-1Zm2 0h1v1h-1v-1Zm2 0h1v1h-1v-1Zm2 0h1v.5c0 .276-.232.5-.5.5H18v-1Zm0-2h1v1h-1v-1Zm0-2h1v1h-1v-1Zm0-2h1v1h-1v-1Zm0-2h1v1h-1V8Zm0-2h.5c.276 0 .5.232.5.5V7h-1V6Zm-2 0h1v1h-1V6Zm-2 0h1v1h-1V6Zm-2 0h1v1h-1V6ZM1 1.999C1 1.447 1.447 1 1.999 1H13c.552 0 .999.447.999.999V13a.999.999 0 0 1-.999.999H2a1 1 0 0 1-1-.998V2ZM2 2h11v11H2V2Z"></path></g>',
  ai: '<g fill-rule="evenodd"><path fill-rule="nonzero" d="M8.392 4.218c.402 0 .76.25.9.627l1.527 4.152c.032.087.1.155.186.187l4.153 1.527a.959.959 0 0 1 0 1.799l-4.153 1.527a.314.314 0 0 0-.186.186l-1.527 4.153a.959.959 0 0 1-1.8 0l-1.527-4.153a.314.314 0 0 0-.186-.186L1.626 12.51a.959.959 0 0 1 0-1.8L5.78 9.185a.314.314 0 0 0 .186-.187l1.528-4.152a.959.959 0 0 1 .9-.627Zm0 1.078L6.904 9.342a1.314 1.314 0 0 1-.78.78L2.077 11.61l4.047 1.488c.317.117.574.35.723.648l.057.132 1.488 4.047 1.488-4.047c.117-.316.35-.574.648-.723l.132-.057 4.046-1.488-4.046-1.488a1.314 1.314 0 0 1-.723-.648l-.057-.132-1.488-4.046ZM17.5 6a.5.5 0 0 1 .5.5V7h.5a.5.5 0 1 1 0 1H18v.5a.5.5 0 1 1-1 0V8h-.5a.5.5 0 1 1 0-1h.5v-.5a.5.5 0 0 1 .5-.5Zm-4-5a.5.5 0 0 1 .5.5V3h1.5a.5.5 0 0 1 0 1H14v1.5a.5.5 0 1 1-1 0V4h-1.5a.5.5 0 0 1 0-1H13V1.5a.5.5 0 0 1 .5-.5Z"></path><path d="M8.392 5.296 6.904 9.342a1.314 1.314 0 0 1-.78.78L2.077 11.61l4.047 1.488c.317.117.574.35.723.648l.057.132 1.488 4.047 1.488-4.047c.117-.316.35-.574.648-.723l.132-.057 4.046-1.488-4.046-1.488a1.314 1.314 0 0 1-.723-.648l-.057-.132-1.488-4.046Z" opacity=".1"></path></g>',
  likeActive: '<path fill-rule="evenodd" d="M9.583 5.718s.584-.686.665-.798C10.975 4.118 12.178 3 13.23 3a4.93 4.93 0 0 1 4.935 4.935c0 2.392-1.47 4.828-4.205 7.049-1.502 1.255-3.144 2.231-4.077 2.682-.086.043-.3.064-.3.064s-.193-.021-.3-.054c-.934-.461-2.576-1.437-4.077-2.682C2.47 12.763 1 10.317 1 7.935A4.93 4.93 0 0 1 5.935 3c1.309 0 2.24.83 3.041 1.87.07.126.607.848.607.848Z"></path>',
  importantActive: '<path fill-rule="evenodd" d="M4.647 2.09c-.05.06-.089.111-.116.148l.23.004c.082.112.161.226.239.342 0 0 .101-.138.269-.331l.213.004a13.466 13.466 0 0 0-.095-.139C5.811 1.651 6.512 1 7.125 1A2.871 2.871 0 0 1 10 3.875c0 1.394-.856 2.813-2.45 4.106-.875.732-1.831 1.3-2.375 1.563-.05.025-.175.037-.175.037s-.113-.012-.175-.031c-.544-.269-1.5-.837-2.375-1.562C.856 6.688 0 5.262 0 3.875A2.871 2.871 0 0 1 2.875 1c.763 0 1.305.484 1.772 1.09Z"></path>',
  trash: '<g fill-rule="evenodd"><path d="M5 6h10v11H5z" opacity=".09"></path><path d="M5 5h10v1H5z" opacity=".08"></path><path d="M5 16h10v1H5z" opacity=".15"></path><path d="M6 17c-.6 0-1-.48-1-1.2V5h10v10.8c0 .72-.4 1.2-1 1.2H6ZM8.5 3h3c.3 0 .5.2.5.5V4H8v-.5c0-.3.2-.5.5-.5ZM13 3c0-.6-.4-1-1-1H8c-.6 0-1 .4-1 1v1H4c-.6 0-1 1-1 1h1v11c0 1 1 2 2 2h8c1 0 2-1 2-2V5h1c0-.6-.4-1-1-1h-3V3Z"></path><path d="M8 8h1v6H8zm3 0h1v6h-1z"></path></g>',
  sortCreated: '<g fill-rule="evenodd"><path d="M9.5 17a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" opacity=".1"></path><path d="M9.5 16a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm0 1a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"></path><path d="M9 5.5v4a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-1 0Z"></path><path d="m9.146 9.854 2.536 2.535a.5.5 0 1 0 .707-.707L9.854 9.146a.5.5 0 1 0-.708.708Z"></path></g>',
  sortTitle: '<g fill-rule="evenodd"><path d="M3.75 11 3 13h6l-.75-2h-4.5Zm.375-1L6 5l1.875 5h-3.75ZM2 13 6 3l4 10H2Z"></path><path d="m10.232 16 5.334-8H10V7h7v.493a.5.5 0 0 1 0 .015V8h-.232l-5.334 8H17v1h-6.493a.5.5 0 0 1-.015 0H10v-.493a.5.5 0 0 1 0-.015V16h.232Z"></path></g>',
  sortTitleDesc: '<path d="m13 7 4 10H9l4-10zm2.25 8h-4.5L10 17h6l-.75-2zM13 9l-1.875 5h3.75L13 9zM2.232 12l5.334-8H2V3h7v.508L8.768 4l-5.334 8H9v1H2v-.508L2.232 12Z"></path>',
  sortDomain: '<g fill-rule="evenodd"><path d="M3 4h14v3H3z" opacity=".2"></path><path d="M2 4.007C2 3.45 2.445 3 3 3h14c.552 0 1 .45 1 1.007v11.986C18 16.55 17.555 17 17 17H3c-.552 0-1-.45-1-1.007V4.007ZM3 4h14v12H3V4Zm0 3h14v1H3V7Zm1-2h1v1H4V5Zm2 0h1v1H6V5Zm2 0h1v1H8V5Z"></path></g>',
  sortDomainDesc: '<g fill-rule="evenodd"><path d="M3 4h14v3H3z" opacity=".2"></path><path d="M2 4.007C2 3.45 2.445 3 3 3h14c.552 0 1 .45 1 1.007v11.986C18 16.55 17.555 17 17 17H3c-.552 0-1-.45-1-1.007V4.007ZM3 4h14v12H3V4Zm0 3h14v1H3V7Zm1-2h1v1H4V5Zm2 0h1v1H6V5Zm2 0h1v1H8V5Z"></path></g>',
  viewList: '<g fill-rule="evenodd"><g transform="translate(2 3)"><rect width="6" height="6" opacity=".12" rx="1"></rect><path d="M0 .99C0 .445.451 0 .99 0h4.02c.546 0 .99.451.99.99v4.02c0 .546-.451.99-.99.99H.99A.996.996 0 0 1 0 5.01V.99ZM1 1h4v4H1V1Zm7 0h8v1H8zm0 3h5v1H8z"></path></g><g transform="translate(2 11)"><rect width="6" height="6" opacity=".12" rx="1"></rect><path d="M0 .99C0 .445.451 0 .99 0h4.02c.546 0 .99.451.99.99v4.02c0 .546-.451.99-.99.99H.99A.996.996 0 0 1 0 5.01V.99ZM1 1h4v4H1V1Zm7 0h8v1H8zm0 3h5v1H8z"></path></g></g>',
  viewGrid: '<g fill-rule="evenodd" transform="translate(2 3)"><rect width="7" height="7" opacity=".12" rx="1"></rect><rect width="7" height="7" x="8" opacity=".12" rx="1"></rect><rect width="7" height="7" y="8" opacity=".12" rx="1"></rect><rect width="7" height="7" x="8" y="8" opacity=".12" rx="1"></rect><path d="M0 1.003A.996.996 0 0 1 1.003 0h4.994A.996.996 0 0 1 7 1.003v4.994A.996.996 0 0 1 5.997 7H1.003A.996.996 0 0 1 0 5.997V1.003ZM1 1h5v5H1V1Zm7 .003A.996.996 0 0 1 9.003 0h4.994A.996.996 0 0 1 15 1.003v4.994A.996.996 0 0 1 13.997 7H9.003A.996.996 0 0 1 8 5.997V1.003ZM9 1h5v5H9V1ZM0 9.003A.996.996 0 0 1 1.003 8h4.994A.996.996 0 0 1 7 9.003v4.994A.996.996 0 0 1 5.997 15H1.003A.996.996 0 0 1 0 13.997V9.003ZM1 9h5v5H1V9Zm7 .003A.996.996 0 0 1 9.003 8h4.994A.996.996 0 0 1 15 9.003v4.994A.996.996 0 0 1 13.997 15H9.003A.996.996 0 0 1 8 13.997V9.003ZM9 9h5v5H9V9Z"></path></g>',
  viewSimple: '<g fill-rule="evenodd"><path d="M2 5h16v1H2z"></path><path d="M2 8h16v1H2z" opacity=".9"></path><path d="M2 11h16v1H2z" opacity=".8"></path><path d="M2 14h16v1H2z" opacity=".7"></path></g>',
  viewMasonry: '<g fill-rule="evenodd"><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 2 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006Z" opacity=".09"></path><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 2 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006ZM3 4h5v7H3V4Zm8 7h5v6h-5v-6Zm0-7h5v4h-5V4ZM3 14h5v3H3v-3Z"></path></g>',
  download: '<path d="M12.172 1a2 2 0 0 1 1.414.586l3.828 3.828A2 2 0 0 1 18 6.828V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h8.172Zm0 1H4a1 1 0 0 0-.993.883L3 3v14a1 1 0 0 0 .883.993L4 18h12a1 1 0 0 0 .993-.883L17 17V6.828a1 1 0 0 0-.206-.608l-.087-.099-3.828-3.828a2.002 2.002 0 0 0-.576-.284L12.172 2ZM10 6v6.929L11.687 11H13l-3.5 4L6 11h1.312L9 12.929V6h1Z"></path>',
};

treeIcons.selectionClose = treeIcons.close;
treeIcons.check = '<path fill-rule="evenodd" d="m8.126 13.168.686-.058-3-3-.624.78 3 3 .37.297.316-.355 7-8-.748-.664z"></path>';
treeIcons.blank = '';
treeIcons.microExpand = '<path d="M1.938 3 5 6.5 8.063 3H9.5L5 8 .5 3z"></path>';
treeIcons.tag = treeIcons.searchTag;
treeIcons.cloud = treeIcons.all;
treeIcons.cloudActive = '<path d="M14.95 3.973a6.597 6.597 0 0 1 2.042 4.44 5 5 0 0 1-1.775 9.582L15 18H5a5 5 0 0 1-1.99-9.588 6.59 6.59 0 0 1 2.04-4.439c2.734-2.63 7.166-2.63 9.9 0Z"></path>';
treeIcons.inboxActive = '<path d="M17 2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14Zm0 1H3a1 1 0 0 0-.993.883L2 4v5h4.5a.5.5 0 0 1 .5.5c0 1.742 1.632 2.5 3 2.5s3-.758 3-2.5a.5.5 0 0 1 .41-.492L13.5 9H18V4a1 1 0 0 0-.883-.993L17 3Z"></path>';
treeIcons.defaultCollection = treeIcons.folder;
treeIcons.defaultCollectionActive = '<g fill-rule="evenodd" transform="translate(-77 -86)"><path d="M78 92h18v1H78z"></path><rect width="18" height="12" x="78" y="92" opacity=".9" rx="1"></rect><path d="M78 89a1 1 0 0 1 .99-1H84l2 2h-8v-1Zm0 1h17.007c.548 0 .993.444.993 1v1H78v-2Z" opacity=".6"></path></g>';
treeIcons.trashActive = '<g fill-rule="evenodd"><path d="M13 3v1H7V3h6Zm0 0c0-.6-.4-1-1-1H8c-.6 0-1 .4-1 1v1H4c-.6 0-1 1-1 1h1v11c0 1 1 2 2 2h8c1 0 2-1 2-2V5h1c0-.6-.4-1-1-1h-3V3ZM8 8h1v6H8V8Zm3 0h1v6h-1V8Z" opacity=".9"></path><path d="M3 4h14v1H3z"></path></g>';
treeIcons.moreHorizontal = treeIcons.more;
treeIcons.duplicates = treeIcons.duplicates.replace("v-1Zm0-2h1v1h-1V8", "v-1Zm0-2h1v1h-1v-1Zm0-2h1v1h-1V8").replace("Zm-2 0h1v1h-1V6Zm-2 0h1v1h-1V6Zm-2 0h1v1h-1V6ZM1", "Zm-2 0h1v1h-1V6Zm-2 0h1v1h-1V6ZM1").replace("H2a1 1 0 0 1-1", "H2a.999.999 0 0 1-1");
treeIcons.ai = treeIcons.ai.replace("a.5.5 0 0 1 0 1H14", "a.5.5 0 1 1 0 1H14").replace("a.5.5 0 0 1 0-1H13", "a.5.5 0 1 1 0-1H13");
treeIcons.trash = treeIcons.trash.replace("H4c-.6 0-1 1-1 1h1", "H4c-.6 0-1 .4-1 1h1");

function treeIcon(name, compact = false) {
  const small = compact || name === "microArrow" || name === "microExpand";
  return `<svg class="tree-svg ${small ? "tree-svg-small" : ""}" viewBox="0 0 ${small ? "10 10" : "20 20"}" aria-hidden="true">${treeIcons[name]}</svg>`;
}

function microIcon(name) {
  return `<svg class="search-micro-icon" viewBox="0 0 10 10" aria-hidden="true">${treeIcons[name]}</svg>`;
}

let collectionIconCatalog = COLLECTION_ICON_DEFAULT_CATALOG;

const COLLECTION_ICON_DATA_URL = /^data:image\/(?:jpeg|png|gif|webp|avif);base64,[a-z\d+/]+={0,2}$/i;

function isCollectionIconImage(value) {
  return Boolean(httpUrl(value) || COLLECTION_ICON_DATA_URL.test(String(value || "").trim()));
}

function collectionIconValue(id) {
  const item = state.collections.find((entry) => entry.id === id);
  return String(item?.icon || state.preferences?.collectionIconByCollectionId?.[id] || "").trim();
}

function collectionIconMarkup(value, active = false, unsorted = false) {
  const icon = String(value || "").trim();
  const fallback = treeIcon(unsorted ? (active ? "inboxActive" : "inbox") : (active ? "defaultCollectionActive" : "defaultCollection"));
  if (!icon) return fallback;
  if (!isCollectionIconImage(icon)) return `<span class="collection-emoji">${escapeHtml(icon)}</span>`;
  return `<span class="collection-image-icon"><img data-collection-icon-image src="${escapeHtml(icon)}" alt="" loading="lazy"><span class="collection-image-fallback">${fallback}</span></span>`;
}

const MICRO_TYPE_ICONS = Object.freeze({ article: "microArticle", audio: "microAudio", document: "microDocument", image: "microImage", video: "microVideo" });

function bookmarkTypeIcon(type) {
  return MICRO_TYPE_ICONS[type] ? microIcon(MICRO_TYPE_ICONS[type]) : "";
}

const THEME_OPTIONS = [
  { value: "auto", label: "跟随系统", icon: "themeSystem" },
  { value: "light", label: "浅色", icon: "themeLight" },
  { value: "dark", label: "深色", icon: "themeDark" },
  { value: "sunset", label: "日落", icon: "themeLight" },
];

function themeOption(value = state.preferences?.theme) {
  return THEME_OPTIONS.find((option) => option.value === value) || THEME_OPTIONS[0];
}

function applyTheme() {
  const theme = themeOption().value;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : theme === "auto" ? "light dark" : "light";
  document.documentElement.dataset.fontSize = state.preferences?.largeFont ? "large" : "default";
}

const DEFAULT_GROUP = { id: "default", title: "收藏", hidden: false };

function collectionGroups() {
  const groups = Array.isArray(state.preferences?.collectionGroups) ? state.preferences.collectionGroups : [];
  return groups.length ? groups : [DEFAULT_GROUP];
}

function collectionGroupMap() {
  return state.preferences?.collectionGroupByCollectionId || {};
}

function sidebarSectionCollapsed(id) {
  return Array.isArray(state.preferences?.collapsedSidebarSections) && state.preferences.collapsedSidebarSections.includes(id);
}

function collectionGroupId(item) {
  let rootItem = item;
  while (rootItem?.parentId) rootItem = state.collections.find((entry) => entry.id === rootItem.parentId);
  return collectionGroupMap()[rootItem?.id] || "default";
}

function inlineCollectionRow(surface, groupId, parentId, depth) {
  const target = state.inlineCollectionCreate;
  if (!target || target.surface !== surface || target.groupId !== groupId || target.parentId !== parentId) return "";
  return `<form class="inline-collection-form ${surface === "picker" ? "picker-inline-collection" : ""}" data-inline-collection-form data-surface="${surface}" data-group-id="${groupId}" data-parent-id="${parentId || ""}" style="--depth:${depth}"><span></span><span class="inline-collection-icon">${treeIcon("add")}</span><input name="name" required maxlength="200" placeholder="新收藏" autocomplete="off" autofocus></form>`;
}

function focusInlineCollection(surface) {
  queueMicrotask(() => (surface === "picker" ? collectionPickerDialog : root).querySelector("[data-inline-collection-form] input")?.focus());
}

function collectionsInGroup(groupId) {
  const roots = state.collections.filter((item) => !item.parentId && item.id !== "unsorted" && collectionGroupId(item) === groupId);
  const ids = new Set(roots.map((item) => item.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const item of state.collections) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
      ids.add(item.id);
      changed = true;
    }
  }
  return state.collections.filter((item) => ids.has(item.id));
}

function sidebarItems() {
  return state.allItems.length ? state.allItems : state.items;
}

function sidebarCount(value, className = "tree-count") {
  const count = Number(value) || 0;
  return count > 0 ? `<small class="${className}">${count}</small>` : "";
}

function collectionTree(groupId, parentId = null, depth = 0) {
  if (groupId === undefined) return groupSections();
  return state.collections.filter((item) => item.parentId === parentId && item.id !== "unsorted" && (parentId !== null || collectionGroupId(item) === groupId)).map((item) => {
    const hasChildren = state.collections.some((child) => child.parentId === item.id);
    const collapsed = state.collapsedCollections.has(item.id);
    const editable = item.id !== "unsorted";
    const count = state.collectionCounts[item.id] || 0;
    const selecting = state.collectionSelection?.groupId === groupId;
    const selected = selecting && state.collectionSelection.ids.has(item.id);
    const control = selecting
      ? `<button class="collection-toggle collection-checkbox ${selected ? "selected" : ""}" data-select-collection="${item.id}" aria-label="${selected ? "取消选择" : "选择"}${escapeHtml(item.name)}">${selected ? "✓" : ""}</button>`
      : `<button class="collection-toggle ${hasChildren ? (collapsed ? "collapsed" : "") : "placeholder"}" ${hasChildren ? `data-toggle-collection="${item.id}" aria-label="${collapsed ? "展开" : "收起"}${escapeHtml(item.name)}" aria-expanded="${!collapsed}"` : "tabindex=\"-1\""}>${treeIcon("arrow")}</button>`;
    const icon = collectionIconValue(item.id);
    const collectionActive = state.collectionId === item.id;
    return `<div class="collection-branch"><div class="collection-row ${collectionActive ? "active" : ""}" style="--depth:${depth}" data-drop-collection="${item.id}" ${editable && !selecting ? `data-drag-collection="${item.id}" draggable="true"` : ""}>${control}<button class="collection-link" ${selecting ? `data-select-collection="${item.id}"` : `data-collection="${item.id}"`}><span class="collection-icon">${collectionIconMarkup(icon, collectionActive)}</span><span class="collection-name">${escapeHtml(item.name)}</span>${sidebarCount(count, "collection-count")}</button>${editable && !selecting ? `<span class="collection-actions"><button data-collection-menu="${item.id}" title="收藏集选项" aria-label="${escapeHtml(item.name)}选项">${treeIcon("moreHorizontal")}</button></span>` : ""}</div>${collectionMenu(item)}${inlineCollectionRow("sidebar", groupId, item.id, depth + 1)}${hasChildren && (!collapsed || selecting) ? collectionTree(groupId, item.id, depth + 1) : ""}</div>`;
  }).join("");
}

function expandableCollectionIds() {
  const parentIds = new Set(state.collections.map((item) => item.parentId).filter(Boolean));
  return state.collections.filter((item) => parentIds.has(item.id)).map((item) => item.id);
}

function collectionMenu(item) {
  if (state.collectionMenuId !== item.id) return "";
  const menuItem = (action, label) => `<button role="menuitem" data-collection-action="${action}" data-collection-id="${item.id}">${label}</button>`;
  return `<div class="sidebar-menu collection-menu" role="menu" data-collection-menu-panel>${menuItem("open", "打开所有书签")}<span class="menu-separator"></span>${menuItem("create-child", "创建嵌套的集合")}<span class="menu-separator"></span>${menuItem("select", "选择")}${menuItem("rename", "改名")}${menuItem("icon", "更改图标")}${menuItem("share", "分享")}${menuItem("delete", "删除")}</div>`;
}

function groupMenu(group) {
  if (state.groupMenuId !== group.id) return "";
  const item = (action, label) => `<button role="menuitem" data-group-action="${action}" data-group-id="${group.id}">${label}</button>`;
  const expandableIds = expandableCollectionIds();
  const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => state.collapsedCollections.has(id));
  return `<div class="sidebar-menu" role="menu" data-group-menu-panel>${item("select", "选择所有")}<span class="menu-separator"></span>${item("create-collection", "创建收藏集")}${item(allCollapsed ? "expand" : "collapse", allCollapsed ? "展开所有收藏集" : "折叠所有收藏集")}${item("sort", "按名称排序所有收藏集")}${item("clean", "删除所有空收藏集")}<span class="menu-separator"></span>${item("create-group", "创建群组")}${item("rename", "改名")}${item(group.hidden ? "show" : "hide", group.hidden ? "显示分组" : "隐藏分组")}${item("delete-group", "删除分组")}</div>`;
}

function groupSections() {
  const collapsed = sidebarSectionCollapsed("collections");
  return collectionGroups().map((group) => {
    const selected = state.collectionSelection?.groupId === group.id ? state.collectionSelection.ids.size : 0;
    const selection = state.collectionSelection?.groupId === group.id
      ? `<div class="collection-selection"><strong>${selected} 个收藏集</strong><button data-selection-action="all">全部</button><button data-selection-action="cancel">取消</button><span></span><button data-selection-action="merge" ${selected < 2 ? "disabled" : ""}>合并</button><button class="danger" data-selection-action="delete" ${selected < 1 ? "disabled" : ""}>删除</button></div>`
      : "";
    return `<section class="sidebar-section collections-section ${collapsed ? "section-collapsed" : ""}" data-group="${group.id}"><div class="sidebar-label"><button class="sidebar-section-toggle" data-sidebar-toggle="collections" aria-expanded="${!collapsed}">${escapeHtml(group.title)}</button>${collapsed ? `<button class="section-show" data-sidebar-toggle="collections">显示</button>` : `<button data-group-menu="${group.id}" title="收藏选项" aria-label="${escapeHtml(group.title)}选项">${treeIcon("moreHorizontal")}</button>`}</div>${collapsed ? "" : `${groupMenu(group)}${selection}${inlineCollectionRow("sidebar", group.id, null, 0)}${group.hidden ? `<button class="show-group" data-group-action="show" data-group-id="${group.id}">显示分组</button>` : collectionTree(group.id)}`}</section>`;
  }).join("");
}

const SEARCH_TYPE_OPTIONS = [["link", "链接"], ["article", "文章"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["document", "文档"]];
const SEARCH_SUGGESTIONS = [
  { id: "favorite", label: "最喜爱的", token: "important:true", icon: "like", className: "favorite" },
  { id: "tags", label: "标签", token: "#", icon: "searchTag", className: "tags" },
  { id: "note", label: "备注", token: "note:true", icon: "note", className: "note" },
  { id: "highlights", label: "高亮", token: "highlights:true", icon: "highlights", className: "highlights" },
  { id: "reminder", label: "提醒", token: "reminder:true", icon: "reminder", className: "reminder" },
  { id: "type", label: "类型", token: "type:", icon: "type", className: "type" },
  { id: "created", label: "创建日期", token: "created:", icon: "calendar", className: "created" },
  { id: "lang", label: "语言", token: "lang:", icon: "public", className: "language" },
  { id: "info", label: "在标题/描述中", token: "info:", icon: "info", className: "info" },
  { id: "url", label: "在URL中", token: "link:", icon: "link", className: "url" },
  { id: "broken", label: "失效链接", token: "broken:true", icon: "broken", className: "broken" },
  { id: "duplicate", label: "重复书签", token: "duplicate:true", icon: "duplicates", className: "duplicate" },
  { id: "untagged", label: "没有标签", token: "notag:true", icon: "tag", className: "untagged" },
];

function queryPath() {
  const params = new URLSearchParams();
  const search = parseSearchQuery(state.query).text;
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (search) params.set("search", search);
  if (search && state.preferences?.searchRelevance !== false) params.set("sort", "score");
  return `/v1/bookmarks?${params}`;
}

function tagQueryPath() {
  const params = new URLSearchParams();
  const search = parseSearchQuery(state.query).text;
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (search) params.set("search", search);
  params.set("tagsSort", state.preferences?.tagSort === "count" ? "-count" : "_id");
  return `/v1/tags?${params}`;
}

function searchSuggestionCount(id) {
  const items = state.allItems.length ? state.allItems : state.items;
  if (id === "favorite") return items.filter((item) => item.favorite).length;
  if (id === "tags") return items.filter((item) => item.tags.length).length;
  if (id === "note") return items.filter((item) => item.note).length;
  if (id === "highlights") return items.filter((item) => item.highlights.length).length;
  if (id === "reminder") return items.filter((item) => item.reminder).length;
  if (id === "type") return new Set(items.map(bookmarkType)).size;
  if (id === "created") return dateFilterSuggestions(items).length;
  if (id === "lang") return languageFilterSuggestions(items).length;
  if (id === "info") return items.filter((item) => item.title || item.description).length;
  if (id === "url") return items.filter((item) => item.link).length;
  if (id === "broken") return items.filter((item) => item.health.status === "broken").length;
  if (id === "duplicate") {
    const duplicates = duplicateLinks(items);
    return items.filter((item) => duplicates.has(item.link)).length;
  }
  if (id === "untagged") return items.filter((item) => !item.tags.length).length;
  return 0;
}

function searchHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function rememberSearch(query) {
  const value = String(query || "").trim();
  if (!value) return;
  state.recentSearches = [{ query: value, usedAt: new Date().toISOString() }, ...state.recentSearches.filter((item) => item.query !== value)].slice(0, 5);
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.recentSearches)); } catch { /* storage can be unavailable in extension previews */ }
}

function searchFilterMarkup() {
  const items = state.allItems.length ? state.allItems : state.items;
  const activeCreated = parseSearchQuery(state.query).filters.find((filter) => filter.kind === "created" && !filter.excluded)?.value || "";
  const languageName = (code) => {
    try { return new Intl.DisplayNames([languageIsEnglish() ? "en" : "zh-CN"], { type: "language" }).of(code) || code.toUpperCase(); } catch { return code.toUpperCase(); }
  };
  const dateName = (value) => {
    const date = new Date(`${value}-01T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(languageIsEnglish() ? "en" : "zh-CN", { year: "numeric", month: "long" }).format(date);
  };
  const row = ({ id, label, token, icon, className = "", count, expandable = false, kind = token.startsWith("#") ? "#" : token.split(":", 1)[0] }) => {
    const attributes = expandable ? `data-search-expand="${id}" data-search-prefix="${escapeHtml(token)}" aria-expanded="${state.searchFilterGroup === id}"` : `data-search-token="${escapeHtml(token)}"`;
    return `<button type="button" class="search-filter-item" role="option" data-token="${escapeHtml(kind)}" data-id="${escapeHtml(id)}" ${attributes}><span class="search-filter-icon ${className}">${treeIcon(icon)}</span><span class="search-filter-title">${label}</span><small class="search-filter-count">${count ?? ""}</small></button>`;
  };
  let suggestions;
  let sectionTitle = t("建议的");
  let sectionClass = "";
  if (state.searchFilterGroup === "type") {
    suggestions = SEARCH_TYPE_OPTIONS.map(([type, label]) => ({ type, label, count: items.filter((item) => bookmarkType(item) === type).length })).filter((item) => item.count).map(({ type, label, count }) => row({ id: type, label: t(label), token: `type:${type}`, icon: type, count, kind: "type" })).join("");
    sectionTitle = t("缩小搜索范围");
  } else if (state.searchFilterGroup === "created") {
    suggestions = dateFilterSuggestions(items, activeCreated).map(({ value, count }) => row({ id: value, label: escapeHtml(dateName(value)), token: `created:${value}`, icon: "calendar", count, kind: "created" })).join("");
    sectionTitle = languageIsEnglish()
      ? "Search for a specific date in YYYY-MM-DD format, a month (YYYY-MM), or a year (YYYY). Prefix it with < or > to search before or after that date."
      : "搜索格式为YYYY-MM-DD的特定日期，或特定的月份(YYYY-MM) 或年份(YYYY)。在日期前面加上<或>，可以分别找到特定日期之前或之后的收藏。";
    sectionClass = " search-filter-date-tip";
  } else if (state.searchFilterGroup === "lang") {
    suggestions = languageFilterSuggestions(items).map(({ value, count }) => row({ id: value, label: escapeHtml(languageIsEnglish() ? `${languageName(value)} language` : `${languageName(value)}语言`), token: `lang:${value}`, icon: "public", count, kind: "lang" })).join("");
    sectionTitle = t("缩小搜索范围");
  } else {
    suggestions = SEARCH_SUGGESTIONS.filter((item) => item.id !== "lang" || searchSuggestionCount("lang")).map((item) => row({ ...item, label: t(item.label), count: searchSuggestionCount(item.id), expandable: ["type", "created", "lang"].includes(item.id) })).join("");
  }
  const recent = state.recentSearches.map((item) => `<button type="button" class="search-filter-item search-recent-item" role="option" data-search-recent="${escapeHtml(item.query)}"><span class="search-filter-icon recent">${treeIcon("search")}</span><span class="search-filter-title">${escapeHtml(item.query)}</span><small class="search-filter-count">${searchHistoryTime(item.usedAt)}</small></button>`).join("");
  return `<div id="search-filter-menu" class="search-filter-menu ${state.searchMenuOpen ? "" : "hidden"}" role="listbox" aria-label="${t("搜索")}"><div class="search-filter-section-title${sectionClass}">${sectionTitle}</div>${suggestions}<div class="search-filter-section-title search-recent-title"><span>${t("最近使用的")}</span><button type="button" class="search-recent-clear" data-search-recent-clear title="${t("删除最近项")}" aria-label="${t("删除最近项")}">${microIcon("microClose")}</button></div>${recent}<div class="search-filter-help"><span>${languageIsEnglish() ? "Prefix a condition with a hyphen (-) to exclude it from search" : "在条件前添加短横(-) 将其排除在搜索范围之外"}</span><a href="https://help.raindrop.io/using-search" target="_blank" rel="noopener" title="${t("搜索帮助")}" aria-label="${t("搜索帮助")}">${treeIcon("help")}</a></div></div>`;
}

function renderSearchMenu() {
  const menu = root.querySelector("#search-filter-menu");
  if (!menu) return;
  root.querySelector("[data-search-filter-toggle]")?.setAttribute("aria-expanded", String(state.searchMenuOpen));
  menu.outerHTML = searchFilterMarkup();
  bindSearchMenu();
}

function closeSearchMenu() {
  if (!state.searchMenuOpen) return;
  state.searchMenuOpen = false;
  state.searchFilterGroup = null;
  const search = root.querySelector("#search");
  if (document.activeElement === search) search.blur();
  renderSearchMenu();
}

function updateLibraryRoute(mode = "replace") {
  const url = new URL(location.href);
  for (const key of ["view", "collection", "search"]) url.searchParams.delete(key);
  if (state.collectionId) url.searchParams.set("collection", state.collectionId);
  else if (state.view !== "all") url.searchParams.set("view", state.view);
  if (state.query) url.searchParams.set("search", state.query);
  history[`${mode}State`]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readLibraryRoute() {
  const params = new URL(location.href).searchParams;
  state.view = params.get("view") || "all";
  state.collectionId = params.get("collection");
  state.query = params.get("search") || "";
  state.tag = "";
}

function commitSearch(value, remember = true, historyMode = "replace") {
  clearTimeout(state.searchTimer);
  state.query = String(value || "").trim();
  state.selected.clear();
  state.cardMenuId = null;
  if (remember) rememberSearch(state.query);
  updateLibraryRoute(historyMode);
  load().catch(showError);
}

function bindSearchMenu() {
  root.querySelectorAll("[data-search-token], [data-search-recent]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    const query = button.dataset.searchToken ?? button.dataset.searchRecent;
    const input = root.querySelector("#search");
    if (input) input.value = query;
    state.searchMenuOpen = false;
    state.searchFilterGroup = null;
    commitSearch(query, true, "push");
  });
  root.querySelectorAll("[data-search-expand]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.searchFilterGroup = button.dataset.searchExpand;
    const query = button.dataset.searchPrefix;
    const input = root.querySelector("#search");
    if (input) input.value = query;
    commitSearch(query, false);
  });
  const clear = root.querySelector("[data-search-recent-clear]");
  if (clear) clear.onclick = (event) => {
    event.stopPropagation();
    state.recentSearches = [];
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* ignore unavailable storage */ }
    renderSearchMenu();
  };
}

function enhanceSearch() {
  const field = root.querySelector(".quick-search");
  if (!field || field.parentElement?.classList.contains("search-shell")) return;
  const shell = document.createElement("div");
  shell.className = "search-shell";
  field.parentElement.insertBefore(shell, field);
  shell.append(field);
  field.querySelector("span").className = "search-leading-icon";
  field.querySelector("span").innerHTML = treeIcon("search");
  field.querySelector("kbd")?.remove();
  const group = document.createElement("div");
  group.className = "search-filter-group";
  group.innerHTML = `<button type="button" class="search-filter-toggle" data-search-filter-toggle title="${t("搜索设置 / 筛选")}" aria-label="${t("搜索设置 / 筛选")}" aria-expanded="${state.searchMenuOpen}">${microIcon("microTune")}${microIcon("microArrow")}</button>`;
  field.append(group);
  shell.insertAdjacentHTML("beforeend", searchFilterMarkup());
}

function renderSortMenu() {
  const trigger = root.querySelector("[data-sort-trigger]");
  const existing = root.querySelector("#sort-menu");
  trigger?.setAttribute("aria-expanded", String(state.sortMenuOpen));
  if (!state.sortMenuOpen) {
    existing?.remove();
    return;
  }
  if (existing) existing.outerHTML = sortMenuMarkup();
  else root.querySelector(".workspace-head")?.insertAdjacentHTML("afterend", sortMenuMarkup());
  bindSortMenu();
  positionSortMenu();
}

function bindSortMenu() {
  root.querySelectorAll("[data-sort-option]").forEach((input) => input.onchange = () => {
    state.preferences = { ...state.preferences, sort: input.dataset.sortOption };
    state.sortMenuOpen = false;
    render();
    savePreferences({ sort: input.dataset.sortOption }).catch(showError);
  });
}

function positionSortMenu() {
  const menu = root.querySelector("#sort-menu");
  const trigger = root.querySelector("[data-sort-trigger]");
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom));
  menu.style.setProperty("--left", `${left}px`);
  menu.style.setProperty("--top", `${top}px`);
}

function positionViewMenu() {
  const menu = root.querySelector("#view-menu");
  const trigger = root.querySelector("[data-view-trigger]");
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom));
  menu.style.setProperty("--left", `${left}px`);
  menu.style.setProperty("--top", `${top}px`);
}

function viewName(items = visibleItems()) {
  if (state.query.trim() || state.tag) return `找到 ${items.length} 个书签`;
  if (state.collectionId) return state.collections.find((item) => item.id === state.collectionId)?.name || "收藏夹";
  return t(({ all: "所有书签", favorites: "星标", broken: "失效链接", unknown: "待检查", trash: "废纸篓" })[state.view]);
}

function workspaceIconMarkup() {
  let icon = state.view === "all" ? "cloudActive" : ({ favorites: "like", trash: "trash", broken: "broken", unknown: "link" }[state.view] || "search");
  let emoji = "";
  if (state.collectionId) {
    const item = state.collections.find((entry) => entry.id === state.collectionId);
    if (state.collectionId === "unsorted") icon = "inboxActive";
    else if (item) {
      emoji = collectionIconValue(item.id);
      if (!emoji) icon = "defaultCollection";
    } else icon = "defaultCollection";
  }
  return `<div class="workspace-cloud icon-vkJU icon-yhAy"><span class="workspace-icon icon-VKRw${emoji ? " collection-emoji" : ""}">${emoji ? collectionIconMarkup(emoji, true, state.collectionId === "unsorted") : treeIcon(icon)}</span></div>`;
}

function workspaceHref() {
  const params = new URLSearchParams();
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (state.query) params.set("search", state.query);
  return `library.html${params.toString() ? `?${params}` : ""}`;
}

const SORT_OPTIONS = [
  { value: "created", label: "按日期 ↑", icon: "sortCreated" },
  { value: "-created", label: "按日期 ↓", icon: "sortCreated" },
  { value: "title", label: "按名称 (A-Z)", icon: "sortTitle" },
  { value: "-title", label: "按名称 (Z-A)", icon: "sortTitleDesc" },
  { value: "domain", label: "网站 (A-Z)", icon: "sortDomain" },
  { value: "-domain", label: "网站 (Z-A)", icon: "sortDomainDesc" },
];

function currentSort() {
  const value = state.preferences?.sort || "manual";
  return value === "host" ? "domain" : value;
}

function sortOption(value = currentSort()) {
  return SORT_OPTIONS.find((option) => option.value === value);
}

function sortMenuMarkup() {
  if (!state.sortMenuOpen) return "";
  const active = currentSort();
  return `<div id="sort-menu" class="sort-popover" role="menu" data-sort-menu><div class="sort-menu-layout" data-type="default"><div class="sort-menu-label">${t("排序")}</div><div>${SORT_OPTIONS.map((option) => `<label class="sort-option" role="menuitemradio" aria-checked="${active === option.value}"><input type="radio" tabindex="0" data-sort-option="${option.value}" readonly ${active === option.value ? "checked" : ""}><span class="sort-option-icon">${treeIcon(option.icon)}</span><span>${t(option.label)}</span></label>`).join("")}</div></div></div>`;
}

const VIEW_OPTIONS = [
  { value: "list", label: "列表", icon: "viewList" },
  { value: "grid", label: "卡片", icon: "viewGrid" },
  { value: "simple", label: "标题", icon: "viewSimple" },
  { value: "masonry", label: "心情看板", icon: "viewMasonry" },
];

function validLayout(value) {
  return VIEW_OPTIONS.some((option) => option.value === value) ? value : null;
}

function viewScopeKey() {
  if (state.collectionId) return `collection:${state.collectionId}`;
  return state.view === "all" ? "all" : `view:${state.view}`;
}

function layoutByScope(preferences = state.preferences) {
  return preferences?.layoutByScope && typeof preferences.layoutByScope === "object" ? preferences.layoutByScope : {};
}

function layoutForScope(preferences = state.preferences) {
  const scoped = validLayout(layoutByScope(preferences)[viewScopeKey()]);
  return scoped || validLayout(preferences?.defaultView) || validLayout(preferences?.layout) || "list";
}

function allLayoutScopes(layout) {
  const next = { ...layoutByScope(), all: layout };
  state.collections.forEach((item) => { next[`collection:${item.id}`] = layout; });
  return next;
}

const DEFAULT_VIEW_FIELDS = { cover: true, title: true, note: true, description: false, highlights: true, tags: true, metadata: true, coverPosition: "left", coverSize: 2 };

function viewSettings() {
  return { ...DEFAULT_VIEW_FIELDS, ...(state.preferences?.viewFields || {}) };
}

function coverSizeValue(settings = viewSettings()) {
  const value = Number(settings.coverSize);
  return Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : DEFAULT_VIEW_FIELDS.coverSize;
}

function masonryGridWidth(settings = viewSettings()) {
  return 194 + coverSizeValue(settings) * 30;
}

function viewOption(value = state.layout) {
  return VIEW_OPTIONS.find((option) => option.value === value) || VIEW_OPTIONS[0];
}

function viewMenuMarkup() {
  if (!state.viewMenuOpen) return "";
  const settings = viewSettings();
  const isCardView = state.layout === "grid";
  const isTitleView = state.layout === "simple";
  const isMasonryView = state.layout === "masonry";
  const option = (item) => `<label class="view-option" role="menuitemradio" aria-checked="${state.layout === item.value}"><input type="radio" tabindex="0" data-view-option="${item.value}" ${state.layout === item.value ? "checked" : ""}><span class="view-option-icon">${treeIcon(item.icon)}</span>${t(item.label)}</label>`;
  const field = (value, label) => `<label class="view-check-option"><input type="checkbox" tabindex="0" data-view-field="${value}" ${settings[value] ? "checked" : ""}>${t(label)}</label>`;
  const coverControl = isCardView || isMasonryView
    ? settings.cover ? `<div class="sort-menu-label view-menu-label" data-is-label="true">${t("封面")}</div><div><label class="view-range-option"><input type="range" tabindex="0" min="1" max="10" value="${coverSizeValue(settings)}" data-view-cover-size aria-label="${t("封面")}"></label></div>` : ""
    : isTitleView ? "" : `<div class="sort-menu-label view-menu-label" data-is-label="true">${t("封面")} ${languageIsEnglish() ? "position" : "位置"}</div><div><label class="view-option"><input type="radio" tabindex="0" name="view-cover-position" data-view-position="left" ${settings.coverPosition === "left" ? "checked" : ""}>${t("左")}</label><label class="view-option"><input type="radio" tabindex="0" name="view-cover-position" data-view-position="right" ${settings.coverPosition === "right" ? "checked" : ""}>${t("右")}</label></div>`;
  const fieldLabel = isTitleView ? "图标" : "封面";
  const displayLabel = isCardView ? "在卡片中显示" : isTitleView ? "在标题中显示" : isMasonryView ? "在心情看板中显示" : "在列表中显示";
  return `<div id="view-menu" class="sort-popover view-popover" role="menu" data-view-menu><div class="sort-menu-layout view-menu-layout" data-type="default"><div class="sort-menu-label view-menu-label" data-is-label="true">${t("视图")}</div><div>${VIEW_OPTIONS.map(option).join("")}</div><button type="button" class="view-apply" role="button" title="${t("应用到全部")}" aria-label="${t("应用到全部")}" data-view-apply>${t("应用到全部")}</button><div class="view-separator" data-variant="default"></div><div class="sort-menu-label view-menu-label" data-is-label="true">${t(displayLabel)}</div><div>${field("cover", fieldLabel)}${field("title", "标题")}${field("note", "备注")}${field("description", "描述")}${field("highlights", "高亮")}${field("tags", "标签")}${field("metadata", "书签信息")}</div>${coverControl}</div></div>`;
}

function renderViewMenu() {
  const trigger = root.querySelector("[data-view-trigger]");
  const existing = root.querySelector("#view-menu");
  trigger?.setAttribute("aria-expanded", String(state.viewMenuOpen));
  if (!state.viewMenuOpen) {
    existing?.remove();
    return;
  }
  if (existing) existing.outerHTML = viewMenuMarkup();
  else root.querySelector(".workspace-head")?.insertAdjacentHTML("afterend", viewMenuMarkup());
  bindViewMenu();
  positionViewMenu();
}

function themeMenuMarkup() {
  if (!state.themeMenuOpen) return "";
  const active = themeOption().value;
  return `<div id="theme-menu" class="theme-menu" role="menu" aria-label="${t("主题")}"><div class="theme-menu-label">${t("主题")}</div>${THEME_OPTIONS.map((option) => `<button type="button" class="theme-option ${active === option.value ? "active" : ""}" role="menuitemradio" aria-checked="${active === option.value}" data-theme-option="${option.value}"><span class="theme-option-icon theme-${option.value}">${treeIcon(option.icon)}</span><span>${t(option.label)}</span><span class="theme-option-check" aria-hidden="true">${active === option.value ? "✓" : ""}</span></button>`).join("")}</div>`;
}

function renderThemeMenu() {
  const trigger = root.querySelector("[data-theme-trigger]");
  const wrap = root.querySelector(".theme-menu-wrap");
  const option = themeOption();
  trigger?.setAttribute("aria-expanded", String(state.themeMenuOpen));
  trigger?.setAttribute("title", `${t("主题：")}${t(option.label)}`);
  trigger?.setAttribute("aria-label", `${t("主题：")}${t(option.label)}`);
  if (trigger) trigger.innerHTML = treeIcon(option.icon);
  if (!wrap) return;
  wrap.querySelector("#theme-menu")?.remove();
  if (state.themeMenuOpen) {
    wrap.insertAdjacentHTML("beforeend", themeMenuMarkup());
    bindThemeMenu();
  }
}

function closeThemeMenu() {
  if (!state.themeMenuOpen) return;
  state.themeMenuOpen = false;
  renderThemeMenu();
}

function bindThemeMenu() {
  root.querySelectorAll("[data-theme-option]").forEach((button) => button.onclick = () => {
    const nextTheme = button.dataset.themeOption;
    const previousTheme = themeOption().value;
    state.themeMenuOpen = false;
    state.preferences = { ...state.preferences, theme: nextTheme };
    applyTheme();
    renderThemeMenu();
    if (nextTheme === previousTheme) return;
    savePreferences({ theme: nextTheme }).catch((error) => {
      state.preferences = { ...state.preferences, theme: previousTheme };
      applyTheme();
      renderThemeMenu();
      showError(error);
    });
  });
}

function bindViewMenu() {
  root.querySelectorAll("[data-view-option]").forEach((input) => input.onchange = () => {
    state.layout = input.dataset.viewOption;
    const scope = viewScopeKey();
    const nextLayoutByScope = { ...layoutByScope(), [scope]: state.layout };
    state.preferences = { ...state.preferences, layoutByScope: nextLayoutByScope };
    state.viewMenuOpen = false;
    render();
    savePreferences({ layoutByScope: nextLayoutByScope }).catch(showError);
  });
  root.querySelectorAll("[data-view-field]").forEach((input) => input.onchange = () => {
    const viewFields = { ...viewSettings(), [input.dataset.viewField]: input.checked };
    state.preferences = { ...state.preferences, viewFields };
    render();
    persistViewPreferences({ viewFields });
  });
  root.querySelectorAll("[data-view-position]").forEach((input) => input.onchange = () => {
    const viewFields = { ...viewSettings(), coverPosition: input.dataset.viewPosition };
    state.preferences = { ...state.preferences, viewFields };
    render();
    persistViewPreferences({ viewFields });
  });
  root.querySelector("[data-view-cover-size]")?.addEventListener("input", (event) => {
    const coverSize = coverSizeValue({ coverSize: event.currentTarget.value });
    const viewFields = { ...viewSettings(), coverSize };
    state.preferences = { ...state.preferences, viewFields };
    root.querySelector(".cards")?.style.setProperty("--card-cover-size", String(coverSize));
    applyMasonryCoverSize();
    persistViewPreferences({ viewFields });
  });
  root.querySelector("[data-view-apply]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const layout = state.layout;
    const nextLayoutByScope = allLayoutScopes(layout);
    state.preferences = { ...state.preferences, layout, defaultView: layout, layoutByScope: nextLayoutByScope };
    state.viewMenuOpen = false;
    renderViewMenu();
    persistViewPreferences({ layout, defaultView: layout, layoutByScope: nextLayoutByScope });
  });
}

function selectionHeaderMarkup(selection) {
  const allSelected = selection.length === sortedItems().length;
  const title = state.collectionId ? viewName() : state.view === "all" ? "全部" : viewName();
  const trashSelection = state.view === "trash";
  const moreMenu = state.selectionMoreOpen ? `<div class="selection-more-menu" role="menu" data-selection-more-menu><button type="button" role="menuitem" data-selection-more-action="screenshot" ${state.selectionScreenshotWorking ? "disabled" : ""}>${treeIcon("web")}<span>${state.selectionScreenshotWorking ? "正在创建页面截图…" : "创建页面截图"}</span></button><button type="button" role="menuitem" data-selection-more-action="refresh">${treeIcon("refresh")}<span>刷新预览</span></button><span class="menu-separator"></span><button type="button" role="menuitem" data-selection-more-action="favorite">${treeIcon("likeActive")}<span>添加到收藏夹</span></button><button type="button" role="menuitem" data-selection-more-action="unfavorite">${treeIcon("like")}<span>从收藏夹移除</span></button><span class="menu-separator"></span><button type="button" role="menuitem" data-selection-more-action="remove-tags">${treeIcon("tagAction")}<span>移除标签</span></button></div>` : "";
  const destructiveAction = trashSelection
    ? `<button class="selection-action" title="恢复" aria-label="恢复" data-batch="restore">${treeIcon("add")}<span>恢复</span></button>`
    : `<button class="selection-action selection-danger" title="删除" aria-label="删除" data-batch="trash">${treeIcon("trash")}<span>删除</span></button>`;
  return `<header class="workspace-head workspace-selection-head" data-is-header="true"><div class="workspace-first-action"><div id="select-all" class="select-all selection-toggle button-dQdc" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="active"><label class="selection-checkbox"><input tabindex="-1" type="checkbox" title="选择所有" ${allSelected ? "checked" : ""}></label></div></div><div class="workspace-name selection-name">${escapeHtml(title)}&nbsp;</div><div class="workspace-space"></div><button type="button" class="selection-action selection-move" title="移动" aria-label="移动" data-selection-move aria-haspopup="dialog">${treeIcon("moveTo")}<span>移动</span></button><button class="selection-action" title="添加标签" aria-label="添加标签" data-batch="tags">${treeIcon("tagAction")}<span>添加标签</span></button>${destructiveAction}<button id="export" class="selection-action" title="更多" aria-label="更多">${treeIcon("download")}<span>导出书签</span></button><button class="selection-action" title="直接在浏览器打开" aria-label="直接在浏览器打开" data-selection-open>${treeIcon("open")}<span>直接在浏览器打开</span></button><div class="selection-more-wrap"><button class="selection-action selection-more" title="更多" aria-label="更多" aria-expanded="${state.selectionMoreOpen}" data-selection-more>${treeIcon("moreHorizontal")}</button>${moreMenu}</div><div class="workspace-space"></div><button class="selection-action selection-cancel" title="取消" aria-label="取消" data-selection-clear>${treeIcon("selectionClose")}<span>取消</span></button></header>`;
}

function workspaceHeaderMarkup(items, selection) {
  if (selection.length) return selectionHeaderMarkup(selection);
  const sort = sortOption();
  const allSelected = Boolean(items.length && selection.length === items.length);
  const view = viewOption();
  const firstAction = selection.length
    ? `<div class="workspace-first-action"><div id="select-all" class="select-all selection-toggle button-dQdc" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="active"><label class="selection-checkbox"><input tabindex="-1" type="checkbox" title="选择所有" ${allSelected ? "checked" : ""}></label></div></div><span class="selection-count" aria-live="polite">${selection.length}</span>`
    : `<div class="workspace-first-action"><div id="select-all" class="select-all button-dQdc button-JeZa" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="default" data-accent="default" data-size="default" data-selectable="true">${workspaceIconMarkup()}<label class="select-checkbox select-U4Ec" title="选择所有"><input tabindex="-1" type="checkbox" ${allSelected ? "checked" : ""}></label></div></div><div class="workspace-name">${escapeHtml(viewName(items))}</div><a class="workspace-open" href="${escapeHtml(workspaceHref())}" target="_blank" rel="noopener" title="在新标签页中打开" aria-label="在新标签页中打开">${microIcon("microOpen")}</a>`;
  const selectionActions = selection.length
    ? `<div class="selection-actions"><button title="添加星标" data-batch="favorite">★</button><button title="取消星标" data-batch="unfavorite">☆</button><button title="编辑标签" data-batch="tags">#</button><select id="move-to" aria-label="移动到"><option value="">移动到…</option>${state.collections.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select>${state.view === "trash" ? `<button data-batch="restore">恢复</button>` : `<button class="danger" data-batch="trash">删除</button>`}<button id="export" class="export" title="导出书签" aria-label="导出书签">${treeIcon("download")}<span>导出书签</span></button><button data-selection-clear title="取消选择" aria-label="取消选择">×</button></div>`
    : `<div class="workspace-tools"><div class="workspace-sort" role="button" tabindex="0" title="排序" aria-label="排序" aria-haspopup="menu" aria-expanded="${state.sortMenuOpen}" data-sort-trigger><span class="workspace-sort-icon">${treeIcon(sort?.icon || "sortCreated")}</span><span class="workspace-tool-label workspace-sort-label">${sort?.label || "排序"}</span></div><div class="view-switcher" role="group" aria-label="视图"><button class="view-trigger active" data-view-trigger title="视图" aria-label="视图" aria-haspopup="menu" aria-expanded="${state.viewMenuOpen}">${treeIcon(view.icon)}<span class="workspace-tool-label">${view.label}</span></button></div><button id="export" class="export" title="更多" aria-label="导出书签">${treeIcon("download")}<span class="workspace-tool-label">导出书签</span></button></div>`;
  return `<header class="workspace-head${selection.length ? " workspace-selection-head" : ""}" data-is-header="true">${firstAction}<div class="workspace-space"></div>${selectionActions}</header>${selection.length ? "" : `${sortMenuMarkup()}${viewMenuMarkup()}`}`;
}

function visibleItems() {
  const filters = parseSearchQuery(state.query).filters;
  const duplicates = duplicateLinks(sidebarItems());
  return state.items.filter((item) => {
    if (!matchesSearchFilters(item, filters, duplicates)) return false;
    if (state.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === state.tag.toLocaleLowerCase())) return false;
    return true;
  });
}

function sortedItems() {
  const items = visibleItems();
  const sort = state.preferences?.sort;
  if (sort === "title" || sort === "-title") {
    const ordered = [...items].sort((a, b) => (a.title || a.link).localeCompare(b.title || b.link, "zh-CN"));
    return sort === "-title" ? ordered.reverse() : ordered;
  }
  if (sort === "host" || sort === "domain" || sort === "-domain") {
    const ordered = [...items].sort((a, b) => host(a.link).localeCompare(host(b.link), "zh-CN"));
    return sort === "-domain" ? ordered.reverse() : ordered;
  }
  if (sort === "created" || sort === "-created") {
    const ordered = [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return sort === "-created" ? ordered.reverse() : ordered;
  }
  return items;
}

function tagList(items) {
  const counts = new Map();
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  const source = items === sidebarItems() && state.tags.length
    ? state.tags.map(({ name, count }) => [name, count])
    : [...counts];
  return source.sort(state.preferences?.tagSort === "count"
    ? ([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB, "zh-CN")
    : ([tagA], [tagB]) => tagA.localeCompare(tagB, "zh-CN"));
}

function host(link) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return link; }
}

function collectionName(id) {
  if (id === "unsorted") return "未分类";
  return state.collections.find((item) => item.id === id)?.name || "未分类";
}

function collectionPath(id) {
  if (id === "unsorted") return "未分类";
  const names = [];
  for (let item = state.collections.find((entry) => entry.id === id); item; item = state.collections.find((entry) => entry.id === item.parentId)) names.unshift(item.name);
  return names.join(" / ") || "未分类";
}

function recommendationInput(form, getTags = () => []) {
  return {
    link: form.elements.namedItem("link")?.value || "",
    title: form.elements.namedItem("title")?.value || "",
    description: form.elements.namedItem("description")?.value || "",
    tags: getTags(),
  };
}

function recommendationsEnabled() {
  return Boolean(state.preferences?.recommendCollectionsTags || (state.preferences?.aiRecommendations && state.aiRecommendationsAvailable));
}

function validRecommendationLink(link) {
  try { return /^https?:$/.test(new URL(link).protocol); } catch { return false; }
}

function recommendationErrorMessage(error) {
  const messages = {
    ai_failed: "模型未在 max_tokens 内返回最终 JSON，已保留本地建议。",
    ai_failed_after_fallback: "模型在自动回退后仍未返回有效 JSON，已保留本地建议。",
    ai_quota_exhausted: "Cloudflare 今日免费额度可能已用尽，请稍后再试或更换模型。",
    ai_capacity: "Cloudflare AI 暂时没有可用容量，请稍后再试。",
    ai_paid_required: "该模型需要付费计划，请更换模型或检查账户。",
    ai_key_invalid: "外部 API Key 无效，请检查 AI 设置。",
    ai_not_configured: "AI 服务尚未配置，请检查 AI 设置。",
    ai_external_not_configured: "AI 服务尚未配置，请检查 AI 设置。",
  };
  return t(messages[error?.code] || "AI 服务不可用，已保留本地建议。");
}

function recommendationPanel(form) {
  return form.querySelector("[data-recommendations]");
}

function recommendationCollectionPath(proposal) {
  const name = String(proposal?.name || "").trim();
  return proposal?.parentId ? `${collectionPath(proposal.parentId)} / ${name}` : name;
}

function syncRecommendationTagButtons(form) {
  const currentTags = new Set((form._recommendationGetTags?.() || []).map((tag) => String(tag).toLocaleLowerCase()));
  form.querySelectorAll("[data-recommendation-tag-add]").forEach((button) => {
    const value = button.dataset.recommendationTagAdd?.trim();
    const added = currentTags.has(value?.toLocaleLowerCase());
    const label = t(added ? "移除标签" : "添加标签");
    button.disabled = false;
    button.title = label;
    button.setAttribute("aria-label", `${label} ${value}`);
    button.setAttribute("aria-pressed", String(added));
  });
}

function collectionAtLevel(name, parentId = null) {
  const key = String(name || "").trim().toLocaleLowerCase();
  const level = parentId || null;
  return state.collections.find((item) => (item.parentId || null) === level && item.name.trim().toLocaleLowerCase() === key) || null;
}

async function createRecommendedCollection(form) {
  const result = form._recommendationResult;
  const suggestion = result?.ai;
  const proposal = suggestion?.newCollection;
  if (!proposal?.name) return;
  const button = recommendationPanel(form)?.querySelector("[data-recommendation-create-collection]");
  if (button) button.disabled = true;
  try {
    const parentId = proposal.parentId || null;
    const existing = collectionAtLevel(proposal.name, parentId);
    const collection = existing || await api("/v1/collections", { method: "POST", body: JSON.stringify({ name: proposal.name, parentId }) });
    if (!existing) {
      state.collections = [...state.collections, collection];
      (form._recommendationCreatedCollections ||= []).push(collection.id);
    }
    form.elements.collectionId.innerHTML = collectionOptions(state.collections, collection.id);
    form.elements.collectionId.value = collection.id;
    form._recommendationSyncCollection?.();
    suggestion.collectionId = collection.id;
    suggestion.newCollection = null;
    renderRecommendations(form, result, "ai", t("已创建并选中"));
  } catch (error) {
    if (button) button.disabled = false;
    showError(error);
  }
}

async function cleanupRecommendationCollections(form) {
  const ids = [...new Set(form._recommendationCreatedCollections || [])];
  form._recommendationCreatedCollections = [];
  const removed = [];
  for (const id of ids) {
    const item = state.collections.find((entry) => entry.id === id);
    if (!item || Number(state.collectionCounts[id] || 0) > 0) continue;
    try {
      await api(`/v1/collections/${encodeURIComponent(id)}?revision=${item.revision}`, { method: "DELETE" });
      removed.push(id);
    } catch (error) {
      console.warn("Could not clean up an empty AI collection", error);
    }
  }
  if (removed.length) state.collections = state.collections.filter((item) => !removed.includes(item.id));
  return removed.length > 0;
}

function renderRecommendations(form, result, mode = "local", status = "", busy = false) {
  const panel = recommendationPanel(form);
  if (!panel) return;
  const suggestion = result?.[mode];
  const currentTags = new Set((form._recommendationGetTags?.() || []).map((tag) => String(tag).toLocaleLowerCase()));
  const noteValue = String(suggestion?.note || "");
  const noteField = form.elements.namedItem("note");
  const noteApplied = Boolean(noteValue && noteField && noteField.value.trim() === noteValue.trim());
  const hasSuggestion = Boolean(suggestion?.collectionId || suggestion?.newCollection?.name || suggestion?.tags?.length || suggestion?.note);
  const canApply = Boolean(suggestion?.collectionId || suggestion?.tags?.length || suggestion?.note);
  const aiEnabled = Boolean(state.preferences?.aiRecommendations && state.aiRecommendationsAvailable && validRecommendationLink(result?.input?.link || ""));
  panel.hidden = !recommendationsEnabled();
  panel.dataset.recommendationMode = mode;
  panel.querySelector(".bookmark-recommendations-header strong").textContent = t(mode === "ai" ? "AI 推荐收藏集" : "系统推荐收藏集");
  panel.querySelector("[data-recommendation-status]").textContent = status || (!hasSuggestion ? t("没有足够相似的书签") : "");
  panel.querySelector("[data-recommendation-body]").innerHTML = localizeHtml(hasSuggestion ? `<div class="recommendation-items">${suggestion.collectionId ? `<label class="recommendation-option"><input type="checkbox" data-recommendation-collection checked><span>${t("推荐收藏集")}</span><strong>${escapeHtml(collectionPath(suggestion.collectionId))}</strong></label>` : ""}${suggestion.newCollection?.name ? `<div class="recommendation-new-collection"><div><span>${t("新收藏集")}</span><strong>${escapeHtml(recommendationCollectionPath(suggestion.newCollection))}</strong></div><button type="button" data-recommendation-create-collection>${t("创建并选中")}</button></div>` : ""}${suggestion.tags?.length ? `<div class="recommendation-tags"><span>${t("推荐标签")}</span>${suggestion.tags.map((tag) => { const value = String(tag); const added = currentTags.has(value.toLocaleLowerCase()); return `<div class="recommendation-tag"><input type="checkbox" data-recommendation-tag value="${escapeHtml(value)}" checked><button type="button" class="recommendation-tag-add" data-recommendation-tag-add="${escapeHtml(value)}" title="${escapeHtml(t(added ? "移除标签" : "添加标签"))}" aria-label="${escapeHtml(`${added ? t("移除标签") : t("添加标签")} ${value}`)}" aria-pressed="${added}">#${escapeHtml(value)}</button></div>`; }).join("")}</div>` : ""}${suggestion.note ? `<div class="recommendation-note"><div class="recommendation-note-header"><span>${t("备注")}</span><button type="button" data-recommendation-note-add aria-pressed="${noteApplied}" ${noteApplied ? "disabled" : ""}>${noteApplied ? t("已应用") : t("添加备注")}</button></div><textarea data-recommendation-note rows="3">${escapeHtml(noteValue)}</textarea></div>` : ""}</div>` : "");
  const aiButton = panel.querySelector("[data-recommendation-ai]");
  const applyButton = panel.querySelector("[data-recommendation-apply]");
  aiButton.hidden = !aiEnabled;
  aiButton.disabled = busy;
  applyButton.hidden = !canApply;
  applyButton.textContent = t(mode === "ai" ? "应用 AI 建议" : "应用本地建议");
  applyButton.disabled = !canApply;
  panel.querySelector("[data-recommendation-ai]").onclick = () => requestAiRecommendations(form);
  panel.querySelector("[data-recommendation-apply]").onclick = () => applyRecommendations(form);
  panel.querySelector("[data-recommendation-create-collection]")?.addEventListener("click", () => createRecommendedCollection(form));
  panel.querySelectorAll("[data-recommendation-tag-add]").forEach((button) => {
    button.onclick = () => {
      const value = button.dataset.recommendationTagAdd?.trim();
      const tags = form._recommendationGetTags();
      if (!value) return;
      const valueKey = value.toLocaleLowerCase();
      const nextTags = tags.some((tag) => tag.toLocaleLowerCase() === valueKey)
        ? tags.filter((tag) => tag.toLocaleLowerCase() !== valueKey)
        : [...tags, value];
      form._recommendationSetTags(nextTags);
      if (result?.input) result.input.tags = form._recommendationGetTags();
      syncRecommendationTagButtons(form);
    };
  });
  const noteInput = panel.querySelector("[data-recommendation-note]");
  const noteButton = panel.querySelector("[data-recommendation-note-add]");
  if (noteInput && noteButton) {
    noteButton.onclick = () => {
      const field = form.elements.namedItem("note");
      if (!field) return;
      field.value = noteInput.value;
      noteButton.disabled = true;
      noteButton.setAttribute("aria-pressed", "true");
      noteButton.textContent = t("已应用");
    };
    noteInput.oninput = () => {
      noteButton.disabled = false;
      noteButton.setAttribute("aria-pressed", "false");
      noteButton.textContent = t("添加备注");
    };
  }
}

function localRecommendation(form) {
  const excludeId = form.closest("#edit-bookmark-dialog")?.dataset.bookmarkId || "";
  return recommendBookmark(recommendationInput(form, form._recommendationGetTags), state.allItems, state.collections, excludeId);
}

function refreshRecommendations(form) {
  if (!recommendationsEnabled()) {
    const panel = recommendationPanel(form);
    if (panel) panel.hidden = true;
    return;
  }
  const input = recommendationInput(form, form._recommendationGetTags);
  const local = localRecommendation(form);
  form._recommendationResult = { input, local, ai: null };
  renderRecommendations(form, form._recommendationResult, "local");
}

async function requestAiRecommendations(form) {
  const result = form._recommendationResult || { input: recommendationInput(form, form._recommendationGetTags), local: localRecommendation(form), ai: null };
  const panel = recommendationPanel(form);
  const aiButton = panel?.querySelector("[data-recommendation-ai]");
  if (!panel || !aiButton || !validRecommendationLink(result.input.link)) return;
  aiButton.disabled = true;
  renderRecommendations(form, result, "local", t("正在分析…"), true);
  try {
    result.ai = await api("/v1/ai/recommendations", {
      method: "POST",
      body: JSON.stringify({
        ...result.input,
        collections: state.collections.map(({ id, name, parentId }) => ({ id, name, parentId })),
        context: result.local.matches,
      }),
    });
    form._recommendationResult = result;
    renderRecommendations(form, result, "ai", result.ai?.fallbackUsed ? t("已自动关闭思考模式重试并生成建议") : "");
  } catch (error) {
    form._recommendationResult = result;
    renderRecommendations(form, result, "local", recommendationErrorMessage(error));
  }
}

function applyRecommendations(form) {
  const result = form._recommendationResult;
  const mode = recommendationPanel(form)?.dataset.recommendationMode || "local";
  const suggestion = result?.[mode];
  if (!suggestion) return;
  const collection = form.elements.namedItem("collectionId");
  const collectionChoice = recommendationPanel(form).querySelector("[data-recommendation-collection]");
  if (collectionChoice?.checked && suggestion.collectionId && [...collection.options].some((option) => option.value === suggestion.collectionId)) {
    collection.value = suggestion.collectionId;
    form._recommendationSyncCollection?.();
  }
  const selectedTags = [...recommendationPanel(form).querySelectorAll("[data-recommendation-tag]:checked")].map((input) => input.value);
  const currentTags = form._recommendationGetTags();
  const mergedTags = [...currentTags, ...selectedTags].filter((tag, index, all) => all.findIndex((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
  form._recommendationSetTags(mergedTags);
  const noteInput = recommendationPanel(form).querySelector("[data-recommendation-note]");
  if (mode === "ai" && noteInput) {
    const noteField = form.elements.namedItem("note");
    if (noteField) noteField.value = noteInput.value;
  }
  renderRecommendations(form, result, mode, t("已应用"));
}

function bindRecommendationForm(form, { getTags = () => [], setTags = () => {}, syncCollection = () => {} } = {}) {
  form._recommendationGetTags = getTags;
  form._recommendationSetTags = setTags;
  form._recommendationSyncCollection = syncCollection;
  for (const name of ["link", "title", "description"]) {
    const field = form.elements.namedItem(name);
    if (field) field.oninput = () => {
      clearTimeout(form._recommendationTimer);
      form._recommendationTimer = setTimeout(() => refreshRecommendations(form), 180);
    };
  }
  refreshRecommendations(form);
}

function collectionPickerRowsSource(query, selectedId) {
  const value = query.trim().toLocaleLowerCase();
  const menu = (item) => state.pickerCollectionMenuId === item.id ? `<div class="collection-picker-action-menu" role="menu" data-picker-collection-menu-panel><button type="button" role="menuitem" data-picker-collection-action="open" data-collection-id="${item.id}">打开所有书签</button><span></span><button type="button" role="menuitem" data-picker-collection-action="create-child" data-collection-id="${item.id}">创建嵌套的集合</button><span></span><button type="button" role="menuitem" data-picker-collection-action="select" data-collection-id="${item.id}">选择</button><button type="button" role="menuitem" data-picker-collection-action="rename" data-collection-id="${item.id}">改名</button><button type="button" role="menuitem" data-picker-collection-action="icon" data-collection-id="${item.id}">更改图标</button><button type="button" role="menuitem" data-picker-collection-action="share" data-collection-id="${item.id}">分享</button><button type="button" role="menuitem" data-picker-collection-action="delete" data-collection-id="${item.id}">删除</button></div>` : "";
  const groupMenu = (group) => state.pickerGroupMenuId === group.id ? `<div class="collection-picker-action-menu" role="menu" data-picker-group-menu-panel><button type="button" role="menuitem" data-picker-group-action="select" data-group-id="${group.id}">选择所有</button><span></span><button type="button" role="menuitem" data-picker-group-action="create-collection" data-group-id="${group.id}">创建收藏集</button><button type="button" role="menuitem" data-picker-group-action="${expandableCollectionIds().length && expandableCollectionIds().every((id) => state.collapsedCollections.has(id)) ? "expand" : "collapse"}" data-group-id="${group.id}">${expandableCollectionIds().length && expandableCollectionIds().every((id) => state.collapsedCollections.has(id)) ? "展开所有收藏集" : "折叠所有收藏集"}</button><button type="button" role="menuitem" data-picker-group-action="sort" data-group-id="${group.id}">按名称排序所有收藏集</button><button type="button" role="menuitem" data-picker-group-action="clean" data-group-id="${group.id}">删除所有空收藏集</button><span></span><button type="button" role="menuitem" data-picker-group-action="hide" data-group-id="${group.id}">隐藏分组</button></div>` : "";
  const row = (item, depth = 0) => {
    const hasChildren = state.collections.some((child) => child.parentId === item.id);
    const collapsed = state.collapsedCollections.has(item.id);
    const count = Number(state.collectionCounts[item.id] || 0);
    const arrowTitle = collapsed ? "展开" : "折叠";
    const arrow = hasChildren
      ? `<span class="collection-picker-arrow ${collapsed ? "collapsed" : ""}" data-picker-toggle-collection="${item.id}" title="${arrowTitle}${escapeHtml(collectionName(item.id))}" aria-label="${arrowTitle}${escapeHtml(collectionName(item.id))}">${treeIcon("arrow")}</span>`
      : `<span class="collection-picker-arrow placeholder"></span>`;
    const active = item.id === selectedId;
    const iconValue = collectionIconValue(item.id);
    return `<div class="collection-picker-row" style="--depth:${depth}"><button type="button" role="option" class="collection-picker-item ${active ? "active" : ""}" aria-selected="${active}" data-pick-collection="${item.id}">${arrow}<span class="collection-picker-icon">${collectionIconMarkup(iconValue, active, item.id === "unsorted")}</span><span class="collection-picker-item-name">${escapeHtml(collectionName(item.id))}</span>${count > 0 ? `<small class="collection-picker-count">${count}</small>` : ""}</button><button type="button" class="collection-picker-more" data-picker-collection-menu="${item.id}" title="更多" aria-label="${escapeHtml(collectionName(item.id))}更多" aria-expanded="${state.pickerCollectionMenuId === item.id}">${treeIcon("moreHorizontal")}</button>${menu(item)}</div>`;
  };
  if (value) {
    const matches = state.collections.filter((item) => collectionName(item.id).toLocaleLowerCase().includes(value));
    return matches.length ? matches.map((item) => row(item)).join("") : '<p class="collection-picker-empty">没有找到收藏集</p>';
  }
  const children = (groupId, parentId = null, depth = 0) => state.collections
    .filter((item) => item.id !== "unsorted" && item.parentId === parentId && (parentId !== null || collectionGroupId(item) === groupId))
    .map((item) => row(item, depth) + inlineCollectionRow("picker", groupId, item.id, depth + 1) + (state.collapsedCollections.has(item.id) ? "" : children(groupId, item.id, depth + 1))).join("");
  const unsorted = state.collections.find((item) => item.id === "unsorted");
  return `${unsorted ? row(unsorted) : ""}${collectionGroups().map((group) => `<div class="collection-picker-group"><span>${escapeHtml(group.title)}</span><button type="button" class="collection-picker-group-more" data-picker-group-menu="${group.id}" title="更多" aria-label="${escapeHtml(group.title)}更多" aria-expanded="${state.pickerGroupMenuId === group.id}">${treeIcon("moreHorizontal")}</button></div>${groupMenu(group)}${inlineCollectionRow("picker", group.id, null, 0)}${children(group.id)}`).join("")}`;
}

function collectionPickerRows(query, selectedId) {
  return localizeHtml(collectionPickerRowsSource(query, selectedId));
}

function collectionIconPickerRows(query) {
  const value = String(query || "").trim().toLocaleLowerCase();
  const groups = collectionIconCatalog.map((group) => {
    const icons = group.icons.filter((icon) => !value || `${group.category} ${icon.name}`.toLocaleLowerCase().includes(value));
    if (!icons.length) return "";
    return `<section class="collection-icon-picker-section"><h3>${escapeHtml(group.category)}</h3><div class="collection-icon-picker-grid">${icons.map((icon) => `<button type="button" class="collection-icon-picker-item" role="option" data-collection-icon-value="${escapeHtml(icon.url)}" aria-label="${escapeHtml(`${group.category} ${icon.name}`)}" title="${escapeHtml(icon.name)}"><img data-collection-icon-image src="${escapeHtml(icon.url)}" alt="" loading="lazy"></button>`).join("")}</div></section>`;
  }).join("");
  return groups || `<p class="collection-icon-picker-empty">${t("没有找到图标")}</p>`;
}

function renderCollectionIconPicker(query = "") {
  const content = collectionIconPickerDialog?.querySelector("#collection-icon-picker-content");
  if (!content) return;
  content.innerHTML = collectionIconPickerRows(query);
}

const COLLECTION_ICON_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const COLLECTION_ICON_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

function readCollectionIconFile(file) {
  if (!file || !COLLECTION_ICON_UPLOAD_TYPES.has(file.type)) throw new TypeError("请选择 JPG、PNG、GIF、WebP 或 AVIF 图片");
  if (file.size > COLLECTION_ICON_UPLOAD_MAX_BYTES) throw new TypeError("图片不能超过 5 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new TypeError("图片读取失败"));
    reader.onload = () => {
      const value = String(reader.result || "");
      if (!COLLECTION_ICON_DATA_URL.test(value)) return reject(new TypeError("请选择有效的图片文件"));
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

function refreshCollectionIconSurfaces(collectionId) {
  renderSidebar();
  const iconValue = collectionIconValue(collectionId);
  const active = state.collectionId === collectionId;
  const workspaceIcon = root.querySelector(".workspace-icon");
  if (workspaceIcon && state.collectionId === collectionId) {
    workspaceIcon.classList.toggle("collection-emoji", Boolean(iconValue && !isCollectionIconImage(iconValue)));
    workspaceIcon.innerHTML = collectionIconMarkup(iconValue, active);
  }
  root.querySelectorAll("[data-card-collection]").forEach((link) => {
    if (link.dataset.cardCollection !== collectionId) return;
    const pathIcon = link.querySelector(".card-path-icon");
    if (pathIcon) pathIcon.innerHTML = collectionIconMarkup(iconValue, false, collectionId === "unsorted");
  });
  const editForm = editBookmarkDialog?.querySelector("form");
  if (editForm?.elements.collectionId?.value === collectionId) {
    const editIcon = editForm.querySelector(".edit-collection-icon");
    if (editIcon) editIcon.innerHTML = collectionIconMarkup(iconValue, false, collectionId === "unsorted");
  }
}

async function saveCollectionIconValue(collectionId, value) {
  const icons = { ...(state.preferences?.collectionIconByCollectionId || {}) };
  const icon = String(value || "").trim();
  if (icon) {
    if (!isCollectionIconImage(icon)) throw new TypeError("请选择有效的图片图标");
    icons[collectionId] = icon;
  } else {
    delete icons[collectionId];
  }
  await savePreferences({ collectionIconByCollectionId: icons });
  refreshCollectionIconSurfaces(collectionId);
}

function openCollectionIconPicker(item) {
  if (!item || !collectionIconPickerDialog) return;
  const search = collectionIconPickerDialog.querySelector("#collection-icon-picker-search");
  const back = collectionIconPickerDialog.querySelector("#collection-icon-picker-back");
  const close = collectionIconPickerDialog.querySelector("#collection-icon-picker-close");
  const upload = collectionIconPickerDialog.querySelector("#collection-icon-picker-upload");
  const remove = collectionIconPickerDialog.querySelector("[data-collection-icon-delete]");
  back.innerHTML = treeIcon("back");
  close.innerHTML = treeIcon("close");
  collectionIconPickerDialog.querySelector(".collection-icon-picker-search-icon").innerHTML = treeIcon("search");
  collectionIconPickerDialog.querySelector("[data-collection-icon-upload-icon]").innerHTML = treeIcon("add");
  back.onclick = () => collectionIconPickerDialog.close();
  close.onclick = () => collectionIconPickerDialog.close();
  search.value = "";
  search.oninput = () => renderCollectionIconPicker(search.value);
  remove.onclick = () => saveCollectionIconValue(item.id, "").then(() => collectionIconPickerDialog.close()).catch(showError);
  upload.onchange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    readCollectionIconFile(file).then((value) => saveCollectionIconValue(item.id, value)).then(() => collectionIconPickerDialog.close()).catch(showError);
  };
  collectionIconPickerDialog.querySelector("#collection-icon-picker-content").onclick = (event) => {
    const button = event.target.closest("[data-collection-icon-value]");
    if (!button) return;
    saveCollectionIconValue(item.id, button.dataset.collectionIconValue).then(() => collectionIconPickerDialog.close()).catch(showError);
  };
  collectionIconPickerDialog.onclose = () => {
    search.oninput = null;
    collectionIconPickerDialog.querySelector("#collection-icon-picker-content").onclick = null;
  };
  collectionIconCatalog = readCollectionIconCache(globalThis.localStorage) || COLLECTION_ICON_DEFAULT_CATALOG;
  renderCollectionIconPicker();
  collectionIconPickerDialog.showModal();
  queueMicrotask(() => search.focus());
}

document.addEventListener("error", (event) => {
  const image = event.target?.closest?.("img[data-collection-icon-image]");
  if (!image) return;
  image.hidden = true;
  image.parentElement?.classList.add("is-failed");
}, true);

function openMovePicker() {
  const search = collectionPickerDialog.querySelector("#collection-picker-search");
  const list = collectionPickerDialog.querySelector("#collection-picker-list");
  const back = collectionPickerDialog.querySelector("#collection-picker-back");
  const close = collectionPickerDialog.querySelector("#collection-picker-close");
  if (!search || !list) return;
  const closePicker = () => collectionPickerDialog.close();
  const renderRows = () => {
    list.innerHTML = collectionPickerRows(search.value, "");
    const inlineInput = list.querySelector("[data-inline-collection-form] input");
    if (inlineInput) {
      let committing = false;
      const finish = async () => {
        if (committing) return;
        committing = true;
        if (!inlineInput.value.trim()) {
          state.inlineCollectionCreate = null;
          renderRows();
          search.focus();
          return;
        }
        try {
          const created = await createInlineCollection(inlineInput.form);
          state.inlineCollectionCreate = null;
          renderRows();
          if (created) {
            closePicker();
            await batch("move", created.id);
          }
        } catch (error) {
          committing = false;
          showError(error);
        }
      };
      inlineInput.form.onsubmit = (event) => { event.preventDefault(); finish(); };
      inlineInput.onblur = finish;
      inlineInput.onkeydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        state.inlineCollectionCreate = null;
        renderRows();
        search.focus();
      };
      queueMicrotask(() => inlineInput.focus());
    }
    positionSidebarMenus();
  };
  const pickCollection = (id) => {
    if (!id) return;
    closePicker();
    batch("move", id).catch(showError);
  };
  state.pickerCollectionMenuId = null;
  state.pickerGroupMenuId = null;
  state.inlineCollectionCreate = null;
  search.value = "";
  collectionPickerDialog.querySelector(".collection-picker-search-icon").innerHTML = treeIcon("search");
  back && (back.innerHTML = treeIcon("back"));
  close && (close.innerHTML = treeIcon("close"));
  back && (back.onclick = closePicker);
  close && (close.onclick = closePicker);
  search.oninput = () => {
    state.pickerCollectionMenuId = null;
    state.pickerGroupMenuId = null;
    state.inlineCollectionCreate = null;
    renderRows();
  };
  list.onclick = (event) => {
    const createMain = event.target.closest("[data-picker-create-main]");
    if (createMain) {
      state.pickerCollectionMenuId = null;
      state.inlineCollectionCreate = { surface: "picker", groupId: createMain.dataset.pickerCreateMain, parentId: null };
      return renderRows();
    }
    const groupMenuButton = event.target.closest("[data-picker-group-menu]");
    if (groupMenuButton) {
      state.pickerCollectionMenuId = null;
      state.pickerGroupMenuId = state.pickerGroupMenuId === groupMenuButton.dataset.pickerGroupMenu ? null : groupMenuButton.dataset.pickerGroupMenu;
      return renderRows();
    }
    const groupMenuAction = event.target.closest("[data-picker-group-action]");
    if (groupMenuAction) {
      const actionName = groupMenuAction.dataset.pickerGroupAction;
      const groupId = groupMenuAction.dataset.groupId;
      state.pickerGroupMenuId = null;
      if (actionName === "create-collection") {
        state.inlineCollectionCreate = { surface: "picker", groupId, parentId: null };
        renderRows();
        focusInlineCollection("picker");
        return;
      }
      if (actionName === "collapse" || actionName === "expand") {
        state.collapsedCollections = actionName === "collapse" ? new Set(expandableCollectionIds()) : new Set();
        renderRows();
        savePreferences({ collapsedCollectionIds: [...state.collapsedCollections] }).catch(showError);
        return;
      }
      closePicker();
      groupAction(actionName, groupId).catch(showError);
      return;
    }
    const toggle = event.target.closest("[data-picker-toggle-collection]");
    if (toggle) {
      event.stopPropagation();
      const id = toggle.dataset.pickerToggleCollection;
      state.collapsedCollections.has(id) ? state.collapsedCollections.delete(id) : state.collapsedCollections.add(id);
      renderRows();
      savePreferences({ collapsedCollectionIds: [...state.collapsedCollections] }).catch(showError);
      return;
    }
    const menuButton = event.target.closest("[data-picker-collection-menu]");
    if (menuButton) {
      state.pickerCollectionMenuId = state.pickerCollectionMenuId === menuButton.dataset.pickerCollectionMenu ? null : menuButton.dataset.pickerCollectionMenu;
      return renderRows();
    }
    const action = event.target.closest("[data-picker-collection-action]");
    if (action) {
      state.pickerCollectionMenuId = null;
      if (action.dataset.pickerCollectionAction === "create-child") {
        const parent = state.collections.find((entry) => entry.id === action.dataset.collectionId);
        if (!parent) return;
        state.collapsedCollections.delete(parent.id);
        state.inlineCollectionCreate = { surface: "picker", groupId: collectionGroupId(parent), parentId: parent.id };
        return renderRows();
      }
      closePicker();
      return collectionAction(action.dataset.pickerCollectionAction, action.dataset.collectionId).catch(showError);
    }
    const option = event.target.closest("[data-pick-collection]");
    if (option) pickCollection(option.dataset.pickCollection);
  };
  list.onkeydown = (event) => {
    if (event.key === "Escape" && !event.target.closest("[data-inline-collection-form]")) closePicker();
  };
  collectionPickerDialog.onclose = () => {
    state.pickerCollectionMenuId = null;
    state.pickerGroupMenuId = null;
    state.inlineCollectionCreate = null;
    list.onclick = null;
    list.onkeydown = null;
    search.oninput = null;
  };
  renderRows();
  collectionPickerDialog.showModal();
  queueMicrotask(() => search.focus());
}

function dateLabel(value) {
  try { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value)); } catch { return ""; }
}

function dateTimeLabel(value) {
  try { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); } catch { return ""; }
}

function dateTimeInputValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function faviconUrl(link, size = 20) {
  try {
    const hostname = new URL(link).hostname.toLocaleLowerCase();
    return `https://rdl.ink/favicon/${encodeURIComponent(hostname)}?mode=crop&fill=solid&format=webp&width=${size}&ar=1:1&dpr=2`;
  } catch {
    return "icons/bookmark.svg";
  }
}

function coverDpr() {
  return (window.devicePixelRatio || 1) + 1;
}

function gridCoverUrl(item, width = masonryGridWidth()) {
  if (!item.cover) return "icons/bookmark.svg";
  if (item.cover.startsWith("data:")) return item.cover;
  const source = item.cover === "<screenshot>" ? item.link : item.cover;
  if (!source) return "icons/bookmark.svg";
  return `https://rdl.ink/render/${encodeURIComponent(source)}?mode=fillmax&fill=solid&format=webp&width=${width}&ar=16:9&dpr=${coverDpr()}`;
}

function masonryCoverUrl(item, width = masonryGridWidth()) {
  const source = item.cover === "<screenshot>" ? item.link : item.cover || item.link;
  if (!source) return "icons/bookmark.svg";
  return `https://rdl.ink/render/${encodeURIComponent(source)}?mode=crop&fill=solid&format=webp&width=${width}&ar=&dpr=${coverDpr()}`;
}

function listCoverUrl(item, width = 56) {
  if (item.cover !== "<screenshot>") return item.cover || "icons/bookmark.svg";
  return `https://rdl.ink/render/${encodeURIComponent(item.link)}?mode=crop&fill=solid&format=webp&width=${width}&ar=7:6&dpr=${window.devicePixelRatio || 1}`;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const COVER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const COVER_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

function coverUploadButton() {
  return coverPickerDialog.querySelector("#cover-upload");
}

function setCoverUploadEnabled(enabled) {
  state.mediaUploadEnabled = Boolean(enabled);
  const button = coverUploadButton();
  if (!button || button.dataset.uploading === "true") return;
  button.disabled = !state.mediaUploadEnabled;
  button.title = state.mediaUploadEnabled ? t("上传封面文件") : t("上传文件（需要配置 R2）");
  button.setAttribute("aria-label", button.title);
}

function editorCoverUrl(value, item, width = 56) {
  const source = value === "<screenshot>" ? item?.link : value;
  const url = httpUrl(source);
  if (!url) return String(source || "").startsWith("icons/") ? source : "icons/bookmark.svg";
  return `https://rdl.ink/render/${encodeURIComponent(url)}?mode=crop&fill=solid&format=webp&width=${width}&ar=7:6&dpr=2`;
}

function pickerCoverUrl(value, item) {
  const source = value === "<screenshot>" ? item?.link : value;
  const url = httpUrl(source);
  if (!url) return "icons/bookmark.svg";
  return `https://rdl.ink/render/${encodeURIComponent(url)}?mode=crop&width=128&height=96&dpr=2`;
}

function editFormSnapshot() {
  const form = editBookmarkDialog.querySelector("form");
  if (!form) return "";
  const fields = new FormData(form);
  return JSON.stringify({
    link: fields.get("link") || "",
    title: fields.get("title") || "",
    description: fields.get("description") || "",
    note: fields.get("note") || "",
    reminder: fields.get("reminder") || "",
    cover: fields.get("cover") || "",
    media: fields.get("media") || "[]",
    collectionId: fields.get("collectionId") || "",
    tags: fields.get("tags") || "[]",
    favorite: fields.has("favorite"),
    highlights: editBookmarkDialog.dataset.highlights || "[]",
  });
}

function editFormIsDirty() {
  return Boolean(state.editingId && state.editSnapshot && state.editSnapshot !== editFormSnapshot());
}

function syncEditPanelLayout(open = editBookmarkDialog.open) {
  root.querySelector(".library")?.classList.toggle("editing", Boolean(open && state.editingId));
}

function mountEditPanel(wasOpen = editBookmarkDialog.open) {
  const library = root.querySelector(".library");
  if (!library) return;
  if (editBookmarkDialog.parentElement !== library) library.append(editBookmarkDialog);
  if (wasOpen && !editBookmarkDialog.open) editBookmarkDialog.show();
  syncEditPanelLayout(wasOpen);
}

function activeEditItem() {
  const id = state.editingId || (editBookmarkDialog.open ? editBookmarkDialog.dataset.bookmarkId : "");
  return state.items.find((item) => item.id === id) || state.allItems.find((item) => item.id === id) || null;
}

function editMediaDraft() {
  const value = editBookmarkDialog.querySelector("[name=media]")?.value;
  try {
    const media = JSON.parse(value || "[]");
    return Array.isArray(media) ? media.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function editCoverDraft() {
  return editBookmarkDialog.querySelector("[name=cover]")?.value || "";
}

function syncEditCoverPreview(item = activeEditItem()) {
  const image = editBookmarkDialog.querySelector("#edit-cover");
  if (!image || !item) return;
  image.onerror = () => {
    image.onerror = null;
    image.src = "icons/bookmark.svg";
  };
  image.src = editorCoverUrl(editCoverDraft(), item);
}

function setEditCoverDraft(value, media = editMediaDraft()) {
  const coverInput = editBookmarkDialog.querySelector("[name=cover]");
  const mediaInput = editBookmarkDialog.querySelector("[name=media]");
  if (!coverInput || !mediaInput) return;
  const nextMedia = [...new Set(media.filter((item) => typeof item === "string" && item.trim()))].slice(0, 9);
  coverInput.value = value || "";
  mediaInput.value = JSON.stringify(nextMedia);
  syncEditCoverPreview();
}

function coverCandidates(item) {
  const values = [editCoverDraft() || item.cover, ...(Array.isArray(item.media) ? item.media : []), ...editMediaDraft()];
  const seen = new Set();
  return values.filter((value) => {
    const url = httpUrl(value);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map((value) => httpUrl(value));
}

function replaceStateBookmark(updated) {
  for (const key of ["items", "allItems"]) {
    const index = state[key].findIndex((item) => item.id === updated.id);
    if (index >= 0) state[key][index] = updated;
  }
}

function renderCoverPicker() {
  const item = activeEditItem();
  const list = coverPickerDialog.querySelector("#cover-picker-items");
  if (!item || !list) return;
  const current = editCoverDraft();
  const candidates = coverCandidates(item);
  list.innerHTML = `${candidates.map((value) => `<button type="button" class="cover-picker-item ${current === value ? "active" : ""}" role="option" aria-selected="${current === value}" data-cover-value="${escapeHtml(value)}" title="${t("使用此封面")}"><img src="${escapeHtml(pickerCoverUrl(value, item))}" alt="" loading="lazy"></button>`).join("")}<button type="button" class="cover-picker-item cover-picker-screenshot ${current === "<screenshot>" ? "active" : ""}" role="option" aria-selected="${current === "<screenshot>"}" data-cover-screenshot title="${t("创建页面截图")}">${t("截屏")}</button>${candidates.length ? "" : `<p class="cover-picker-empty">${t("此书签还没有可用的候选封面。")}</p>`}`;
  list.querySelectorAll(".cover-picker-item img").forEach((image) => image.addEventListener("error", () => {
    image.onerror = null;
    image.src = "icons/bookmark.svg";
  }, { once: true }));
  list.querySelectorAll("[data-cover-value]").forEach((button) => button.onclick = () => {
    const value = button.dataset.coverValue;
    setEditCoverDraft(value, [...editMediaDraft(), value]);
    coverPickerDialog.close();
  });
  list.querySelector("[data-cover-screenshot]")?.addEventListener("click", () => createEditScreenshot().catch(showError));
  localizeDialogs();
}

function openCoverPicker() {
  if (!activeEditItem()) return;
  renderCoverPicker();
  coverPickerDialog.showModal();
}

async function createEditScreenshot() {
  const item = activeEditItem();
  const button = coverPickerDialog.querySelector("[data-cover-screenshot]");
  if (!item || !button || button.disabled) return;
  button.disabled = true;
  button.textContent = t("正在创建…");
  try {
    const result = await mutate("/v1/bookmarks/batch", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: item.id, revision: item.revision }], action: { type: "screenshot" } }),
    });
    const updated = result?.bookmarks?.[0];
    if (!updated) return;
    replaceStateBookmark(updated);
    setEditCoverDraft("<screenshot>", [...editMediaDraft(), "<screenshot>"]);
    coverPickerDialog.close();
  } finally {
    button.disabled = false;
    button.textContent = t("截屏");
  }
}

async function uploadEditCover(file) {
  const item = activeEditItem();
  if (!item || !file || !state.mediaUploadEnabled) return;
  if (!COVER_UPLOAD_TYPES.has(file.type)) throw new TypeError("请选择 JPG、PNG、GIF、WebP 或 AVIF 图片");
  if (file.size > COVER_UPLOAD_MAX_BYTES) throw new TypeError("图片不能超过 5 MB");
  const button = coverUploadButton();
  if (!button || button.dataset.uploading === "true") return;
  button.dataset.uploading = "true";
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.title = t("正在上传封面…");
  button.setAttribute("aria-label", button.title);
  try {
    const result = await api("/v1/media", {
      method: "POST",
      body: file,
      headers: { "content-type": file.type },
    });
    const value = httpUrl(result?.url);
    if (!value) throw new TypeError("上传后没有返回有效的封面地址");
    setEditCoverDraft(value, [...editMediaDraft(), value]);
    renderCoverPicker();
  } finally {
    delete button.dataset.uploading;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    button.innerHTML = treeIcon("upload");
    setCoverUploadEnabled(state.mediaUploadEnabled);
  }
}

async function mutate(path, init) {
  try {
    return await api(path, init);
  } catch (error) {
    if (error?.code !== "editing_conflict") throw error;
    if (!window.confirm("此项目已在其他设备上更新。点击“确定”覆盖为当前修改，或点击“取消”刷新最新内容。")) {
      await load();
      return null;
    }
    if (!init.body) {
      const url = new URL(path, location.origin);
      url.searchParams.set("force", "1");
      return api(`${url.pathname}${url.search}`, init);
    }
    return api(path, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), force: true }) });
  }
}

function card(item, index, duplicates = new Set()) {
  const selected = state.selected.has(item.id) ? "checked" : "";
  const titleView = state.layout === "simple";
  const gridView = state.layout === "grid";
  const masonryView = state.layout === "masonry";
  const coverSrc = titleView ? faviconUrl(item.link) : masonryView ? masonryCoverUrl(item) : gridView ? gridCoverUrl(item) : listCoverUrl(item);
  const coverSize = titleView ? 20 : 56;
  const cardLinkTarget = settingsPreference("bookmarkClick", "new_tab") === "current_tab" ? "" : "target=\"_blank\" rel=\"noopener\"";
  const note = item.note ? renderMarkdown(item.note) : "";
  const description = item.description ? escapeHtml(item.description) : "";
  const tags = item.tags.map((tag) => `<span class="card-tag"><span class="card-tag-icon">${microIcon("microTag")}</span>${escapeHtml(tag)}</span>`).join("");
  const type = bookmarkType(item);
  const status = item.health.status === "broken" ? `<section data-inline="true" class="card-status card-broken" title="失效链接">${microIcon("microBroken")}</section>` : "";
  const duplicate = duplicates.has(item.link) ? `<section data-inline="true" class="card-status card-duplicate" title="重复书签">${microIcon("microDuplicate")}</section>` : "";
  const typeIcon = bookmarkTypeIcon(type) ? `<section data-inline="true" class="card-type card-type-${type}" title="${escapeHtml(type)}">${bookmarkTypeIcon(type)}</section>` : "";
  const important = item.favorite ? `<section data-inline="true" class="card-important">${microIcon("microImportantActive")}</section>` : "";
  const reminder = item.reminder ? `<section data-inline="true" class="card-reminder">${microIcon("microReminder")} ${escapeHtml(dateTimeLabel(item.reminder))}</section>` : "";
  const highlights = item.highlights.length ? `<section data-inline="true" class="card-highlights">${microIcon("microComment")} ${item.highlights.length} 条高亮</section>` : "";
  const source = `<section><a class="card-path" href="#" data-card-collection="${escapeHtml(item.collectionId)}"><span class="card-path-icon">${collectionIconMarkup(collectionIconValue(item.collectionId), false, item.collectionId === "unsorted")}</span>${escapeHtml(masonryView ? collectionName(item.collectionId) : collectionPath(item.collectionId))}</a></section>${important}${status}${duplicate}${typeIcon}<section>${escapeHtml(host(item.link))}</section>${item.createdAt ? `<section>${dateLabel(item.createdAt)}</section>` : ""}${reminder}${highlights}`;
  const actionMarkup = bookmarkActionMarkup(item);
  const selectControl = buttonGroupEnabled("select") ? `<label class="card-select" title="选择"><input aria-label="选择${escapeHtml(item.title || item.link)}" type="checkbox" data-select="${item.id}" ${selected}></label>` : "";
  const menuOpen = state.cardMenuId === item.id ? " card-menu-open" : "";
  const coverAttrs = masonryView || gridView ? `width="${masonryGridWidth()}"` : `width="${coverSize}" height="${titleView ? 20 : 48}"`;
  const sourceMarkup = masonryView || gridView ? `<source srcset="${escapeHtml(coverSrc)}" type="image/webp">` : "";
  return `<article role="listitem" draggable="true" data-drag-bookmark="${item.id}" class="bookmark-card${selected ? " selected" : ""}${state.selected.size ? " selection-mode" : ""}${masonryView ? " masonry-card" : ""}${menuOpen}" style="--stagger:${Math.min(index, 12)}"><picture role="img" class="card-cover">${sourceMarkup}<img src="${escapeHtml(coverSrc)}" alt="" ${coverAttrs} referrerpolicy="no-referrer"></picture><div class="card-copy"><div class="card-title">${escapeHtml(item.title || item.link)}</div><div class="card-details">${note ? `<div class="card-note">${note}</div>` : ""}${description ? `<div class="card-description">${description}</div>` : ""}${tags ? `<div class="card-tags">${tags}</div>` : ""}</div><div class="card-source">${source}</div></div><div class="card-actions">${actionMarkup}</div>${selectControl}<a class="card-permalink" href="${escapeHtml(item.link)}" ${cardLinkTarget} tabindex="0">${escapeHtml(item.title || item.link)}</a></article>`;
}

function bookmarkActionMarkup(item) {
  const enabled = buttonGroupPreference();
  const link = escapeHtml(item.link);
  const id = escapeHtml(item.id);
  const inTrash = state.view === "trash";
  const action = (name, markup) => enabled[name] ? markup : "";
  return [
    action("current_tab", `<a role="button" href="${link}" title="直接在浏览器打开" aria-label="直接在浏览器打开" data-button="current_tab">${treeIcon("click")}</a>`),
    action("new_tab", `<a role="button" href="${link}" target="_blank" rel="noopener" title="在新标签页中打开" aria-label="在新标签页中打开" data-button="new_tab">${treeIcon("open")}</a>`),
    action("preview", `<a role="button" href="${link}" target="_blank" rel="noopener" title="预览模式" aria-label="预览模式" data-button="preview">${treeIcon("show")}</a>`),
    action("web", `<a role="button" href="${link}" target="_blank" rel="noopener" title="Web 预览模式" aria-label="Web 预览模式" data-button="web">${treeIcon("web")}</a>`),
    action("copy", `<button type="button" title="将链接复制到剪贴板" aria-label="将链接复制到剪贴板" data-button="copy" data-copy-link="${link}">${treeIcon("duplicates")}</button>`),
    action("ask", `<button type="button" title="询问" aria-label="询问" data-button="ask" data-ask="${id}">${treeIcon("ai")}</button>`),
    action("important", `<button type="button" title="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" aria-label="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" data-button="important" data-favorite="${id}">${treeIcon(item.favorite ? "likeActive" : "like")}</button>`),
    action("tags", `<button type="button" title="编辑标签" aria-label="编辑标签" data-button="tags" data-edit="${id}" data-edit-focus="tags">${treeIcon("tag")}</button>`),
    action("edit", `<button type="button" title="编辑" aria-label="编辑" data-button="edit" data-edit="${id}">${treeIcon("edit")}</button>`),
    action("remove", `<button type="button" title="${inTrash ? "恢复" : "删除"}" aria-label="${inTrash ? "恢复" : "删除"}" data-button="${inTrash ? "restore" : "remove"}" ${inTrash ? `data-restore-bookmark="${id}"` : `data-delete="${id}"`}>${treeIcon(inTrash ? "add" : "trash")}</button>`),
  ].join("");
}

function cardActionMenu(item) {
  const id = escapeHtml(item.id);
  const link = escapeHtml(item.link);
  const menuLink = (icon, label, attributes) => `<a role="menuitem" data-card-menu-action href="${link}" ${attributes}>${treeIcon(icon)}<span>${label}</span></a>`;
  const menuButton = (icon, label, attributes) => `<button type="button" role="menuitem" data-card-menu-action ${attributes}>${icon ? treeIcon(icon) : ""}<span>${label}</span></button>`;
  const finalAction = state.view === "trash"
    ? menuButton("add", "恢复", `data-restore-bookmark="${id}"`)
    : menuButton("trash", "删除", `data-button="remove" data-delete="${id}"`);
  return `<div class="card-action-menu" role="menu" data-card-menu-panel data-card-menu-id="${id}">${menuLink("open", "在新标签页中打开", `target="_blank" rel="noopener" data-button="new_tab"`)}${menuLink("web", "Web 预览模式", `target="_blank" rel="noopener" data-button="web"`)}${menuButton("duplicates", "复制链接", `data-button="copy" data-copy-link="${link}"`)}${menuButton("ai", "询问", `data-button="ask" data-ask="${id}"`)}${menuButton("searchTag", "标签", `data-button="tags" data-edit="${id}" data-edit-focus="tags"`)}${menuButton("", "编辑", `data-button="edit" data-edit="${id}"`)}<span class="card-action-separator"></span>${finalAction}</div>`;
}

function bindCardMenuActions(menu) {
  if (!menu) return;
  menu.querySelectorAll("[data-card-menu-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    if (button.dataset.button === "preview" || button.dataset.button === "web") {
      event.preventDefault();
      showError(new TypeError(t("预览功能暂未接入。")));
      closeCardMenu();
      return;
    }
    if (button.dataset.button === "ask") {
      event.preventDefault();
      const edit = [...root.querySelectorAll("[data-edit]")].find((candidate) => candidate.dataset.edit === button.dataset.ask);
      closeCardMenu();
      if (recommendationsEnabled() && edit) return edit.click();
      showError(new TypeError(t("询问功能暂未接入。")));
      return;
    }
    const { copyLink, edit, editFocus, delete: remove, restoreBookmark } = button.dataset;
    closeCardMenu();
    if (copyLink) return navigator.clipboard.writeText(copyLink).catch(showError);
    const proxies = state.cardActionProxies;
    if (edit && proxies?.edit) {
      proxies.edit.dataset.edit = edit;
      proxies.edit.dataset.editFocus = editFocus || "";
      return proxies.edit.click();
    }
    if (remove && proxies?.remove) {
      proxies.remove.dataset.delete = remove;
      return proxies.remove.click();
    }
    if (restoreBookmark && proxies?.restore) {
      proxies.restore.dataset.restoreBookmark = restoreBookmark;
      return proxies.restore.click();
    }
  });
}

function renderCardMenu() {
  const panel = root.querySelector("[data-card-menu-panel]");
  if (!state.cardMenuId) return closeCardMenu();
  const item = sortedItems().find((entry) => entry.id === state.cardMenuId);
  const cards = root.querySelector(".cards");
  if (!item || !cards) return closeCardMenu();
  panel?.remove();
  cards.insertAdjacentHTML("beforeend", cardActionMenu(item));
  root.querySelectorAll("[data-card-menu]").forEach((button) => button.setAttribute("aria-expanded", String(button.dataset.cardMenu === state.cardMenuId)));
  const cardElement = [...root.querySelectorAll("[data-drag-bookmark]")].find((element) => element.dataset.dragBookmark === state.cardMenuId);
  cardElement?.classList.add("card-menu-open");
  bindCardMenuActions(root.querySelector("[data-card-menu-panel]"));
  positionCardMenu();
}

function applyViewFields() {
  const settings = viewSettings();
  const titleView = state.layout === "simple";
  const supportsCoverPosition = state.layout === "list";
  root.querySelector(".cards")?.style.setProperty("--card-cover-size", String(coverSizeValue(settings)));
  root.querySelectorAll(".bookmark-card:not(.collection-trash-card)").forEach((card) => {
    const toggle = (selector, visible) => card.querySelector(selector)?.classList.toggle("view-hidden", !visible);
    toggle(".card-cover", settings.cover);
    toggle(".card-title", settings.title);
    toggle(".card-note", settings.note);
    toggle(".card-description", settings.description);
    toggle(".card-tags", settings.tags);
    card.querySelectorAll(".card-source > section").forEach((section) => {
      if (/\d+\s*条高亮/.test(section.textContent || "")) section.classList.toggle("view-hidden", !settings.highlights);
    });
    toggle(".card-source", settings.metadata);
    card.classList.toggle("cover-hidden", !settings.cover);
    card.classList.toggle("cover-right", supportsCoverPosition && settings.cover && settings.coverPosition === "right");
    card.classList.add("view-fields-custom");
    const detailsVisible = [".card-note", ".card-description", ".card-tags"].some((selector) => {
      const element = card.querySelector(selector);
      return element && !element.classList.contains("view-hidden");
    });
    const rows = [];
    if (settings.title) rows.push("21px");
    if (detailsVisible) rows.push("auto");
    if (settings.metadata) rows.push("21.2891px");
    card.style.setProperty("--card-copy-rows", rows.join(" ") || "1fr");
  });
  applyMasonryCoverSize();
}

function applyMasonryCoverSize() {
  const cards = root.querySelector(".cards.layout-masonry, .cards.layout-grid");
  if (!cards) return;
  const masonry = cards.classList.contains("layout-masonry");
  const width = masonryGridWidth();
  const items = new Map(state.items.map((item) => [item.id, item]));
  cards.style.setProperty("--grid-item-width", `${width}px`);
  cards.querySelectorAll(":scope > .bookmark-card:not(.collection-trash-card)").forEach((card) => {
    card.style.removeProperty("--masonry-cover-ratio");
    const item = items.get(card.dataset.dragBookmark);
    if (!item) return;
    const source = card.querySelector(".card-cover source");
    const image = card.querySelector(".card-cover img");
    const src = masonry ? masonryCoverUrl(item, width) : gridCoverUrl(item, width);
    if (source?.getAttribute("srcset") !== src) source?.setAttribute("srcset", src);
    image?.setAttribute("width", String(width));
    if (image?.getAttribute("src") !== src) {
      image?.addEventListener("load", layoutMasonry, { once: true });
      image?.setAttribute("src", src);
    }
  });
  if (masonry) layoutMasonry();
}

let masonryResizeBound = false;

function layoutMasonry() {
  const cards = root.querySelector(".cards.layout-masonry");
  if (!cards) return;
  const rowHeight = 15;
  const rowGap = 16;
  const items = [...cards.querySelectorAll(":scope > .bookmark-card:not(.collection-trash-card)")];
  items.forEach((item) => item.style.removeProperty("grid-row-end"));
  requestAnimationFrame(() => {
    if (!cards.isConnected || !cards.classList.contains("layout-masonry")) return;
    items.forEach((item) => {
      const height = item.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
      item.style.gridRowEnd = `span ${span}`;
    });
  });
  if (!masonryResizeBound) {
    window.addEventListener("resize", layoutMasonry);
    masonryResizeBound = true;
  }
}

function sidebarMarkup() {
  const items = sidebarItems();
  const tags = tagList(items);
  const total = items.length;
  const duplicates = duplicateLinks(items);
  const typeCounts = items.reduce((counts, item) => counts.set(bookmarkType(item), (counts.get(bookmarkType(item)) || 0) + 1), new Map());
  const quick = (id, icon, label, count, query) => count > 0
    ? `<button class="quick-filter tree-item ${state.query.trim() === query ? "active" : ""}" data-search-query="${escapeHtml(query)}"><span class="tree-expand"></span><span class="tree-icon">${icon === "?" ? "?" : treeIcon(icon)}</span><span class="tree-title">${label}</span>${sidebarCount(count)}</button>`
    : "";
  const nav = (active, icon, label, count, attribute) => `<button class="nav-item tree-item ${active ? "active" : ""}" ${attribute}><span class="tree-expand"></span><span class="tree-icon">${treeIcon(label === "星标" ? "star" : icon)}</span><span class="tree-title">${label}</span>${sidebarCount(count)}</button>`;
  const types = SEARCH_TYPE_OPTIONS.map(([type, label]) => quick(type, type, label, typeCounts.get(type) || 0, `type:${type}`)).join("");
  const allActive = state.view === "all" && !state.collectionId;
  const unsortedActive = state.collectionId === "unsorted";
  const trashActive = state.view === "trash";
  const primaryNav = `<button class="nav-item tree-item ${allActive ? "active" : ""}" data-view="all"><span class="tree-expand"></span><span class="tree-icon">${treeIcon(allActive ? "cloudActive" : "cloud")}</span><span class="tree-title">所有书签</span>${sidebarCount(total)}</button><button class="nav-item tree-item ${unsortedActive ? "active" : ""}" data-collection="unsorted"><span class="tree-expand"></span><span class="tree-icon">${treeIcon(unsortedActive ? "inboxActive" : "inbox")}</span><span class="tree-title">未分类</span>${sidebarCount(state.collectionCounts.unsorted || 0)}</button>${state.trashCount ? `<button class="nav-item tree-item ${trashActive ? "active" : ""}" data-view="trash"><span class="tree-expand"></span><span class="tree-icon">${treeIcon(trashActive ? "trashActive" : "trash")}</span><span class="tree-title">废纸篓</span>${sidebarCount(state.trashCount)}</button>` : ""}`;
  return `<aside class="sidebar"><div class="sidebar-head"><div class="account-wrap"><button type="button" class="account-trigger" data-account-trigger aria-haspopup="menu" aria-expanded="${state.accountMenuOpen}" title="私有书签"><span class="account-mark"><img src="icons/bookmark.svg" width="20" height="20" alt=""></span><span class="account-name">私有书签</span><span class="sidebar-caret">${treeIcon("microArrow")}</span></button>${accountMenuMarkup()}</div><button id="new-collection" class="icon-button" title="新建收藏夹" aria-label="新建收藏夹">${treeIcon("add")}</button></div><nav class="nav"><section class="sidebar-section primary-nav">${primaryNav}</section><section class="sidebar-section collections-section"><div class="sidebar-label"><span>收藏</span><button id="new-collection-secondary" title="新建收藏夹" aria-label="新建收藏夹">${treeIcon("add")}</button></div>${collectionTree()}</section><section class="sidebar-section filters-section"><div class="sidebar-label"><span>快速过滤…</span></div>${quick("favorite", "like", "星标", state.favoriteCount, "important:true")}${quick("notes", "note", "备注", items.filter((item) => item.note).length, "note:true")}${quick("highlights", "highlights", "高亮", items.filter((item) => item.highlights.length).length, "highlights:true")}${quick("reminder", "reminder", "提醒", items.filter((item) => item.reminder).length, "reminder:true")}${types}${quick("duplicates", "duplicates", "重复书签", items.filter((item) => duplicates.has(item.link)).length, "duplicate:true")}${quick("untagged", "tag", "没有标签", items.filter((item) => !item.tags.length).length, "notag:true")}${quick("broken", "broken", "失效链接", items.filter((item) => item.health.status === "broken").length, "broken:true")}${items.some((item) => item.health.status === "unknown") ? nav(state.view === "unknown", "link", "待检查", items.filter((item) => item.health.status === "unknown").length, 'data-view="unknown"') : ""}</section>${tags.length ? `<section class="sidebar-section tag-section"><div class="sidebar-label">标签 (${tags.length})</div>${tags.map(([tag, count]) => `<div class="tag-row"><button class="tag-filter tree-item ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}"><span class="tree-expand"></span><span class="tree-icon">${microIcon("microTag")}</span><span class="tree-title">${escapeHtml(tag)}</span>${sidebarCount(count)}</button><button class="tag-item-menu-trigger" data-tag-item-menu="${escapeHtml(tag)}" title="${escapeHtml(tag)}选项" aria-label="${escapeHtml(tag)}选项" aria-expanded="${state.tagItemMenu === tag}">${treeIcon("moreHorizontal")}</button>${state.tagItemMenu === tag ? `<div class="tag-item-menu" role="menu" data-tag-item-menu-panel><button type="button" role="menuitem" data-tag-item-action="rename" data-tag-value="${escapeHtml(tag)}">重命名标签</button><button type="button" role="menuitem" data-tag-item-action="delete" data-tag-value="${escapeHtml(tag)}">删除标签</button></div>` : ""}</div>`).join("")}</section>` : ""}</nav></aside>`;
}

function accountMenuMarkup() {
  const item = (icon, label, action) => `<button type="button" role="menuitem" data-account-action="${action}">${treeIcon(icon)}<span>${label}</span></button>`;
  return `<div class="account-menu" role="menu" data-account-menu ${state.accountMenuOpen ? "" : "hidden"}>${item("settings", "设置", "settings")}<span class="menu-separator"></span>${item("exit", "注销", "logout")}</div>`;
}

const SETTINGS_NAV = [
  ["app", "应用", "app", true],
  ["account", "帐户", "user", true],
  ["import", "导入", "upload", true],
  ["integrations", "整合方式", "integrations", false],
  ["backups", "备份", "export", true],
  ["pin", "应用锁", "lock", true],
];

const SETTINGS_THEME_OPTIONS = [
  { value: "light", label: "浅色", sidebar: "day", main: "day" },
  { value: "dark", label: "深色", sidebar: "night", main: "night" },
  { value: "auto", label: "跟随系统", sidebar: "night", main: "day" },
  { value: "sunset", label: "日落", sidebar: "sunset", main: "sunset" },
];

const LANGUAGE_OPTIONS = [
  { value: "zh-Hans", label: "中文（简体）" },
  { value: "en", label: "English" },
];

function settingsPreference(key, fallback) {
  const value = state.preferences?.[key];
  return value == null ? fallback : value;
}

function buttonGroupPreference() {
  const value = settingsPreference("buttonGroup", {});
  return { ...DEFAULT_BUTTON_GROUP, ...(value && typeof value === "object" ? value : {}) };
}

function buttonGroupEnabled(name) {
  return buttonGroupPreference()[name] !== false;
}

function settingsControlMarkup(key, value, options, icon = "") {
  const selectionOnly = key === "brokenLinks";
  const currentValue = selectionOnly ? settingsPreference("brokenLevel", "default") : value;
  const current = options.find((option) => option.value === currentValue) || options[0];
  const open = state.settingsMenu === key;
  const labelFor = (option) => selectionOnly && option.value === "off"
    ? languageIsEnglish() ? "Disable" : "关闭"
    : key === "language" ? option.label : t(option.label);
  const optionMarkup = (option) => {
    const selected = option.value === current.value;
    const prefix = key === "language"
      ? `<span class="settings-dropdown-check">${selected ? treeIcon("check") : ""}</span>`
      : selectionOnly
        ? `<span class="settings-dropdown-selection">${selected ? treeIcon("check") : treeIcon("blank")}</span>`
      : icon ? `<span class="settings-dropdown-selection">${selected ? treeIcon("check") : treeIcon("blank")}</span>${treeIcon(icon)}` : "";
    return `<button type="button" role="option" aria-selected="${selected}" class="settings-dropdown-option ${key === "language" ? "settings-language-option" : ""}" data-settings-option="${key}" data-settings-value="${escapeHtml(option.value)}">${prefix}<span>${escapeHtml(labelFor(option))}</span></button>`;
  };
  const menu = open ? `<div class="settings-dropdown" role="listbox" data-settings-menu="${key}">${options.map(optionMarkup).join("")}</div>` : "";
  return `<div class="settings-control-wrap"><button type="button" class="settings-outline-button" data-settings-select="${key}" aria-haspopup="listbox" aria-expanded="${open}">${icon ? treeIcon(icon) : ""}<span>${escapeHtml(labelFor(current))}</span><span class="settings-control-arrow">${treeIcon("microArrow")}</span></button>${menu}</div>`;
}

function settingsThemeMarkup(theme) {
  return SETTINGS_THEME_OPTIONS.map((option) => `<button type="button" class="settings-theme-option ${theme === option.value ? "active" : ""}" data-settings-theme="${option.value}" aria-pressed="${theme === option.value}" aria-label="${t(option.label)}" title="${t(option.label)}"><span class="settings-theme-preview" data-sidebar-theme="${option.sidebar}" data-main-theme="${option.main}" aria-hidden="true"><span class="settings-theme-sidebar"></span><span class="settings-theme-main">${Array.from({ length: 5 }, () => "<span></span>").join("")}</span></span></button>`).join("");
}

function settingsButtonGroupMarkup() {
  const buttonGroup = buttonGroupPreference();
  if (state.settingsMenu === "buttonGroup") {
    const selectedCount = BUTTON_GROUP_OPTIONS.filter(([value]) => buttonGroup[value]).length;
    return `<div class="settings-button-group-menu" data-settings-menu="buttonGroup">${BUTTON_GROUP_OPTIONS.map(([value, label, icon]) => `<label class="settings-button-option"><input type="checkbox" data-settings-button-option="${value}" ${buttonGroup[value] ? "checked" : ""} ${selectedCount >= 5 && !buttonGroup[value] ? "disabled" : ""}><span class="settings-button-option-icon">${treeIcon(icon)}</span><span>${escapeHtml(t(label))}</span></label>`).join("")}</div>`;
  }
  const selected = BUTTON_GROUP_OPTIONS.filter(([value]) => buttonGroup[value]);
  return `<button type="button" class="settings-outline-button settings-button-group" data-settings-button-group aria-expanded="false" aria-label="按钮组" title="按钮组" style="--button-count:${selected.length}">${selected.map(([, , icon]) => treeIcon(icon)).join("")}${treeIcon("microExpand")}</button>`;
}

function accountEndpoint() {
  const endpoint = state.connectionInfo?.endpoint || "";
  try { return new URL(endpoint).origin; } catch { return endpoint || "—"; }
}

function accountSettingsMarkup() {
  const bookmarks = Array.isArray(state.allItems) ? state.allItems.length : state.items.length;
  const collections = Math.max(0, state.collections.filter((item) => item.id !== "unsorted").length);
  const trash = Number(state.trashCount) || 0;
  const mediaLabel = state.mediaUploadEnabled ? "已启用" : "未配置";
  const instanceName = settingsPreference("instanceName", "私有书签");
  return `<div class="settings-content"><div class="settings-grid settings-account-grid">
    <div class="settings-label">实例名称</div>
    <label class="settings-account-input-wrap"><input type="text" maxlength="200" value="${escapeHtml(instanceName)}" data-account-instance-name autocomplete="off"></label>
    <div class="settings-label">实例地址</div>
    <label class="settings-account-input-wrap"><input type="text" value="${escapeHtml(accountEndpoint())}" readonly aria-readonly="true"></label>
    <div class="settings-label">访问密钥</div>
    <div class="settings-account-value settings-account-muted">已配置（仅存储在此设备）</div>
    <div class="settings-label">头像</div>
    <div class="settings-account-avatar-row"><span class="settings-account-avatar">${treeIcon("user")}</span><span class="settings-account-muted">固定实例图标</span></div>
    <div class="settings-separator"></div>
    <div class="settings-label">认证方式</div>
    <div class="settings-account-value"><span class="settings-account-inline-icon">${treeIcon("lock")}</span><span>访问密钥认证</span></div>
    <div class="settings-label">实例类型</div>
    <div class="settings-account-value">自托管实例</div>
    <div class="settings-label">数据统计</div>
    <div class="settings-account-stat-list"><div class="settings-account-stat"><span>书签数量</span><strong>${bookmarks}</strong></div><div class="settings-account-stat"><span>收藏夹数量</span><strong>${collections}</strong></div><div class="settings-account-stat"><span>废纸篓项目数</span><strong>${trash}</strong></div></div>
    <div class="settings-label">媒体上传</div>
    <div class="settings-account-value settings-account-muted">${mediaLabel}</div>
    <div class="settings-separator"></div>
    <span></span>
    <div class="settings-account-action-list"><button type="button" class="settings-account-action" data-account-settings-action="disconnect">${treeIcon("exit")}<span>断开当前设备</span></button></div>
  </div></div>`;
}

function importCollectionPath(path) {
  return Array.isArray(path) ? path.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20) : [];
}

function importInvalidLabel(item, format) {
  const reason = { "invalid-url": "无效 URL", "missing-url": "缺少源链接", "invalid-enex": "无效 ENEX 文件", "missing-url-header": "缺少 URL 列", "malformed-csv": "CSV 格式错误" }[item.reason] || "无法解析";
  const position = Number.isInteger(item.index) ? (format === "enex" ? ` · 第 ${item.index + 1} 条笔记` : ` · 第 ${item.index + 1} 行`) : item.line ? ` · 第 ${item.line} 行` : "";
  return `${reason}${position}`;
}

function importPreviewMarkup(preview) {
  if (!preview) return "";
  if (preview.status) return `<p class="settings-import-status">${escapeHtml(preview.status)}</p>`;
  if (preview.kind === "backup") {
    const count = Array.isArray(preview.backup?.bookmarks) ? preview.backup.bookmarks.length : 0;
    return `<section class="settings-import-preview">${preview.error ? `<p class="settings-import-error">${escapeHtml(preview.error)}</p>` : ""}<div class="settings-import-preview-head"><strong>恢复私有书签备份</strong><span>${count} 个书签</span></div><p class="settings-import-warning">备份会替换整个资料库。执行前会自动下载当前快照。</p><div class="settings-import-actions"><button type="button" class="primary settings-import-action" data-import-restore ${state.importBusy ? "disabled" : ""}>${state.importBusy ? "正在导入…" : "恢复私有书签备份"}</button><button type="button" class="settings-import-clear" data-import-clear ${state.importBusy ? "disabled" : ""}>清除</button></div></section>`;
  }
  const selectedItems = importSelectedItems(preview) || [];
  const valid = selectedItems.length;
  const duplicates = Number(preview.duplicates) || 0;
  const invalid = Array.isArray(preview.invalid) ? preview.invalid.length : 0;
  const disabled = state.importBusy || !valid;
  const resumed = Array.isArray(preview.pendingItems);
  const progress = preview.progress;
  return `<section class="settings-import-preview">${preview.error ? `<p class="settings-import-error">${escapeHtml(preview.error)}</p>` : ""}<div class="settings-import-preview-head"><strong>导入预览</strong><span>${escapeHtml(preview.name || "")}</span></div><div class="settings-import-stats"><span><strong>${valid}</strong> 有效书签</span><span><strong>${duplicates}</strong> 重复书签</span><span><strong>${invalid}</strong> 无效项目</span></div>${progress?.completed ? `<p class="settings-import-progress">已导入 ${progress.completed} / ${progress.total}，剩余 ${valid}</p>` : ""}${invalid ? `<details class="settings-import-invalid"><summary>查看无效项目</summary><ul>${preview.invalid.slice(0, 20).map((item) => `<li>${escapeHtml(importInvalidLabel(item, preview.format))}</li>`).join("")}</ul></details>` : ""}<label class="settings-import-check"><input type="checkbox" data-import-skip-duplicates ${preview.skipDuplicates !== false ? "checked" : ""} ${resumed || state.importBusy ? "disabled" : ""}>跳过重复项目</label><div class="settings-import-actions"><button type="button" class="primary settings-import-action" data-import-submit ${disabled ? "disabled" : ""}>${state.importBusy ? "正在导入…" : `导入这些书签 (${valid})`}</button><button type="button" class="settings-import-clear" data-import-clear ${state.importBusy ? "disabled" : ""}>清除</button></div></section>`;
}

function importSettingsMarkup() {
  return `<div class="settings-content settings-import-content"><div class="settings-grid settings-import-grid"><div class="settings-label">档案</div><div><div class="settings-import-alert"><strong>上传书签文件 (html、csv、txt 或 enex)</strong>.<br>你可以从浏览器或服务的“导出书签”部分得到这个文件<br><br><a href="https://help.raindrop.io/import#supported-formats" target="_blank" rel="noopener">帮助 ${microIcon("microOpen")}</a></div><label class="settings-import-upload button primary" data-import-upload role="button" tabindex="0" aria-label="上传文件…">${treeIcon("upload")}<span>上传文件…</span><input type="file" class="hidden" data-import-file accept="application/json,text/html,text/csv,text/plain,application/enex+xml,application/xml,text/xml,.json,.html,.htm,.csv,.txt,.enex"></label>${importPreviewMarkup(state.importPreview)}</div></div></div>`;
}

function backupFileName(item, format) {
  const date = new Date(item.createdAt || Date.now()).toISOString().slice(0, 10);
  return `私有书签-${date}.${format}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function backupCsv(backup) {
  const rows = [["标题", "网址", "收藏夹", "标签", "备注", "创建日期"]];
  const collections = new Map((backup.collections || []).map((item) => [item.id, item.name]));
  for (const item of backup.bookmarks || []) rows.push([item.title || item.link, item.link, collections.get(item.collectionId) || "未分类", (item.tags || []).join(", "), item.note || "", item.createdAt || ""]);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function backupHtml(backup) {
  const collections = new Map((backup.collections || []).map((item) => [item.id, item.name]));
  const groups = [...new Set((backup.bookmarks || []).map((item) => collections.get(item.collectionId) || "未分类"))];
  const body = groups.map((name) => `<DT><H3>${escapeHtml(name)}</H3>\n<DL><p>\n${(backup.bookmarks || []).filter((item) => (collections.get(item.collectionId) || "未分类") === name).map((item) => `<DT><A HREF="${escapeHtml(item.link)}">${escapeHtml(item.title || item.link)}</A>`).join("\n")}\n</DL><p>`).join("\n");
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>私有书签备份</TITLE>\n<H1>私有书签备份</H1>\n<DL><p>\n${body}\n</DL><p>\n`;
}

function downloadBackupFile(item, format = "json") {
  const content = format === "csv" ? backupCsv(item.backup) : format === "html" ? backupHtml(item.backup) : JSON.stringify(item.backup, null, 2);
  const type = format === "csv" ? "text/csv;charset=utf-8" : format === "html" ? "text/html;charset=utf-8" : "application/json";
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: backupFileName(item, format) });
  document.body.append(link);
  link.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
}

function backupMeta(item) {
  const backup = item?.backup?.format === "private-bookmarks/v1" ? item.backup : null;
  return {
    ...item,
    backup,
    createdAt: item?.createdAt || item?.created_at || backup?.exportedAt || "",
    status: item?.status || "ready",
    source: item?.source || "manual",
    size: Number(item?.size ?? item?.libraryBytes ?? 0),
    includeMedia: Boolean(item?.includeMedia ?? item?.include_media),
    mediaCopied: Boolean(item?.mediaCopied ?? item?.media_copied),
    mediaCount: Number(item?.mediaCount ?? item?.media_count ?? 0),
  };
}

function formatBackupSize(value) {
  const size = Number(value) || 0;
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function backupStatusLabel(item) {
  const status = backupMeta(item).status;
  return status === "ready" ? "已完成" : status === "failed" ? "失败" : "处理中";
}

function backupHistoryMarkup() {
  if (state.backupLoading) return `<p class="settings-backup-empty">正在加载备份历史…</p>`;
  if (!state.backups.length) return `<p class="settings-backup-empty">${t("没有历史备份")}</p>`;
  return state.backups.map((raw) => {
    const item = backupMeta(raw);
    const server = state.backupSource === "server" && !item.backup;
    const mediaLabel = item.includeMedia ? (item.mediaCopied ? `媒体 ${item.mediaCount || "已包含"}` : "媒体清单") : "不含媒体";
    const details = [backupStatusLabel(item), formatBackupSize(item.size), mediaLabel].filter(Boolean).join(" · ");
    return `<div class="settings-backup-row"><span class="settings-backup-row-icon">${treeIcon(item.status === "ready" ? "backupReady" : "backup")}</span><span class="settings-backup-date"><strong>${escapeHtml(dateTimeLabel(item.createdAt))}</strong><small>${escapeHtml(details)}</small></span><span class="settings-backup-row-actions"><button type="button" data-backup-download="${escapeHtml(item.id)}" data-backup-format="json">${t("下载 JSON")}</button><button type="button" data-backup-download="${escapeHtml(item.id)}" data-backup-format="html">HTML</button><button type="button" data-backup-download="${escapeHtml(item.id)}" data-backup-format="csv">CSV</button>${server ? `<button type="button" data-backup-archive="${escapeHtml(item.id)}">ZIP</button><button type="button" data-backup-restore-server="${escapeHtml(item.id)}">恢复</button><button type="button" class="danger" data-backup-delete="${escapeHtml(item.id)}">删除</button>` : ""}</span></div>`;
  }).join("");
}

function cloudBackupHistoryMarkup(provider) {
  if (state.cloudBackupLoading[provider]) return `<p class="settings-backup-empty">正在加载远程备份…</p>`;
  const error = state.cloudBackupErrors[provider];
  if (error) return `<p class="settings-cloud-error">远程备份加载失败：${escapeHtml(error.message || "请稍后重试")} <button type="button" data-cloud-refresh="${provider}">重试</button></p>`;
  const backups = state.cloudBackups[provider] || [];
  if (!backups.length) return `<p class="settings-backup-empty">没有远程备份</p>`;
  const disabled = state.cloudBusy || state.backupBusy ? "disabled" : "";
  return `<div class="settings-backup-list">${backups.map((item) => {
    const details = [dateTimeLabel(item.createdAt), formatBackupSize(item.size), item.encrypted ? "加密" : "明文兼容"].filter(Boolean).join(" · ");
    return `<div class="settings-backup-row"><span class="settings-backup-row-icon">${treeIcon(item.encrypted ? "backupReady" : "backup")}</span><span class="settings-backup-date"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(details)}</small></span><span class="settings-backup-row-actions"><button type="button" data-cloud-backup-download="${escapeHtml(item.id)}" data-cloud-backup-provider="${provider}" ${disabled}>下载 ZIP</button><button type="button" data-cloud-backup-restore="${escapeHtml(item.id)}" data-cloud-backup-provider="${provider}" ${disabled}>恢复</button><button type="button" class="danger" data-cloud-backup-delete="${escapeHtml(item.id)}" data-cloud-backup-provider="${provider}" ${disabled}>删除</button></span></div>`;
  }).join("")}</div>`;
}

function backupSettingsMarkup() {
  const disabled = state.backupBusy || state.backupLoading ? "disabled" : "";
  const cloudMessage = state.backupSource === "server"
    ? "本实例 R2 云备份已启用。备份历史保存在私有实例，不依赖当前浏览器。"
    : state.backupSource === "error"
      ? `服务端备份暂时失败：${state.backupError?.message || "请稍后重试"}`
      : "服务端备份接口暂不可用，当前显示的是此浏览器中的本地快照。";
  const archiveDisabled = disabled || state.backupSource !== "server" || !state.backups.length ? "disabled" : "";
  const mediaDisabled = disabled || state.backupSource !== "server" ? "disabled" : "";
  const cloudOption = (provider, label, icon) => {
    const item = state.cloudConnections.find((entry) => entry.provider === provider) || {};
    const status = !item.configured ? "待配置" : item.connected ? "上传备份" : "连接";
    const actionDisabled = disabled || state.cloudBusy || !item.configured ? "disabled" : "";
    return `<div class="settings-cloud-provider"><div class="settings-cloud-option-row"><button type="button" class="settings-cloud-option" data-cloud-action="${provider}" ${actionDisabled} title="${item.connected ? "创建并上传备份" : item.configured ? "连接云盘" : "需要配置 OAuth 客户端凭据"}">${treeIcon(icon)}<span>${label}</span><small>${status}</small></button>${item.connected ? `<button type="button" class="settings-cloud-disconnect" data-cloud-disconnect="${provider}" ${disabled}>断开</button>` : ""}</div>${item.connected ? `<div class="settings-cloud-backups">${cloudBackupHistoryMarkup(provider)}</div>` : ""}</div>`;
  };
  return `<div class="settings-content settings-backup-content"><div class="settings-grid settings-backup-grid"><div class="settings-label">备份</div><div><div class="settings-backup-alert"><strong>永远不用担心数据丢失。创建服务端快照，保存收藏夹、书签、标签和高亮。</strong><p>${cloudMessage}</p></div><p class="settings-backup-muted settings-backup-media-note">勾选后会把本实例已上传的媒体文件一并复制到备份，外部网址媒体不会被下载。</p><label class="settings-backup-media-toggle"><input type="checkbox" data-backup-include-media ${state.backupIncludeMedia ? "checked" : ""} ${mediaDisabled}>包含已上传媒体文件</label><div class="settings-backup-actions"><button type="button" class="primary" data-backup-create ${disabled}>${treeIcon("add")}<span>${state.backupBusy ? "备份正在创建" : t("创建新的备份")}</span></button><button type="button" class="settings-outline-button" data-backup-download-current ${disabled}>${treeIcon("download")}<span>${t("下载完整备份")}</span></button><button type="button" class="settings-outline-button" data-backup-download-archive ${archiveDisabled} title="下载包含媒体文件的 ZIP 备份">${treeIcon("download")}<span>${t("下载上传文件")}</span></button><button type="button" class="settings-outline-button" data-backup-restore>${treeIcon("upload")}<span>${t("恢复备份")}</span></button></div><section class="settings-backup-section"><h2>${t("历史备份")}</h2><div class="settings-backup-list">${backupHistoryMarkup()}</div></section><section class="settings-backup-section settings-backup-cloud"><h2>${t("云备份")}</h2><p class="settings-backup-muted">${cloudMessage}</p><div class="settings-cloud-options">${cloudOption("dropbox", "Dropbox", "dropbox")}${cloudOption("google", "Google Drive", "gdrive")}${cloudOption("onedrive", "OneDrive", "onedrive")}</div></section></div></div></div>`;
}

async function refreshBackups({ silent = false } = {}) {
  state.backupLoading = true;
  try {
    const response = await api("/v1/backups");
    const list = Array.isArray(response) ? response : response?.backups;
    if (!Array.isArray(list)) throw new TypeError("备份历史响应格式无效");
    state.backups = list;
    state.backupSource = "server";
    state.backupError = null;
    return list;
  } catch (error) {
    if (![404, 501].includes(error?.status)) {
      state.backupError = error;
      if (!silent) throw error;
      state.backupSource = "error";
      return state.backups;
    }
    state.backupSource = "local";
    state.backups = readBackupHistory();
    return state.backups;
  } finally {
    state.backupLoading = false;
  }
}

async function refreshCloudConnections({ silent = true } = {}) {
  try {
    const response = await api("/v1/cloud/connections");
    state.cloudConnections = Array.isArray(response) ? response : [];
  } catch (error) {
    state.cloudConnections = [];
    if (!silent) throw error;
  }
  return state.cloudConnections;
}

async function refreshCloudBackups({ silent = true } = {}) {
  const connected = new Set(state.cloudConnections.filter((item) => item.connected).map((item) => item.provider));
  await Promise.all(["dropbox", "google", "onedrive"].map(async (provider) => {
    if (!connected.has(provider)) {
      state.cloudBackups[provider] = [];
      delete state.cloudBackupErrors[provider];
      return;
    }
    state.cloudBackupLoading[provider] = true;
    try {
      const response = await api(`/v1/cloud/${provider}/backups`);
      if (!Array.isArray(response?.backups)) throw new TypeError("远程备份响应格式无效");
      state.cloudBackups[provider] = response.backups;
      delete state.cloudBackupErrors[provider];
    } catch (error) {
      state.cloudBackupErrors[provider] = error;
      if (!silent) throw error;
    } finally {
      state.cloudBackupLoading[provider] = false;
    }
  }));
  return state.cloudBackups;
}

async function refreshBackupSettings() {
  await Promise.all([refreshBackups({ silent: true }), refreshCloudConnections()]);
  await refreshCloudBackups({ silent: true });
}

function localBackupSnapshot(backup) {
  return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString(), backup };
}

async function createBackup() {
  if (state.backupBusy) return;
  state.backupBusy = true;
  renderSettings();
  try {
    try {
      await api("/v1/backups", { method: "POST", body: JSON.stringify({ includeMedia: state.backupIncludeMedia }) });
      state.backupSource = "server";
      await refreshBackups({ silent: true });
    } catch (error) {
      if (![404, 501].includes(error?.status)) throw error;
      state.backupIncludeMedia = false;
      const backup = await api("/v1/export");
      const item = localBackupSnapshot(backup);
      const next = [item, ...readBackupHistory().filter((entry) => entry.id !== item.id)].slice(0, 5);
      if (!persistBackupHistory(next)) {
        downloadBackupFile(item, "json");
        throw new TypeError("浏览器存储空间不足，备份已下载到本地");
      }
      state.backups = next;
      state.backupSource = "local";
    }
  } catch (error) {
    showError(error);
  } finally {
    state.backupBusy = false;
    renderSettings();
  }
}

async function downloadServerBackup(item, format) {
  const payload = await api(`/v1/backups/${encodeURIComponent(item.id)}/download`);
  const backup = payload?.backup || payload?.library || payload;
  if (backup?.format !== "private-bookmarks/v1") throw new TypeError("服务端备份内容无效");
  downloadBackupFile({ ...item, backup }, format);
}

async function downloadServerBackupArchive(item) {
  const config = await connection();
  if (!config) throw new TypeError("请先连接私有实例");
  const response = await fetch(`${config.endpoint}/v1/backups/${encodeURIComponent(item.id)}/download?format=zip`, { headers: { "x-private-bookmarks-key": config.key } });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* keep generic error */ }
    throw Object.assign(new Error(payload.message || "备份下载失败"), { status: response.status, code: payload.code });
  }
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: `私有书签-${new Date(item.createdAt || Date.now()).toISOString().slice(0, 10)}.zip` });
  document.body.append(link); link.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
}

async function downloadBackupItem(item, format) {
  if (item.backup?.format === "private-bookmarks/v1") return downloadBackupFile(item, format);
  return downloadServerBackup(item, format);
}

async function restoreServerBackup(id) {
  if (!window.confirm("要用此云端备份替换整个书签资料库吗？服务端会先创建当前快照。")) return;
  state.backupBusy = true;
  renderSettings();
  try {
    await api(`/v1/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) });
    window.alert("备份已恢复，页面将刷新。");
    await load();
  } finally {
    state.backupBusy = false;
    renderSettings();
  }
}

async function deleteServerBackup(id) {
  if (!window.confirm("确定删除这份云端备份吗？删除后无法恢复。")) return;
  state.backupBusy = true;
  renderSettings();
  try {
    await api(`/v1/backups/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshBackups({ silent: true });
  } finally {
    state.backupBusy = false;
    renderSettings();
  }
}

async function downloadCloudBackup(provider, id) {
  const config = await connection();
  if (!config) throw new TypeError("请先连接私有实例");
  const response = await fetch(`${config.endpoint}/v1/cloud/${provider}/backups/${encodeURIComponent(id)}/download`, { headers: { "x-private-bookmarks-key": config.key } });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* keep generic error */ }
    throw Object.assign(new Error(payload.message || "云备份下载失败"), { status: response.status, code: payload.code });
  }
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: "私有书签-云备份.zip" });
  document.body.append(link); link.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
}

async function restoreCloudBackup(provider, id) {
  if (!window.confirm("要用此云端备份替换整个书签资料库吗？服务端会先创建当前快照。")) return;
  state.cloudBusy = true;
  renderSettings();
  try {
    await api(`/v1/cloud/${provider}/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) });
    window.alert("云备份已恢复，页面将刷新。");
    await load();
  } finally {
    state.cloudBusy = false;
    renderSettings();
  }
}

async function deleteCloudBackup(provider, id) {
  if (!window.confirm("确定删除这份第三方云盘备份吗？删除后无法恢复。")) return;
  state.cloudBusy = true;
  renderSettings();
  try {
    await api(`/v1/cloud/${provider}/backups/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshCloudBackups({ silent: true });
  } finally {
    state.cloudBusy = false;
    renderSettings();
  }
}

async function cloudAction(provider) {
  if (state.cloudBusy) return;
  const item = state.cloudConnections.find((entry) => entry.provider === provider);
  state.cloudBusy = true;
  renderSettings();
  try {
    if (!item?.connected) {
      const result = await api(`/v1/cloud/${provider}/authorize`);
      if (!result.authorizationUrl) throw new TypeError("OAuth 授权地址不可用");
      window.open(result.authorizationUrl, "_blank", "noopener");
      return;
    }
    await api(`/v1/cloud/${provider}/backups`, { method: "POST", body: JSON.stringify({ includeMedia: state.backupIncludeMedia }) });
    window.alert(`${provider} 云备份已上传`);
  } finally {
    state.cloudBusy = false;
    await Promise.all([refreshCloudConnections(), refreshBackups({ silent: true })]);
    await refreshCloudBackups({ silent: true });
    renderSettings();
  }
}

async function disconnectCloud(provider) {
  if (!window.confirm("断开此云盘连接吗？已上传的备份不会删除。")) return;
  state.cloudBusy = true;
  renderSettings();
  try { await api(`/v1/cloud/${provider}/disconnect`, { method: "POST", body: "{}" }); }
  finally { state.cloudBusy = false; await refreshCloudConnections(); await refreshCloudBackups({ silent: true }); renderSettings(); }
}

async function downloadCurrentBackup() {
  if (state.backupBusy) return;
  state.backupBusy = true;
  renderSettings();
  try {
    const backup = await api("/v1/export");
    downloadBackupFile({ createdAt: new Date().toISOString(), backup }, "json");
  } catch (error) {
    showError(error);
  } finally {
    state.backupBusy = false;
    renderSettings();
  }
}

function importLinkKey(value) {
  try { return canonicalImportLink(value); } catch { return String(value || "").trim(); }
}

function importCollectionCache() {
  const cache = new Map();
  for (const collection of state.collections) {
    if (collection.id !== "unsorted") cache.set(`${collection.parentId || ""}\u0000${collection.name}`, collection.id);
  }
  return cache;
}

async function ensureImportCollection(path, cache) {
  const names = importCollectionPath(path);
  if (!names.length) return "unsorted";
  let parentId = null;
  for (const name of names) {
    const key = `${parentId || ""}\u0000${name}`;
    let id = cache.get(key);
    if (!id) {
      try {
        const created = await api("/v1/collections", { method: "POST", body: JSON.stringify({ name, parentId }) });
        state.collections.push(created);
        id = created.id;
      } catch (error) {
        if (error?.status) throw error;
        // A lost POST response may still have created the collection. Reuse it before retrying.
        try {
          const collections = await api("/v1/collections");
          const existing = collections.find((item) => item.parentId === parentId && item.name === name && !item.deletedAt);
          if (!existing) throw error;
          state.collections = [...state.collections.filter((item) => item.id !== existing.id), existing];
          id = existing.id;
        } catch {
          throw error;
        }
      }
      cache.set(key, id);
    }
    parentId = id;
  }
  return parentId;
}

function importSelectedItems(preview) {
  if (Array.isArray(preview?.pendingItems)) return preview.pendingItems;
  return preview?.skipDuplicates === false ? preview.candidates : preview?.items;
}

function importCandidates(parsed, name) {
  const existing = new Set(state.allItems.map((item) => importLinkKey(item.link)).filter(Boolean));
  const seen = new Set();
  const items = [];
  const candidates = [];
  let duplicates = 0;
  for (const item of parsed.items || []) {
    const link = importLinkKey(item.link);
    if (!link) continue;
    const resources = Array.isArray(item.resources)
      ? item.resources.map((resource) => ({ ...resource, id: resource.id || crypto.randomUUID() }))
      : undefined;
    const candidate = { ...item, link, id: crypto.randomUUID(), ...(resources ? { resources } : {}) };
    candidates.push(candidate);
    if (existing.has(link) || seen.has(link)) {
      duplicates += 1;
      continue;
    }
    seen.add(link);
    items.push(candidate);
  }
  return { kind: "bookmarks", name, format: parsed.format, items, candidates, invalid: parsed.invalid || [], duplicates, skipDuplicates: true };
}

function importResourceBytes(resource) {
  if (resource?.error) throw new TypeError(resource.error);
  const value = String(resource?.data || "").replace(/\s+/g, "");
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new TypeError("附件数据无效");
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError("附件数据无效");
  }
}

async function uploadImportResource(resource) {
  if (resource?.url) return resource.url;
  if (!state.mediaUploadEnabled) throw new TypeError("导入附件需要配置 R2");
  if (!resource.id) resource.id = crypto.randomUUID();
  const bytes = importResourceBytes(resource);
  const result = await api("/v1/media", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": resource.mime,
      "x-private-bookmarks-kind": "attachment",
      "x-private-bookmarks-name": encodeURIComponent(resource.name || "attachment"),
      "x-private-bookmarks-id": resource.id,
    },
  });
  const url = httpUrl(result?.url);
  if (!url) throw new TypeError("附件上传后没有返回有效地址");
  resource.url = url;
  return url;
}

async function prepareImportFile(file) {
  if (!file) return;
  state.importPreview = { status: "正在解析…" };
  renderSettings();
  try {
    const text = await file.text();
    if (/\.json$/i.test(file.name) || file.type === "application/json") {
      const backup = JSON.parse(text);
      if (backup?.format !== "private-bookmarks/v1") throw new TypeError("这不是私有书签备份文件");
      state.importPreview = { kind: "backup", name: file.name, backup };
    } else {
      state.importPreview = importCandidates(parseImportText(text, { name: file.name, type: file.type }), file.name);
    }
    persistImportProgress(state.importPreview);
  } catch (error) {
    state.importPreview = { error: error.message || "无法解析此文件" };
    persistImportProgress(state.importPreview);
  }
  renderSettings();
}

function clearImportPreview() {
  if (state.importBusy) return;
  state.importPreview = null;
  persistImportProgress(null);
  renderSettings();
}

async function restoreImportBackup() {
  const preview = state.importPreview;
  if (!preview?.backup || state.importBusy) return;
  if (!window.confirm("要用此备份替换整个书签资料库吗？执行前会先下载当前快照。")) return;
  state.importBusy = true;
  renderSettings();
  try {
    downloadBackup(await api("/v1/export"));
    await api("/v1/restore", { method: "POST", body: JSON.stringify({ confirm: true, backup: preview.backup }) });
    state.importPreview = null;
    persistImportProgress(null);
    await load();
  } catch (error) {
    state.importPreview = { ...preview, error: error.message || "恢复备份失败" };
    persistImportProgress(state.importPreview);
  } finally {
    state.importBusy = false;
    renderSettings();
  }
}

async function submitImport() {
  const preview = state.importPreview;
  if (!preview || state.importBusy) return;
  const skipDuplicates = root.querySelector("[data-import-skip-duplicates]")?.checked !== false;
  const source = Array.isArray(preview.pendingItems) ? preview.pendingItems : (skipDuplicates ? preview.items : preview.candidates);
  if (!source?.length) return;
  const total = preview.progress?.total || source.length;
  let completed = preview.progress?.completed || 0;
  state.importBusy = true;
  state.importPreview = { ...preview, skipDuplicates, pendingItems: source, progress: { completed, total }, error: "" };
  persistImportProgress(state.importPreview);
  renderSettings();
  try {
    const cache = importCollectionCache();
    for (let index = 0; index < source.length; index += 100) {
      const batch = [];
      for (const item of source.slice(index, index + 100)) {
        const collectionId = await ensureImportCollection(item.collectionPath, cache);
        const { resources, collectionPath, ...bookmark } = item;
        const existingMedia = Array.isArray(bookmark.media) ? bookmark.media.filter((value) => typeof value === "string") : [];
        const uploadable = Array.isArray(resources) ? resources.slice(0, Math.max(0, 9 - existingMedia.length)) : [];
        for (const resource of uploadable) existingMedia.push(await uploadImportResource(resource));
        batch.push({ ...bookmark, media: existingMedia.slice(0, 9), collectionId });
      }
      await api("/v1/import", { method: "POST", body: JSON.stringify({ items: batch }) });
      completed += batch.length;
      state.importPreview = { ...state.importPreview, pendingItems: source.slice(index + batch.length), progress: { completed, total }, error: "" };
      persistImportProgress(state.importPreview);
      if (state.importPreview.pendingItems.length) renderSettings();
    }
    state.importPreview = null;
    persistImportProgress(null);
    await load();
  } catch (error) {
    state.importPreview = { ...state.importPreview, error: error.message || "导入失败" };
    persistImportProgress(state.importPreview);
  } finally {
    state.importBusy = false;
    renderSettings();
  }
}

function settingsAppMarkup() {
  const theme = themeOption().value;
  const defaultView = validLayout(settingsPreference("defaultView", "list")) || "list";
  const bookmarkClick = settingsPreference("bookmarkClick", "new_tab");
  const tagSort = settingsPreference("tagSort", "name");
  const searchRelevance = settingsPreference("searchRelevance", true);
  const viewOptions = VIEW_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
  const clickOptions = [{ value: "new_tab", label: "在新标签页中打开" }, { value: "current_tab", label: "在当前标签页中打开" }];
  const brokenLinkOptions = [
    { value: "basic", label: "基础模式" },
    { value: "default", label: "默认模式" },
    { value: "strict", label: "严格模式" },
    { value: "off", label: "关闭" },
  ];
  const language = settingsPreference("language", "zh-Hans");
  const localRecommendations = settingsPreference("recommendCollectionsTags", false);
  const aiRecommendations = settingsPreference("aiRecommendations", false);
  const aiClass = state.aiRecommendationsAvailable ? "settings-check" : "settings-check settings-disabled";
  return `<div class="settings-content"><div class="settings-grid"><div class="settings-label">语言</div><div>${settingsControlMarkup("language", language, LANGUAGE_OPTIONS)}</div><div class="settings-label">界面样式</div><div class="settings-theme-picker" role="group" aria-label="界面样式">${settingsThemeMarkup(theme)}</div><div class="settings-label">字体大小</div><div><label class="settings-check"><input type="checkbox" data-settings-toggle="largeFont" ${settingsPreference("largeFont", false) ? "checked" : ""}>大</label></div><div class="settings-separator"></div><div class="settings-label">默认视图模式</div><div>${settingsControlMarkup("defaultView", defaultView, viewOptions, "viewGrid")}</div><div class="settings-label">点击书签时</div><div>${settingsControlMarkup("bookmarkClick", bookmarkClick, clickOptions)}</div><div class="settings-label">按钮组</div><div>${settingsButtonGroupMarkup()}</div><div class="settings-label">搜索</div><div><label class="settings-check settings-search-relevance"><input type="checkbox" data-settings-toggle="searchRelevance" ${searchRelevance ? "checked" : ""}>按相关性排序</label></div><div class="settings-separator"></div><div class="settings-label">排序标签</div><div><label class="settings-radio"><input type="radio" name="settings-tag-sort" value="name" data-settings-tag-sort ${tagSort !== "count" ? "checked" : ""}>按名称</label><label class="settings-radio"><input type="radio" name="settings-tag-sort" value="count" data-settings-tag-sort ${tagSort === "count" ? "checked" : ""}>按书签数量</label></div><div class="settings-label">失效链接 <a class="settings-help-link" href="https://help.raindrop.io/broken-links#reducing-false-positives" target="_blank" rel="noopener">[?]</a></div><div>${settingsControlMarkup("brokenLinks", "default", brokenLinkOptions)}</div><div class="settings-label">嵌套收藏</div><div><label class="settings-check settings-disabled"><input type="checkbox" disabled>旧视图</label></div><div class="settings-separator"></div><div class="settings-label">AI</div><div><label class="settings-check settings-disabled"><input type="checkbox" disabled>询问 AI <a class="settings-help-link" href="https://help.raindrop.io/stella" target="_blank" rel="noopener">[?]</a></label><label class="settings-check"><input type="checkbox" data-settings-toggle="recommendCollectionsTags" ${localRecommendations ? "checked" : ""}>推荐的收藏集和标签</label><label class="${aiClass}"><input type="checkbox" data-settings-toggle="aiRecommendations" ${aiRecommendations ? "checked" : ""} ${state.aiRecommendationsAvailable ? "" : "disabled"}>AI 推荐标签和备注</label><p class="settings-sub-label">${state.aiRecommendationsAvailable ? "推荐功能使用本地已有书签，不会上传数据。" : "AI 版需要在 Worker 中配置 Workers AI。"}</p></div></div></div>`;
}

function aiSettingsMarkup() {
  const settings = state.aiSettings || {};
  const provider = settingsPreference("aiProvider", settings.provider || "cloudflare");
  const model = state.preferences?.aiModel || settings.model || "";
  const baseUrl = state.preferences?.aiBaseUrl || settings.baseUrl || "https://api.openai.com/v1";
  const externalModel = state.preferences?.aiExternalModel || settings.externalModel || "gpt-4o-mini";
  const prompt = state.preferences?.aiPrompt || settings.prompt || settings.defaultPrompt || "";
  const configuredMaxTokens = Number(state.preferences?.aiMaxTokens ?? settings.maxTokens ?? 300);
  const maxTokens = Number.isInteger(configuredMaxTokens) && configuredMaxTokens >= 128 && configuredMaxTokens <= 4096 ? configuredMaxTokens : 300;
  const thinkingEnabled = Boolean(state.preferences?.aiThinkingEnabled ?? settings.thinkingEnabled);
  const models = Array.isArray(settings.models) ? settings.models : model ? [{ id: model, label: model, free: false }] : [];
  const modelOptions = models.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === model ? "selected" : ""}>${item.free ? `${escapeHtml(t("免费额度"))} · ` : ""}${escapeHtml(item.label || item.id)}</option>`).join("");
  const apiKeyConfigured = Boolean(settings.apiKeyConfigured || state.preferences?.aiApiKeyConfigured);
  const status = provider === "cloudflare"
    ? settings.cloudflareAvailable ? t("Worker 已配置 Workers AI") : t("尚未配置可用 AI")
    : settings.externalAvailable ? t("外部 API 已配置") : t("尚未配置可用 AI");
  const cloudflareFields = `<div class="settings-ai-cloudflare-fields" data-ai-cloudflare-fields ${provider === "cloudflare" ? "" : "hidden"}><label>${t("模型")}<select data-ai-model>${modelOptions}</select></label><label class="settings-check settings-ai-thinking"><input type="checkbox" data-ai-thinking ${thinkingEnabled ? "checked" : ""}>${t("启用思考模式")}</label><p class="settings-ai-field-note">${t("思考模式会增加等待时间和 Neurons 消耗，建议提高 max_tokens。")}</p></div>`;
  const externalFields = `<div class="settings-ai-external-fields" data-ai-external-fields ${provider === "openai" ? "" : "hidden"}><label>${t("API 地址")}<input data-ai-base-url type="url" value="${escapeHtml(baseUrl)}" placeholder="https://api.openai.com/v1"></label><label>${t("模型")}<input data-ai-external-model value="${escapeHtml(externalModel)}" placeholder="gpt-4o-mini"></label><label>${t("API Key")}<input data-ai-api-key type="password" autocomplete="new-password" placeholder="${escapeHtml(apiKeyConfigured ? t("已配置，留空保持不变") : t("输入 API Key"))}"></label>${apiKeyConfigured ? `<label class="settings-check"><input type="checkbox" data-ai-clear-key>${t("清除已保存的 API Key")}</label>` : ""}</div>`;
  return `<div class="settings-ai-panel" data-ai-settings-panel><div class="settings-ai-fields"><label>${t("提供商")}<select data-ai-provider><option value="cloudflare" ${provider === "cloudflare" ? "selected" : ""}>${t("Cloudflare Workers AI")}</option><option value="openai" ${provider === "openai" ? "selected" : ""}>${t("外部 OpenAI 兼容 API")}</option></select></label>${cloudflareFields}${externalFields}<label>${t("最大输出 tokens（max_tokens）")}<input data-ai-max-tokens type="number" min="128" max="4096" step="1" value="${maxTokens}"></label><p class="settings-ai-field-note">${t("控制单次 AI 请求的输出上限，范围为 128–4096。")}</p><label>${t("Prompt")}<textarea data-ai-prompt rows="7">${escapeHtml(prompt)}</textarea></label></div><p class="settings-sub-label" data-ai-config-note>${escapeHtml(status)}</p><p class="settings-sub-label">${t("自定义 Prompt 会保留固定 JSON 输出约束。")} ${t("外部 API 会收到当前书签和相似书签的元数据。")} ${t("免费额度受 Cloudflare 账户限制，不代表无限免费。")}</p><div class="settings-ai-actions"><button type="button" class="primary" data-ai-save ${state.aiBusy ? "disabled" : ""}>${t("保存 AI 设置")}</button><button type="button" data-ai-reset-prompt ${state.aiBusy ? "disabled" : ""}>${t("恢复默认 Prompt")}</button></div></div>`;
}

function syncAiProviderFields() {
  const provider = root.querySelector("[data-ai-provider]")?.value;
  const cloudflare = root.querySelector("[data-ai-cloudflare-fields]");
  const external = root.querySelector("[data-ai-external-fields]");
  if (cloudflare) cloudflare.hidden = provider !== "cloudflare";
  if (external) external.hidden = provider !== "openai";
}

async function saveAiSettings(promptOverride = null) {
  const panel = root.querySelector("[data-ai-settings-panel]");
  if (!panel || state.aiBusy) return;
  const prompt = promptOverride == null ? panel.querySelector("[data-ai-prompt]").value : promptOverride;
  const apiKey = panel.querySelector("[data-ai-api-key]")?.value.trim() || "";
  const provider = panel.querySelector("[data-ai-provider]").value;
  const maxTokens = Number(panel.querySelector("[data-ai-max-tokens]")?.value);
  const thinkingEnabled = Boolean(panel.querySelector("[data-ai-thinking]")?.checked);
  const button = panel.querySelector("[data-ai-save]");
  let rerender = false;
  state.aiBusy = true;
  if (button) button.disabled = true;
  try {
    const response = await mutate("/v1/ai/settings", {
      method: "PATCH",
      body: JSON.stringify({
        revision: state.preferences.revision,
        settings: {
          provider,
          model: panel.querySelector("[data-ai-model]")?.value || state.aiSettings?.model || "",
          baseUrl: panel.querySelector("[data-ai-base-url]")?.value || "",
          externalModel: panel.querySelector("[data-ai-external-model]")?.value || "",
          thinkingEnabled,
          maxTokens,
          prompt: prompt === state.aiSettings?.defaultPrompt ? "" : prompt,
        },
        apiKey: apiKey || null,
        clearApiKey: provider === "openai" && Boolean(panel.querySelector("[data-ai-clear-key]")?.checked),
      }),
    });
    if (!response) {
      rerender = true;
      return;
    }
    state.preferences = response.preferences;
    state.aiSettings = response.ai;
    state.aiRecommendationsAvailable = Boolean(response.ai?.available);
    rerender = true;
  } catch (error) {
    if (button) button.disabled = false;
    showError(error);
  } finally {
    state.aiBusy = false;
    if (rerender) renderSettings();
  }
}

const AUTO_LOCK_OPTIONS = [
  ["open", "每次打开"], ["1", "1 分钟"], ["5", "5 分钟"], ["15", "15 分钟"], ["30", "30 分钟"], ["60", "1 小时"], ["never", "从不"],
];

function autoLockSelect(value) {
  return `<select data-pin-auto-lock aria-label="${t("定时锁定")}">${AUTO_LOCK_OPTIONS.map(([option, label]) => `<option value="${option}" ${option === value ? "selected" : ""}>${escapeHtml(t(label))}</option>`).join("")}</select>`;
}

function pinSettingsMarkup() {
  const enabled = Boolean(state.lock?.enabled);
  const autoLock = state.lock?.autoLock || "15";
  const form = enabled
    ? `<div class="settings-pin-status"><span class="settings-pin-status-dot"></span><strong>${t("当前已启用")}</strong><span class="settings-account-muted">PIN 仅保存在此设备</span></div><div class="settings-pin-row"><span>${t("定时锁定")}</span>${autoLockSelect(autoLock)}</div><div class="settings-pin-actions"><button type="button" data-lock-now>${treeIcon("lock")}<span>${t("立即锁定")}</span></button><form data-pin-disable><label>当前 PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="6" maxlength="12" required></label><button class="danger" type="submit">${t("关闭应用锁")}</button><p class="error hidden" role="alert"></p></form></div>`
    : `<p class="muted">PIN 应用锁会在查看书签前要求输入本地 PIN。它不是服务器双因素认证，不会改变 Worker 访问密钥。</p><form data-pin-enable><label>设置 PIN（6–12 位数字）<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required></label><label>再次输入 PIN<input name="confirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required></label><label>${t("定时锁定")}${autoLockSelect(autoLock)}</label><button class="primary" type="submit">${t("启用应用锁")}</button><p class="error hidden" role="alert"></p></form>`;
  return `<div class="settings-content"><div class="settings-grid settings-pin-grid"><div class="settings-label">${t("应用锁")}</div><div class="settings-pin-panel">${form}</div></div></div>`;
}

function settingsMarkup() {
  const section = ["account", "import", "backups", "pin"].includes(state.settingsSection) ? state.settingsSection : "app";
  const title = section === "account" ? "帐户" : section === "import" ? "导入" : section === "backups" ? "备份" : section === "pin" ? "应用锁" : "应用";
  const instanceName = escapeHtml(settingsPreference("instanceName", "私有书签"));
  const nav = SETTINGS_NAV.map(([id, label, icon, supported]) => `<button type="button" class="settings-nav-item ${id === section ? "active" : ""}" data-settings-section="${id}" ${supported ? "" : "disabled"}>${treeIcon(icon)}<span>${t(label)}</span></button>`).join("");
  const body = section === "account" ? accountSettingsMarkup() : section === "import" ? importSettingsMarkup() : section === "backups" ? backupSettingsMarkup() : section === "pin" ? pinSettingsMarkup() : settingsAppMarkup();
  const headerAction = section === "import" ? `<a class="settings-icon-button settings-header-help" href="https://help.raindrop.io/import" target="_blank" rel="noopener" title="如何使用？" aria-label="如何使用？">${treeIcon("help")}</a>` : "";
  return localizeHtml(`<main class="settings-shell"><aside class="settings-sidebar"><header class="settings-sidebar-head"><button type="button" class="settings-icon-button settings-close" data-settings-close title="关闭" aria-label="关闭">${treeIcon("close")}</button><button type="button" class="settings-icon-button" data-settings-back title="返回书签" aria-label="返回书签">${treeIcon("back")}</button></header><div class="settings-sidebar-content"><div class="settings-profile"><span class="settings-avatar">${treeIcon("user")}</span><div class="settings-profile-copy"><strong>${instanceName}</strong><span>私有实例</span></div></div><div class="settings-nav-title">设置</div><nav class="settings-nav" aria-label="设置">${nav}</nav><div class="settings-nav-title settings-version">私有书签</div><a class="settings-nav-item settings-help" href="https://help.raindrop.io" target="_blank" rel="noopener">${treeIcon("help")}<span>帮助</span></a></div></aside><section class="settings-main"><div class="settings-main-inner"><header class="settings-main-header"><button type="button" class="settings-mobile-menu" title="显示设置菜单" aria-label="显示设置菜单">${treeIcon("menu")}</button><h1>${title}</h1><span class="settings-header-space"></span>${headerAction}</header><div class="settings-main-scroll">${body}</div></div></section></main>`);
}

function renderSettings() {
  document.title = languageIsEnglish() ? "Private Bookmarks" : "私有书签";
  root.innerHTML = settingsMarkup();
  if (state.settingsSection === "app") root.querySelector(".settings-grid")?.insertAdjacentHTML("beforeend", `<div class="settings-label">${t("AI 配置")}</div><div>${aiSettingsMarkup()}</div>`);
  const legacyLabel = t("旧视图");
  const legacyInput = [...root.querySelectorAll(".settings-check input")].find((input) => input.parentElement?.textContent.trim() === legacyLabel);
  if (legacyInput) {
    legacyInput.disabled = false;
    legacyInput.checked = settingsPreference("nestedViewLegacy", false);
    legacyInput.dataset.settingsToggle = "nestedViewLegacy";
    legacyInput.parentElement.classList.remove("settings-disabled");
  }
  const aiNote = root.querySelector(".settings-sub-label");
  if (aiNote) {
    const settings = state.aiSettings;
    aiNote.textContent = settings?.provider === "openai"
      ? t(settings.externalAvailable ? "推荐功能使用本地已有书签，不会上传数据。" : "请在下方配置外部 OpenAI 兼容 API。")
      : t(settings?.cloudflareAvailable ? "推荐功能使用本地已有书签，不会上传数据。" : "请在下方配置 Workers AI。");
  }
  applyTheme();
  localizeDialogs();
  bindSettings();
}

function setSettingsPreference(key, value) {
  if (key === "brokenLinks") key = "brokenLevel";
  const previous = state.preferences?.[key];
  if (key === "defaultView" && previous !== value) return beginDefaultViewChange(value);
  const keepMenu = key === "buttonGroup";
  if (previous === value) {
    state.settingsMenu = keepMenu ? "buttonGroup" : null;
    renderSettings();
    return;
  }
  state.preferences = { ...state.preferences, [key]: value };
  if (key === "nestedViewLegacy") state.settingsNeedsReload = true;
  state.settingsMenu = keepMenu ? "buttonGroup" : null;
  applyTheme();
  renderSettings();
  const save = savePreferences({ [key]: value });
  state.settingsSavePromise = save;
  save.catch((error) => {
    state.preferences = { ...state.preferences, [key]: previous };
    if (key === "nestedViewLegacy") state.settingsNeedsReload = false;
    state.settingsMenu = keepMenu ? "buttonGroup" : null;
    applyTheme();
    renderSettings();
    showError(error);
  }).finally(() => { if (state.settingsSavePromise === save) state.settingsSavePromise = null; });
}

let pendingDefaultViewChange = null;

function beginDefaultViewChange(value) {
  const previousPreferences = state.preferences;
  state.preferences = { ...state.preferences, defaultView: value };
  state.settingsMenu = null;
  renderSettings();
  pendingDefaultViewChange = { value, previousPreferences };
  const option = viewOption(value);
  defaultViewDialog.querySelector("#default-view-dialog-title").textContent = `⚠ ${t("默认视图已更改")}`;
  defaultViewDialog.querySelector("[data-default-view-description]").innerHTML = languageIsEnglish()
    ? `${t("新收藏夹现在将使用")} ${escapeHtml(t(option.label))} ${t("视图模式。")}` + `<br>${t("是否将此更改应用于所有现有收藏夹？")}`
    : `新收藏夹现在将使用 ${escapeHtml(t(option.label))} 视图模式。<br>是否将此更改应用于所有现有收藏夹？`;
  defaultViewDialog.showModal();
}

function finishDefaultViewChange(applyToAll) {
  const change = pendingDefaultViewChange;
  if (!change) return;
  pendingDefaultViewChange = null;
  const changes = applyToAll
    ? { layout: change.value, defaultView: change.value, layoutByScope: allLayoutScopes(change.value) }
    : { defaultView: change.value };
  if (applyToAll) state.layout = change.value;
  state.preferences = { ...state.preferences, ...changes };
  defaultViewDialog.close();
  savePreferences(changes).catch((error) => {
    state.preferences = change.previousPreferences;
    state.layout = layoutForScope(state.preferences);
    renderSettings();
    showError(error);
  });
}

defaultViewDialog.querySelector("[data-default-view-choice='keep']").onclick = () => finishDefaultViewChange(false);
defaultViewDialog.querySelector("[data-default-view-choice='all']").onclick = () => finishDefaultViewChange(true);
defaultViewDialog.addEventListener("cancel", () => finishDefaultViewChange(false));

function positionSettingsMenu() {
  const menu = root.querySelector("[data-settings-menu]");
  const trigger = [...root.querySelectorAll("[data-settings-select]")].find((button) => button.dataset.settingsSelect === state.settingsMenu);
  if (!menu || !trigger) return;
  const triggerRect = trigger.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, triggerRect.left));
  const top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, triggerRect.bottom));
  menu.style.setProperty("--left", `${left}px`);
  menu.style.setProperty("--top", `${top}px`);
}

let settingsMenuPositionBound = false;

function setSettingsSection(section) {
  const supported = SETTINGS_NAV.some(([id, , , enabled]) => id === section && enabled);
  if (supported && section !== state.settingsSection) {
    setSettingsRoute(true, section);
    if (section === "backups") refreshBackupSettings().then(() => renderSettings()).catch(showError);
  }
}

async function accountSettingsAction(action) {
  if (action === "disconnect") await disconnectCurrentDevice(true);
}

function showLockScreen() {
  lockView(root, async () => {
    state.lock = await lockState();
    startLockMonitor(showLockScreen);
    load().catch(showError);
  }, () => {
    state.settingsOpen = false;
    state.settingsSection = "app";
    const url = new URL(location.href);
    url.searchParams.delete("settings");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    load().catch(showError);
  });
}

function formError(form, message) {
  const error = form.querySelector(".error");
  if (!error) return;
  error.textContent = message || "请求失败";
  error.classList.remove("hidden");
}

function bindSettings() {
  root.querySelector(".settings-mobile-menu")?.addEventListener("click", () => root.querySelector(".settings-shell")?.classList.toggle("settings-sidebar-open"));
  root.querySelectorAll("[data-settings-back], [data-settings-close]").forEach((button) => button.onclick = () => {
    state.accountMenuOpen = false;
    setSettingsRoute(false);
  });
  root.querySelectorAll("[data-settings-section]").forEach((button) => button.onclick = () => setSettingsSection(button.dataset.settingsSection));
  root.querySelector("[data-import-upload]")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      root.querySelector("[data-import-file]")?.click();
    }
  });
  root.querySelector("[data-import-file]")?.addEventListener("change", (event) => prepareImportFile(event.currentTarget.files?.[0]));
  root.querySelector("[data-import-skip-duplicates]")?.addEventListener("change", (event) => {
    const preview = state.importPreview;
    if (!preview || Array.isArray(preview.pendingItems)) return;
    state.importPreview = { ...preview, skipDuplicates: event.currentTarget.checked };
    persistImportProgress(state.importPreview);
    renderSettings();
  });
  root.querySelector("[data-import-submit]")?.addEventListener("click", () => submitImport());
  root.querySelector("[data-import-restore]")?.addEventListener("click", () => restoreImportBackup());
  root.querySelector("[data-import-clear]")?.addEventListener("click", clearImportPreview);
  root.querySelector("[data-backup-create]")?.addEventListener("click", () => createBackup());
  root.querySelector("[data-backup-download-current]")?.addEventListener("click", () => downloadCurrentBackup());
  root.querySelector("[data-backup-include-media]")?.addEventListener("change", (event) => { state.backupIncludeMedia = event.currentTarget.checked; });
  root.querySelector("[data-backup-download-archive]")?.addEventListener("click", () => {
    const item = state.backups.map(backupMeta).find((entry) => entry.id === state.backups[0]?.id);
    if (item) downloadServerBackupArchive(item).catch(showError);
  });
  root.querySelector("[data-backup-restore]")?.addEventListener("click", () => setSettingsRoute(true, "import"));
  root.querySelectorAll("[data-backup-download]").forEach((button) => button.addEventListener("click", () => {
    const item = state.backups.map(backupMeta).find((entry) => entry.id === button.dataset.backupDownload);
    if (item) downloadBackupItem(item, button.dataset.backupFormat).catch(showError);
  }));
  root.querySelectorAll("[data-backup-restore-server]").forEach((button) => button.addEventListener("click", () => restoreServerBackup(button.dataset.backupRestoreServer).catch(showError)));
  root.querySelectorAll("[data-backup-archive]").forEach((button) => button.addEventListener("click", () => {
    const item = state.backups.map(backupMeta).find((entry) => entry.id === button.dataset.backupArchive);
    if (item) downloadServerBackupArchive(item).catch(showError);
  }));
  root.querySelectorAll("[data-backup-delete]").forEach((button) => button.addEventListener("click", () => deleteServerBackup(button.dataset.backupDelete).catch(showError)));
  root.querySelectorAll("[data-cloud-refresh]").forEach((button) => button.addEventListener("click", () => refreshCloudBackups({ silent: true }).then(() => renderSettings()).catch(showError)));
  root.querySelectorAll("[data-cloud-backup-download]").forEach((button) => button.addEventListener("click", () => downloadCloudBackup(button.dataset.cloudBackupProvider, button.dataset.cloudBackupDownload).catch(showError)));
  root.querySelectorAll("[data-cloud-backup-restore]").forEach((button) => button.addEventListener("click", () => restoreCloudBackup(button.dataset.cloudBackupProvider, button.dataset.cloudBackupRestore).catch(showError)));
  root.querySelectorAll("[data-cloud-backup-delete]").forEach((button) => button.addEventListener("click", () => deleteCloudBackup(button.dataset.cloudBackupProvider, button.dataset.cloudBackupDelete).catch(showError)));
  root.querySelectorAll("[data-cloud-action]").forEach((button) => button.addEventListener("click", () => cloudAction(button.dataset.cloudAction).catch(showError)));
  root.querySelectorAll("[data-cloud-disconnect]").forEach((button) => button.addEventListener("click", () => disconnectCloud(button.dataset.cloudDisconnect).catch(showError)));
  root.querySelector("[data-account-instance-name]")?.addEventListener("change", (event) => {
    const value = event.currentTarget.value.trim() || "私有书签";
    setSettingsPreference("instanceName", value.slice(0, 200));
  });
  root.querySelectorAll("[data-account-settings-action]").forEach((button) => button.onclick = () => accountSettingsAction(button.dataset.accountSettingsAction).catch(showError));
  root.querySelector("[data-pin-enable]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const pin = String(data.get("pin") || "");
    if (pin !== String(data.get("confirm") || "")) return formError(form, "两次输入的 PIN 不一致");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await enablePin(pin, form.querySelector("[data-pin-auto-lock]").value, state.connectionInfo);
      state.lock = await lockState();
      startLockMonitor(showLockScreen);
      renderSettings();
    } catch (error) {
      formError(form, error.message);
      button.disabled = false;
    }
  });
  root.querySelector("[data-pin-disable]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await disablePin(new FormData(form).get("pin"));
      state.lock = await lockState();
      renderSettings();
    } catch (error) {
      formError(form, error.message);
      button.disabled = false;
    }
  });
  root.querySelector("[data-lock-now]")?.addEventListener("click", async () => {
    await lockNow();
    showLockScreen();
  });
  root.querySelector("[data-pin-auto-lock]")?.addEventListener("change", async (event) => {
    if (!state.lock.enabled) return;
    try {
      await setAutoLock(event.currentTarget.value);
      state.lock = await lockState();
      renderSettings();
    } catch (error) { showError(error); }
  });
  root.querySelectorAll("[data-settings-select]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.settingsMenu = state.settingsMenu === button.dataset.settingsSelect ? null : button.dataset.settingsSelect;
    renderSettings();
  });
  root.querySelectorAll("[data-settings-button-group]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.settingsMenu = state.settingsMenu === "buttonGroup" ? null : "buttonGroup";
    renderSettings();
  });
  root.querySelectorAll("[data-settings-option]").forEach((option) => option.onclick = () => setSettingsPreference(option.dataset.settingsOption, option.dataset.settingsValue));
  root.querySelectorAll("[data-settings-toggle]").forEach((input) => input.onchange = () => setSettingsPreference(input.dataset.settingsToggle, input.checked));
  root.querySelectorAll("[data-settings-button-option]").forEach((input) => input.onchange = () => setSettingsPreference("buttonGroup", { ...buttonGroupPreference(), [input.dataset.settingsButtonOption]: input.checked }));
  root.querySelectorAll("[data-settings-tag-sort]").forEach((input) => input.onchange = () => setSettingsPreference("tagSort", input.value));
  root.querySelectorAll("[data-settings-theme]").forEach((button) => button.onclick = () => setSettingsPreference("theme", button.dataset.settingsTheme));
  root.querySelector("[data-ai-provider]")?.addEventListener("change", syncAiProviderFields);
  root.querySelector("[data-ai-save]")?.addEventListener("click", () => saveAiSettings());
  root.querySelector("[data-ai-reset-prompt]")?.addEventListener("click", () => saveAiSettings(state.aiSettings?.defaultPrompt || ""));
  syncAiProviderFields();
  positionSettingsMenu();
  if (!settingsMenuPositionBound) {
    window.addEventListener("resize", positionSettingsMenu);
    document.addEventListener("scroll", positionSettingsMenu, true);
    settingsMenuPositionBound = true;
  }
}

let loadGeneration = 0;

async function load({ viewOnly = false } = {}) {
  const generation = ++loadGeneration;
  const showLoading = shouldShowGlobalLoading(root?.querySelector(".library, .settings-shell"));
  if (showLoading) setGlobalLoading(true);
  try {
    const path = queryPath();
    if (viewOnly) {
      const requests = [api(path), api(tagQueryPath()).catch(() => [])];
      if (state.view === "trash") requests.push(api("/v1/collections?trash=1"));
      const [items, tags, trashedCollections = []] = await Promise.all(requests);
      if (!isCurrentRequest(generation, loadGeneration)) return;
      state.items = items;
      state.tags = Array.isArray(tags) ? tags : [];
      state.trashedCollections = state.view === "trash" ? trashedCollections : [];
      if (!state.allItems.length && state.view === "all" && !state.collectionId) state.allItems = items;
      render();
      return;
    }
    const requests = [api("/v1/bootstrap"), api(path), path === "/v1/bookmarks?" ? null : api("/v1/bookmarks?"), api(tagQueryPath()).catch(() => [])];
    if (state.view === "trash") requests.push(api("/v1/collections?trash=1"));
    const [connectionInfo, boot, items, allItems, tags, trashedCollections = []] = await Promise.all([connection(), ...requests]);
    if (!isCurrentRequest(generation, loadGeneration)) return;
    state.connectionInfo = connectionInfo;
    state.lock = await lockState();
    setCoverUploadEnabled(boot.capabilities?.mediaUpload);
    state.aiSettings = boot.ai || null;
    state.aiRecommendationsAvailable = Boolean(boot.capabilities?.aiRecommendations);
    state.collections = boot.collections;
    state.collectionCounts = boot.collectionCounts || {};
    state.trashCount = boot.trashCount || 0;
    state.preferences = boot.preferences;
    state.layout = layoutForScope(boot.preferences);
    state.collapsedCollections = new Set(Array.isArray(boot.preferences.collapsedCollectionIds) ? boot.preferences.collapsedCollectionIds : []);
    state.items = items;
    state.allItems = allItems || items;
    state.tags = Array.isArray(tags) ? tags : [];
    state.favoriteCount = (allItems || items).filter((item) => item.favorite).length;
    state.trashedCollections = trashedCollections;
    if (state.settingsOpen && state.settingsSection === "backups") await refreshBackupSettings();
    applyTheme();
    render();
  } finally {
    if (showLoading && isCurrentRequest(generation, loadGeneration)) setGlobalLoading(false);
  }
}

function emptyStateMarkup() {
  const searching = Boolean(state.query.trim());
  const message = searching ? "没有匹配的书签。" : state.view === "trash" ? "废纸篓为空。" : state.collectionId ? "此收藏夹还没有书签。" : "此视图中还没有书签。";
  const action = searching
    ? `<button type="button" class="empty-action" data-empty-action="clear-search">清除搜索</button>`
    : state.view === "trash"
      ? `<button type="button" class="empty-action" data-empty-action="all">返回所有书签</button>`
      : `<button type="button" class="primary empty-action" data-empty-action="add-bookmark">添加书签</button>`;
  return `<div class="empty" role="status"><p>${t(message) === message ? message : t(message)}</p>${action}</div>`;
}

function render() {
  if (state.settingsOpen) return renderSettings();
  document.title = languageIsEnglish() ? "Private Bookmarks" : "私有书签";
  const viewSwitching = state.viewSwitching;
  state.viewSwitching = false;
  const editWasOpen = editBookmarkDialog.open;
  const items = sortedItems();
  const selection = items.filter((item) => state.selected.has(item.id));
  const duplicates = duplicateLinks(sidebarItems());
  if (!selection.length) state.selectionMoreOpen = false;
  const collectionTrash = state.view === "trash" ? state.trashedCollections.map((item) => `<article class="bookmark-card collection-trash-card"><span class="collection-trash-icon">${collectionIconMarkup(collectionIconValue(item.id))}</span><span><strong>${escapeHtml(item.name)}</strong><span class="card-meta">收藏夹及其下级项目</span></span><button data-restore-collection="${item.id}" title="恢复收藏夹" aria-label="恢复收藏夹">${treeIcon("add")}</button></article>`).join("") : "";
  const cardMenuItem = items.find((item) => item.id === state.cardMenuId);
  if (!cardMenuItem) state.cardMenuId = null;
  const cardMenu = cardMenuItem ? cardActionMenu(cardMenuItem) : "";
  root.innerHTML = localizeHtml(`<main class="library">${sidebarMarkup()}<section class="content"><header class="topbar"><label class="quick-search"><span>⌕</span><input id="search" value="${escapeHtml(state.query)}" placeholder="搜索" autocomplete="off"><kbd>⌘ K</kbd></label><div class="top-actions"><button id="check-links" class="top-action-icon"${state.connectionInfo ? "" : " disabled"} title="${state.connectionInfo ? t("检查链接") : t("连接私有实例后可用")}" aria-label="${state.connectionInfo ? t("检查链接") : t("连接私有实例后可用")}">${treeIcon("refresh")}</button><div class="theme-menu-wrap"><button id="theme" class="top-action-icon theme-trigger" title="主题：${themeOption().label}" aria-label="主题：${themeOption().label}" aria-haspopup="menu" aria-expanded="${state.themeMenuOpen}" data-theme-trigger>${treeIcon(themeOption().icon)}</button>${themeMenuMarkup()}</div><button id="import" class="top-action-icon" title="导入书签" aria-label="导入书签">${treeIcon("upload")}</button><button id="add-bookmark" class="primary add-bookmark">${treeIcon("add")}<span>添加</span></button></div></header><section class="workspace"><header class="workspace-head"><div class="workspace-title"><button id="select-all" class="select-all" title="选择全部" aria-label="选择全部" aria-pressed="${Boolean(items.length && selection.length === items.length)}"><span class="select-checkbox">${items.length && selection.length === items.length ? "✓" : ""}</span></button><h1>☁ ${escapeHtml(viewName(items))}</h1><span class="count">${items.length}</span></div><div class="workspace-tools"><select id="sort" aria-label="排序"><option value="manual" ${state.preferences?.sort === "manual" ? "selected" : ""}>手动排序</option><option value="title" ${state.preferences?.sort === "title" ? "selected" : ""}>标题 (A-Z)</option><option value="host" ${state.preferences?.sort === "host" ? "selected" : ""}>网站 (A-Z)</option><option value="created" ${state.preferences?.sort === "created" ? "selected" : ""}>最近添加</option></select><div class="view-switcher" role="group" aria-label="视图"><button data-layout="list" class="${state.layout === "list" ? "active" : ""}" title="列表视图" aria-pressed="${state.layout === "list"}">☷ 列表</button><button data-layout="grid" class="${state.layout === "grid" ? "active" : ""}" title="网格视图" aria-pressed="${state.layout === "grid"}">▦ 网格</button></div><button id="export" class="export" title="导出书签">⇩ 导出书签</button></div></header><section class="cards layout-${state.layout}${viewSwitching ? " no-card-animation" : ""}" role="list">${collectionTrash}${items.length ? items.map((item, index) => card(item, index, duplicates)).join("") : collectionTrash || emptyStateMarkup()}${cardMenu}</section><div class="bookmark-count-footer" data-compact="false">${items.length} 个书签</div></section></section></main>`);
  const sidebar = root.querySelector(".sidebar");
  mountEditPanel(editWasOpen);
  const resizer = document.createElement("div");
  resizer.className = "sidebar-resizer";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", t("调整侧边栏宽度"));
  resizer.setAttribute("tabindex", "0");
  sidebar?.after(resizer);
  root.querySelector(".workspace-head").outerHTML = localizeHtml(workspaceHeaderMarkup(items, selection));
  localizeDialogs();
  applyViewFields();
  enhanceSearch();
  enhanceSidebar();
  bind();
  layoutMasonry();
  positionCardMenu();
}

let cardPopoverPositionBound = false;

function positionCardMenu() {
  if (!cardPopoverPositionBound) {
    window.addEventListener("resize", positionCardMenu);
    document.addEventListener("scroll", positionCardMenu, true);
    cardPopoverPositionBound = true;
  }
  const menu = root.querySelector("[data-card-menu-panel]");
  if (!menu || !state.cardMenuId) return;
  const trigger = [...root.querySelectorAll("[data-card-menu]")].find((button) => button.dataset.cardMenu === state.cardMenuId);
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(menu.offsetWidth, window.innerWidth - 16);
  const height = Math.min(menu.offsetHeight, window.innerHeight - 16);
  const gap = 6;
  let left = rect.right - width;
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 8) top = rect.top - height - gap;
  left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function closeCardMenu() {
  if (!state.cardMenuId && !root.querySelector("[data-card-menu-panel]")) return;
  state.cardMenuId = null;
  root.querySelector("[data-card-menu-panel]")?.remove();
  root.querySelector(".card-menu-open")?.classList.remove("card-menu-open");
  root.querySelectorAll("[data-card-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

let sidebarPopoverResizeBound = false;

function positionAccountMenu() {
  const menu = root.querySelector("[data-account-menu]");
  const trigger = root.querySelector("[data-account-trigger]");
  if (!menu || !trigger || menu.hidden) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(menu.offsetWidth, window.innerWidth - 16);
  const height = Math.min(menu.offsetHeight, window.innerHeight - 16);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  let top = rect.bottom - 1;
  if (top + height > window.innerHeight - 8) top = rect.top - height + 1;
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(Math.max(8, top))}px`;
}

function setAccountMenuOpen(open) {
  state.accountMenuOpen = Boolean(open);
  const trigger = root.querySelector("[data-account-trigger]");
  const menu = root.querySelector("[data-account-menu]");
  trigger?.setAttribute("aria-expanded", String(state.accountMenuOpen));
  if (menu) menu.hidden = !state.accountMenuOpen;
  if (state.accountMenuOpen) positionAccountMenu();
}

async function accountAction(action) {
  setAccountMenuOpen(false);
  if (action === "settings") {
    state.selected.clear();
    state.searchMenuOpen = false;
    state.sortMenuOpen = false;
    state.viewMenuOpen = false;
    state.themeMenuOpen = false;
    if (isPopupSurface()) return openFullPage("library.html?settings=app");
    setSettingsRoute(true);
    return;
  }
  if (action !== "logout") return;
  await disconnectCurrentDevice();
}

async function disconnectCurrentDevice(confirmFirst = false) {
  if (confirmFirst && !window.confirm(t("确认断开当前设备吗？"))) return;
  await disconnect();
  state.selected.clear();
  state.accountMenuOpen = false;
  state.connectionInfo = null;
  state.settingsOpen = false;
  state.settingsSection = "app";
  state.settingsMenu = null;
  const url = new URL(location.href);
  url.searchParams.delete("settings");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  load().catch(showError);
}

function positionSidebarMenus() {
  const nav = root.querySelector(".nav");
  if (!sidebarPopoverResizeBound) {
    window.addEventListener("resize", positionSidebarMenus);
    sidebarPopoverResizeBound = true;
  }
  if (nav && nav.dataset.popoverPositionBound !== "1") {
    nav.addEventListener("scroll", positionSidebarMenus, { passive: true });
    nav.dataset.popoverPositionBound = "1";
  }
  const pickerList = document.querySelector(".collection-picker-list");
  if (pickerList && pickerList.dataset.popoverPositionBound !== "1") {
    pickerList.addEventListener("scroll", positionSidebarMenus, { passive: true });
    pickerList.dataset.popoverPositionBound = "1";
  }
  const triggerFor = (menu) => {
    if (menu.matches("[data-tag-item-menu-panel]")) return menu.previousElementSibling;
    if (menu.matches("[data-collection-menu-panel]")) return menu.previousElementSibling?.querySelector("[data-collection-menu]");
    if (menu.matches("[data-group-menu-panel]")) return menu.previousElementSibling?.querySelector("[data-group-menu]");
    if (menu.matches("[data-picker-group-menu-panel]")) return menu.previousElementSibling?.querySelector("[data-picker-group-menu]");
    if (menu.matches("[data-tag-menu-panel]")) return menu.previousElementSibling?.querySelector("[data-tag-menu]");
    if (menu.matches("[data-picker-collection-menu-panel]")) return menu.closest(".collection-picker-row")?.querySelector("[data-picker-collection-menu]");
    return null;
  };
  document.querySelectorAll("[data-tag-item-menu-panel], [data-collection-menu-panel], [data-group-menu-panel], [data-tag-menu-panel], [data-picker-collection-menu-panel], [data-picker-group-menu-panel]").forEach((menu) => {
    const trigger = triggerFor(menu);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + 1));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + 29));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
  positionSortMenu();
  positionViewMenu();
  positionAccountMenu();
}

function enhanceSidebar() {
  const filtersSection = root.querySelector(".filters-section");
  const filtersCollapsed = sidebarSectionCollapsed("filters");
  filtersSection.classList.toggle("section-collapsed", filtersCollapsed);
  filtersSection.querySelector(".sidebar-label").innerHTML = `<button class="sidebar-section-toggle" data-sidebar-toggle="filters" aria-expanded="${!filtersCollapsed}">${t("快速过滤…")}</button>${filtersCollapsed ? `<button class="section-show" data-sidebar-toggle="filters">${t("显示")}</button>` : ""}`;
  let tagSection = root.querySelector(".tag-section");
  if (!tagSection) {
    tagSection = document.createElement("section");
    tagSection.className = "sidebar-section tag-section";
    tagSection.innerHTML = '<div class="sidebar-label"></div>';
    filtersSection.after(tagSection);
  }
  const tags = tagList(sidebarItems());
  const tagsCollapsed = sidebarSectionCollapsed("tags");
  tagSection.classList.toggle("section-collapsed", tagsCollapsed);
  tagSection.querySelector(".sidebar-label").innerHTML = `<button class="sidebar-section-toggle" data-sidebar-toggle="tags" aria-expanded="${!tagsCollapsed}">${t("标签")} (${tags.length})</button>${tagsCollapsed ? `<button class="section-show" data-sidebar-toggle="tags">${t("显示")}</button>` : `<button class="tag-menu-trigger" data-tag-menu title="${t("标签")} ${t("更多")}" aria-label="${t("标签")} ${t("更多")}" aria-expanded="${state.tagMenuOpen}">${treeIcon("moreHorizontal")}</button>`}`;
  if (state.tagMenuOpen && !tagsCollapsed) tagSection.querySelector(".sidebar-label").insertAdjacentHTML("afterend", `<div class="sidebar-menu tag-menu" role="menu" data-tag-menu-panel><button role="menuitem" data-tag-action="hide">${t("隐藏标签")}</button><span class="menu-separator"></span><button role="menuitem" data-tag-action="name">${t("按名称排序标签")}</button><button role="menuitem" data-tag-action="count">${t("按书签数排序标签")}</button></div>`);
  positionSidebarMenus();
}

function renderSidebar() {
  const nav = root.querySelector(".nav");
  if (!nav) return render();
  const scrollTop = nav.scrollTop;
  const template = document.createElement("template");
  template.innerHTML = localizeHtml(sidebarMarkup());
  nav.replaceWith(template.content.firstElementChild.querySelector(".nav"));
  root.querySelector(".nav").scrollTop = scrollTop;
  enhanceSidebar();
  localizeDialogs();
  bind();
}

function sidebarWidthBounds() {
  const min = window.innerWidth <= 760 ? 185 : 200;
  return { min, max: Math.max(min, window.innerWidth - 320) };
}

function setSidebarOpen(open) {
  state.sidebarOpen = Boolean(open);
  root.querySelector(".library")?.classList.toggle("sidebar-open", state.sidebarOpen);
  root.querySelector("[data-mobile-sidebar-toggle]")?.setAttribute("aria-expanded", String(state.sidebarOpen));
}

function ensureMobileSidebarControls() {
  const topbar = root.querySelector(".topbar");
  const sidebarHead = root.querySelector(".sidebar-head");
  if (!topbar || !sidebarHead) return;
  if (!topbar.querySelector("[data-mobile-sidebar-toggle]")) {
    const toggle = document.createElement("button");
    toggle.className = "mobile-sidebar-toggle";
    toggle.dataset.mobileSidebarToggle = "";
    toggle.title = t("显示侧边栏");
    toggle.setAttribute("aria-label", t("显示侧边栏"));
    toggle.setAttribute("aria-expanded", String(state.sidebarOpen));
    toggle.innerHTML = treeIcon("menu");
    topbar.prepend(toggle);
  }
  if (!sidebarHead.querySelector("[data-mobile-sidebar-close]")) {
    const close = document.createElement("button");
    close.className = "mobile-sidebar-close";
    close.dataset.mobileSidebarClose = "";
    close.title = t("关闭侧边栏");
    close.setAttribute("aria-label", t("关闭侧边栏"));
    close.innerHTML = treeIcon("close");
    sidebarHead.prepend(close);
  }
  setSidebarOpen(state.sidebarOpen);
}

function applySidebarWidth() {
  const library = root.querySelector(".library");
  const resizer = root.querySelector(".sidebar-resizer");
  if (!library || !resizer) return;
  const { min, max } = sidebarWidthBounds();
  const actualWidth = library.querySelector(".sidebar")?.getBoundingClientRect().width || min;
  resizer.setAttribute("aria-valuemin", String(min));
  resizer.setAttribute("aria-valuemax", String(max));
  if (state.sidebarWidth == null) {
    library.style.removeProperty("--sidebar-width");
    resizer.setAttribute("aria-valuenow", String(Math.round(actualWidth)));
    return;
  }
  state.sidebarWidth = Math.min(max, Math.max(min, state.sidebarWidth));
  library.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  resizer.setAttribute("aria-valuemin", String(min));
  resizer.setAttribute("aria-valuemax", String(max));
  resizer.setAttribute("aria-valuenow", String(Math.round(state.sidebarWidth)));
}

function bindSidebarResizer() {
  const resizer = root.querySelector(".sidebar-resizer");
  const library = root.querySelector(".library");
  if (!resizer || !library) return;
  applySidebarWidth();
  resizer.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = library.querySelector(".sidebar").getBoundingClientRect().width;
    state.sidebarWidth = startWidth;
    resizer.classList.add("is-dragging");
    document.body.classList.add("sidebar-resizing");
    resizer.setPointerCapture?.(event.pointerId);
    resizer.onpointermove = (moveEvent) => {
      state.sidebarWidth = startWidth + moveEvent.clientX - startX;
      applySidebarWidth();
    };
    const stop = () => {
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-resizing");
      resizer.onpointermove = null;
      resizer.onpointerup = null;
      resizer.onpointercancel = null;
    };
    resizer.onpointerup = stop;
    resizer.onpointercancel = stop;
  };
  resizer.onkeydown = (event) => {
    const { min, max } = sidebarWidthBounds();
    const current = state.sidebarWidth ?? library.querySelector(".sidebar").getBoundingClientRect().width;
    const next = event.key === "ArrowLeft" ? current - 10 : event.key === "ArrowRight" ? current + 10 : event.key === "Home" ? min : event.key === "End" ? max : null;
    if (next == null) return;
    event.preventDefault();
    state.sidebarWidth = next;
    applySidebarWidth();
  };
}

function updateViewChrome() {
  const allActive = state.view === "all" && !state.collectionId;
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view && (button.dataset.view !== "all" || allActive));
  });
  root.querySelectorAll("[data-collection]").forEach((button) => {
    button.closest(".collection-row, .nav-item")?.classList.toggle("active", button.dataset.collection === state.collectionId);
  });
  root.querySelectorAll("[data-search-query], [data-tag]").forEach((button) => button.classList.remove("active"));
  const name = root.querySelector(".workspace-head .workspace-name");
  if (name) name.textContent = viewName();
  const open = root.querySelector(".workspace-open");
  if (open) open.href = workspaceHref();
  refreshSelectionUi({ refreshHeader: true });
}

function switchView(view, collectionId = null) {
  state.sidebarOpen = false;
  state.searchMenuOpen = false;
  state.sortMenuOpen = false;
  state.viewMenuOpen = false;
  state.themeMenuOpen = false;
  state.accountMenuOpen = false;
  state.cardMenuId = null;
  state.view = view;
  state.collectionId = collectionId;
  state.query = "";
  state.tag = "";
  state.selected.clear();
  state.selectionMoreOpen = false;
  state.viewSwitching = true;
  updateLibraryRoute("push");
  updateViewChrome();
  load({ viewOnly: true }).catch(showError);
}

async function savePreferences(changes) {
  const { revision, ...preferences } = state.preferences;
  const next = await mutate("/v1/preferences", { method: "PATCH", body: JSON.stringify({ revision, preferences: { ...preferences, ...changes } }) });
  if (next) state.preferences = next;
  return next;
}

let viewPreferenceQueue = Promise.resolve();

function persistViewPreferences(changes) {
  viewPreferenceQueue = viewPreferenceQueue.catch(() => {}).then(() => savePreferences(changes));
  viewPreferenceQueue.catch(showError);
}

let sidebarPreferenceQueue = Promise.resolve();
let sidebarPreferenceVersion = 0;
let latestSidebarChanges = {};

function persistSidebarPreferences(changes, rollback, restoreState) {
  const version = ++sidebarPreferenceVersion;
  latestSidebarChanges = { ...latestSidebarChanges, ...changes };
  sidebarPreferenceQueue = sidebarPreferenceQueue.catch(() => {}).then(async () => {
    if (version !== sidebarPreferenceVersion) return;
    try {
      const next = await savePreferences(changes);
      if (next && version !== sidebarPreferenceVersion) {
        state.preferences = { ...next, ...latestSidebarChanges };
      }
    } catch (error) {
      if (version !== sidebarPreferenceVersion) return;
      state.preferences = { ...state.preferences, ...rollback };
      restoreState?.();
      renderSidebar();
      showError(error);
    }
  });
}

async function createInlineCollection(form) {
  const name = form.querySelector('input[name="name"]').value.trim();
  if (!name) return null;
  const parentId = form.dataset.parentId || null;
  const created = await api("/v1/collections", { method: "POST", body: JSON.stringify({ name, parentId }) });
  if (!parentId) await savePreferences({ collectionGroupByCollectionId: { ...collectionGroupMap(), [created.id]: form.dataset.groupId } });
  if (parentId && state.collapsedCollections.delete(parentId)) await savePreferences({ collapsedCollectionIds: [...state.collapsedCollections] });
  state.inlineCollectionCreate = null;
  await load();
  return created;
}

function saveGroups(groups, assignments = collectionGroupMap()) {
  const previousGroups = collectionGroups();
  const previousAssignments = collectionGroupMap();
  state.preferences = { ...state.preferences, collectionGroups: groups, collectionGroupByCollectionId: assignments };
  state.groupMenuId = null;
  state.tagItemMenu = null;
  renderSidebar();
  persistSidebarPreferences(
    { collectionGroups: groups, collectionGroupByCollectionId: assignments },
    { collectionGroups: previousGroups, collectionGroupByCollectionId: previousAssignments },
  );
}

async function sortAllCollections() {
  if (!window.confirm("要按名称排序所有收藏集吗？此操作会替换当前手动顺序。")) return;
  const parentIds = new Set(state.collections.map((item) => item.parentId || ""));
  for (const parentId of parentIds) {
    const siblings = state.collections.filter((item) => (item.parentId || "") === parentId && item.id !== "unsorted").sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    for (let position = 0; position < siblings.length; position += 1) {
      const item = siblings[position];
      if (item.position === position) continue;
      await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, position }) });
    }
  }
  await load();
}

function emptyCollectionRoots() {
  const children = new Map();
  for (const item of state.collections) children.set(item.parentId || "", [...(children.get(item.parentId || "") || []), item]);
  const hasBookmarks = (id) => Boolean(state.collectionCounts[id]) || (children.get(id) || []).some((item) => hasBookmarks(item.id));
  const emptyIds = new Set(state.collections.filter((item) => item.id !== "unsorted" && !hasBookmarks(item.id)).map((item) => item.id));
  return state.collections.filter((item) => emptyIds.has(item.id) && !emptyIds.has(item.parentId));
}

async function cleanEmptyCollections() {
  const roots = emptyCollectionRoots();
  if (!roots.length) return window.alert("没有空收藏集。");
  if (!window.confirm(`要删除 ${roots.length} 个空收藏集及其空子级吗？`)) return;
  const removed = new Set();
  for (const rootItem of roots) for (const item of state.collections) {
    let current = item;
    while (current?.parentId && current.parentId !== rootItem.id) current = state.collections.find((entry) => entry.id === current.parentId);
    if (item.id === rootItem.id || current?.parentId === rootItem.id) removed.add(item.id);
  }
  for (const item of roots) await mutate(`/v1/collections/${item.id}?revision=${item.revision}`, { method: "DELETE" });
  const assignments = Object.fromEntries(Object.entries(collectionGroupMap()).filter(([id]) => !removed.has(id)));
  await savePreferences({ collectionGroupByCollectionId: assignments });
  await load();
}

async function deleteSelectedCollections() {
  const ids = state.collectionSelection?.ids || new Set();
  const selected = state.collections.filter((item) => ids.has(item.id));
  const roots = selected.filter((item) => !ids.has(item.parentId));
  if (!roots.length || !window.confirm(`要将选中的 ${selected.length} 个收藏集及其内容移入废纸篓吗？`)) return;
  const removed = new Set(selected.map((item) => item.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const item of state.collections) if (removed.has(item.parentId) && !removed.has(item.id)) {
      removed.add(item.id);
      changed = true;
    }
  }
  for (const item of roots) await mutate(`/v1/collections/${item.id}?revision=${item.revision}`, { method: "DELETE" });
  await savePreferences({ collectionGroupByCollectionId: Object.fromEntries(Object.entries(collectionGroupMap()).filter(([id]) => !removed.has(id))) });
  state.collectionSelection = null;
  await load();
}

async function mergeSelectedCollections() {
  const ids = state.collectionSelection?.ids || new Set();
  const selected = state.collections.filter((item) => ids.has(item.id));
  if (selected.length < 2) return;
  if (new Set(selected.map((item) => item.parentId || "")).size !== 1) return window.alert("只能合并同一层级的收藏集。");
  const targetName = window.prompt("合并到哪个收藏集？请输入已选收藏集名称。", selected[0].name);
  const target = selected.find((item) => item.name === targetName);
  if (!target) return window.alert("请输入已选收藏集中的准确名称。");
  if (!window.confirm(`要把其他 ${selected.length - 1} 个收藏集合并到“${target.name}”吗？`)) return;
  for (const source of selected.filter((item) => item.id !== target.id)) {
    const bookmarks = await api(`/v1/bookmarks?collection=${encodeURIComponent(source.id)}`);
    for (const bookmark of bookmarks) await mutate(`/v1/bookmarks/${bookmark.id}`, { method: "PATCH", body: JSON.stringify({ revision: bookmark.revision, collectionId: target.id }) });
    for (const child of state.collections.filter((item) => item.parentId === source.id)) await mutate(`/v1/collections/${child.id}`, { method: "PATCH", body: JSON.stringify({ revision: child.revision, parentId: target.id }) });
    await mutate(`/v1/collections/${source.id}?revision=${source.revision}`, { method: "DELETE" });
  }
  state.collectionSelection = null;
  await load();
}

async function groupAction(action, groupId) {
  const groups = collectionGroups();
  const group = groups.find((item) => item.id === groupId);
  state.groupMenuId = null;
  state.tagItemMenu = null;
  if (action === "select") {
    state.collectionSelection = { groupId, ids: new Set(collectionsInGroup(groupId).map((item) => item.id)) };
    return renderSidebar();
  }
  if (action === "create-collection") {
    state.inlineCollectionCreate = { surface: "sidebar", groupId, parentId: null };
    renderSidebar();
    return focusInlineCollection("sidebar");
  }
  if (action === "collapse" || action === "expand") {
    const previousCollapsedCollections = new Set(state.collapsedCollections);
    state.collapsedCollections = action === "collapse" ? new Set(expandableCollectionIds()) : new Set();
    const collapsedCollectionIds = [...state.collapsedCollections];
    renderSidebar();
    return persistSidebarPreferences(
      { collapsedCollectionIds },
      { collapsedCollectionIds: [...previousCollapsedCollections] },
      () => { state.collapsedCollections = previousCollapsedCollections; },
    );
  }
  if (action === "sort") return sortAllCollections();
  if (action === "clean") return cleanEmptyCollections();
  if (action === "create-group") {
    const title = window.prompt("群组名称", "新群组")?.trim();
    if (!title) return renderSidebar();
    return saveGroups([...groups, { id: crypto.randomUUID(), title, hidden: false }]);
  }
  if (action === "rename") {
    const title = window.prompt("群组名称", group.title)?.trim();
    if (!title) return renderSidebar();
    return saveGroups(groups.map((item) => item.id === groupId ? { ...item, title } : item));
  }
  if (action === "hide" || action === "show") return saveGroups(groups.map((item) => item.id === groupId ? { ...item, hidden: action === "hide" } : item));
  if (action === "delete-group") {
    if (collectionsInGroup(groupId).length) return window.alert("有内容的群组不能删除。");
    if (!window.confirm(`要删除群组“${group.title}”吗？`)) return renderSidebar();
    const remaining = groups.filter((item) => item.id !== groupId);
    return saveGroups(remaining.length ? remaining : [DEFAULT_GROUP]);
  }
}

async function collectionAction(action, collectionId) {
  const item = state.collections.find((entry) => entry.id === collectionId);
  if (!item) return;
  state.collectionMenuId = null;
  state.tagItemMenu = null;
  if (action === "open") return switchView("all", item.id);
  if (action === "create-child") {
    const groupId = collectionGroupId(item);
    state.inlineCollectionCreate = { surface: "sidebar", groupId, parentId: item.id };
    state.collapsedCollections.delete(item.id);
    renderSidebar();
    return focusInlineCollection("sidebar");
  }
  if (action === "select") {
    state.collectionSelection = { groupId: collectionGroupId(item), ids: new Set([item.id]) };
    return renderSidebar();
  }
  if (action === "rename") {
    const form = collectionValueDialog.querySelector("form");
    collectionValueDialog.querySelector("h2").textContent = t("修改收藏夹名称");
    form.elements.value.value = item.name;
    form.elements.value.placeholder = t("收藏夹名称");
    form.elements.value.required = true;
    state.collectionValueAction = "rename";
    state.collectionValueId = item.id;
    collectionValueDialog.returnValue = "";
    renderSidebar();
    return collectionValueDialog.showModal();
  }
  if (action === "icon") {
    renderSidebar();
    return openCollectionIconPicker(item);
  }
  if (action === "share") {
    const bookmarks = await api(`/v1/bookmarks?collection=${encodeURIComponent(item.id)}`);
    const text = [`${item.name}（${bookmarks.length}）`, ...bookmarks.map((bookmark) => `${bookmark.title || bookmark.link}\n${bookmark.link}`)].join("\n\n");
    collectionShareDialog.querySelector("h2").textContent = `${t("分享收藏夹")}“${item.name}”`;
    collectionShareDialog.querySelector("textarea").value = text;
    collectionShareDialog.dataset.title = item.name;
    collectionShareDialog.querySelector("#system-collection-share").classList.toggle("hidden", !navigator.share);
    renderSidebar();
    return collectionShareDialog.showModal();
  }
  if (action === "delete") {
    if (!window.confirm(`要将“${item.name}”及其内容移入废纸篓吗？`)) return renderSidebar();
    const removed = new Set([item.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of state.collections) if (removed.has(entry.parentId) && !removed.has(entry.id)) {
        removed.add(entry.id);
        changed = true;
      }
    }
    await mutate(`/v1/collections/${item.id}?revision=${item.revision}`, { method: "DELETE" });
    await savePreferences({
      collectionGroupByCollectionId: Object.fromEntries(Object.entries(collectionGroupMap()).filter(([id]) => !removed.has(id))),
      collectionIconByCollectionId: Object.fromEntries(Object.entries(state.preferences?.collectionIconByCollectionId || {}).filter(([id]) => !removed.has(id))),
    });
    if (removed.has(state.collectionId)) return switchView("all");
    return load();
  }
}

async function tagItemAction(action, tag) {
  state.tagItemMenu = null;
  let replacement = "";
  if (action === "rename") {
    const value = window.prompt(`将标签“${tag}”重命名为：`, tag);
    if (value == null) return renderSidebar();
    replacement = value.trim().replace(/^#/, "").slice(0, 100);
    if (!replacement || replacement === tag) return renderSidebar();
  } else if (!window.confirm(`要从所有书签中删除标签“${tag}”吗？`)) {
    return renderSidebar();
  }
  const key = tag.toLocaleLowerCase();
  const bookmarks = (await api("/v1/bookmarks?")).filter((item) => item.tags.some((value) => value.toLocaleLowerCase() === key));
  // ponytail: one PATCH per bookmark; add an atomic tag endpoint if bulk tag edits become slow.
  for (const item of bookmarks) {
    const tags = action === "rename"
      ? item.tags.map((value) => value.toLocaleLowerCase() === key ? replacement : value)
      : item.tags.filter((value) => value.toLocaleLowerCase() !== key);
    await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, tags }) });
  }
  if (state.tag.toLocaleLowerCase() === key) state.tag = action === "rename" ? replacement : "";
  await load();
}

function prepareCardActionProxies() {
  const proxy = (attribute) => {
    const button = document.createElement("button");
    button.hidden = true;
    button.dataset[attribute] = "";
    root.append(button);
    return button;
  };
  state.cardActionProxies = {
    edit: proxy("edit"),
    remove: proxy("delete"),
    restore: proxy("restoreBookmark"),
  };
}

function releaseCardActionProxies() {
  Object.values(state.cardActionProxies || {}).forEach((button) => button.remove());
}

function updateSelectAllControl() {
  const input = root.querySelector("#select-all input");
  if (!input) return;
  const items = sortedItems();
  const selected = items.filter((item) => state.selected.has(item.id));
  const allSelected = Boolean(items.length && selected.length === items.length);
  input.checked = allSelected;
  input.indeterminate = Boolean(selected.length && !allSelected);
}

function bindWorkspaceHeader() {
  const selectAll = root.querySelector("#select-all");
  const toggleSelectAll = () => {
    const items = sortedItems();
    const allSelected = items.length && items.every((item) => state.selected.has(item.id));
    if (allSelected) items.forEach((item) => state.selected.delete(item.id));
    else items.forEach((item) => state.selected.add(item.id));
    refreshSelectionUi();
  };
  if (selectAll) {
    selectAll.onclick = toggleSelectAll;
    selectAll.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleSelectAll();
    };
  }
  const selectionClear = root.querySelector("[data-selection-clear]");
  if (selectionClear) selectionClear.onclick = () => {
    state.selected.clear();
    state.selectionMoreOpen = false;
    refreshSelectionUi();
  };

  const viewTrigger = root.querySelector("[data-view-trigger]");
  if (viewTrigger) {
    const toggleViewMenu = () => {
      state.viewMenuOpen = !state.viewMenuOpen;
      if (state.viewMenuOpen) {
        state.sortMenuOpen = false;
        renderSortMenu();
      }
      renderViewMenu();
    };
    viewTrigger.onclick = (event) => {
      event.stopPropagation();
      toggleViewMenu();
    };
    viewTrigger.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleViewMenu();
    };
  }
  bindViewMenu();

  const sortTrigger = root.querySelector("[data-sort-trigger]");
  if (sortTrigger) {
    const toggleSortMenu = () => {
      state.sortMenuOpen = !state.sortMenuOpen;
      if (state.sortMenuOpen) {
        state.viewMenuOpen = false;
        renderViewMenu();
      }
      renderSortMenu();
    };
    sortTrigger.onclick = (event) => {
      event.stopPropagation();
      toggleSortMenu();
    };
    sortTrigger.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleSortMenu();
    };
  }
  bindSortMenu();

  root.querySelectorAll("[data-batch]").forEach((button) => button.onclick = () => batch(button.dataset.batch));
  const selectionMore = root.querySelector("[data-selection-more]");
  if (selectionMore) selectionMore.onclick = (event) => {
    event.stopPropagation();
    state.selectionMoreOpen = !state.selectionMoreOpen;
    refreshSelectionUi({ refreshHeader: true });
  };
  root.querySelectorAll("[data-selection-more-action]").forEach((button) => button.onclick = () => {
    const action = button.dataset.selectionMoreAction;
    state.selectionMoreOpen = false;
    if (action === "screenshot") {
      state.selectionScreenshotWorking = true;
      refreshSelectionUi({ refreshHeader: true });
      batch("screenshot").catch(showError).finally(() => {
        state.selectionScreenshotWorking = false;
        refreshSelectionUi({ refreshHeader: true });
      });
      return;
    }
    refreshSelectionUi({ refreshHeader: true });
    if (action === "refresh") {
      load().catch(showError);
      return;
    }
    batch(action === "remove-tags" ? "tags-remove" : action).catch(showError);
  });
  const selectionMove = root.querySelector("[data-selection-move]");
  if (selectionMove) selectionMove.onclick = openMovePicker;
  const selectionOpen = root.querySelector("[data-selection-open]");
  if (selectionOpen) selectionOpen.onclick = () => {
    const item = state.items.find((entry) => state.selected.has(entry.id));
    if (item?.link) window.open(item.link, "_blank", "noopener");
  };
  root.querySelector("#export").onclick = () => isPopupSurface()
    ? openFullPage("library.html?settings=backups")
    : api("/v1/export").then(downloadBackup).catch(showError);
  updateSelectAllControl();
}

function refreshSelectionUi({ refreshHeader = false } = {}) {
  const items = sortedItems();
  const selection = items.filter((item) => state.selected.has(item.id));
  if (!selection.length) state.selectionMoreOpen = false;
  const selecting = Boolean(selection.length);
  const cards = root.querySelector(".cards");
  cards?.classList.toggle("selection-mode", selecting);
  root.querySelectorAll("[data-drag-bookmark]").forEach((card) => {
    const selected = state.selected.has(card.dataset.dragBookmark);
    card.classList.toggle("selected", selected);
    card.classList.toggle("selection-mode", selecting);
    const input = card.querySelector("[data-select]");
    if (input) input.checked = selected;
  });
  const header = root.querySelector(".workspace-head");
  if (header && (refreshHeader || header.classList.contains("workspace-selection-head") !== selecting)) {
    header.outerHTML = localizeHtml(workspaceHeaderMarkup(items, selection));
    bindWorkspaceHeader();
    return;
  }
  updateSelectAllControl();
}

function bind() {
  ensureMobileSidebarControls();
  bindSidebarResizer();
  const accountTrigger = root.querySelector("[data-account-trigger]");
  if (accountTrigger) accountTrigger.onclick = (event) => {
    event.stopPropagation();
    setAccountMenuOpen(!state.accountMenuOpen);
  };
  root.querySelectorAll("[data-account-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    accountAction(button.dataset.accountAction).catch(showError);
  });
  const mobileSidebarToggle = root.querySelector("[data-mobile-sidebar-toggle]");
  if (mobileSidebarToggle) mobileSidebarToggle.onclick = (event) => {
    event.stopPropagation();
    setSidebarOpen(!state.sidebarOpen);
  };
  const mobileSidebarClose = root.querySelector("[data-mobile-sidebar-close]");
  if (mobileSidebarClose) mobileSidebarClose.onclick = (event) => {
    event.stopPropagation();
    setSidebarOpen(false);
  };
  root.querySelectorAll(".card-cover img").forEach((image) => {
    image.addEventListener("load", applyMasonryCoverSize, { once: true });
    image.addEventListener("error", () => { image.src = "icons/bookmark.svg"; applyMasonryCoverSize(); }, { once: true });
    if (image.complete) queueMicrotask(applyMasonryCoverSize);
  });
  root.querySelectorAll("[data-inline-collection-form]").forEach((form) => {
    const input = form.querySelector('input[name="name"]');
    let committing = false;
    const finish = () => {
      if (committing) return;
      committing = true;
      if (!input.value.trim()) {
        state.inlineCollectionCreate = null;
        renderSidebar();
        return;
      }
      createInlineCollection(form).catch((error) => {
        committing = false;
        showError(error);
      });
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      finish();
    };
    input.onblur = finish;
    input.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      committing = true;
      state.inlineCollectionCreate = null;
      renderSidebar();
    };
  });
  root.querySelectorAll("[data-copy-link]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    navigator.clipboard.writeText(button.dataset.copyLink).catch(showError);
  });
  root.querySelectorAll("[data-card-menu]").forEach((button) => button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.cardMenuId = state.cardMenuId === button.dataset.cardMenu ? null : button.dataset.cardMenu;
    renderCardMenu();
  });
  root.querySelectorAll("[data-card-menu-action]").forEach((button) => button.addEventListener("click", closeCardMenu));
  root.querySelectorAll("[data-card-collection]").forEach((link) => link.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    switchView("all", link.dataset.cardCollection);
  });
  root.querySelectorAll("[data-sidebar-toggle]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    const previousSections = Array.isArray(state.preferences?.collapsedSidebarSections) ? [...state.preferences.collapsedSidebarSections] : [];
    const sections = new Set(previousSections);
    sections.has(button.dataset.sidebarToggle) ? sections.delete(button.dataset.sidebarToggle) : sections.add(button.dataset.sidebarToggle);
    const nextSections = [...sections];
    state.preferences = { ...state.preferences, collapsedSidebarSections: nextSections };
    state.groupMenuId = null;
    state.collectionMenuId = null;
    state.tagMenuOpen = false;
    state.tagItemMenu = null;
    renderSidebar();
    persistSidebarPreferences({ collapsedSidebarSections: nextSections }, { collapsedSidebarSections: previousSections });
  });
  root.querySelectorAll("[data-group-menu]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.collectionMenuId = null;
    state.tagItemMenu = null;
    state.groupMenuId = state.groupMenuId === button.dataset.groupMenu ? null : button.dataset.groupMenu;
    renderSidebar();
  });
  root.querySelectorAll("[data-tag-menu]").forEach((button) => button.onclick = (event) => {
    event.stopImmediatePropagation();
    state.groupMenuId = null;
    state.collectionMenuId = null;
    state.tagItemMenu = null;
    state.tagMenuOpen = !state.tagMenuOpen;
    renderSidebar();
  });
  root.querySelectorAll("[data-tag-item-menu]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.groupMenuId = null;
    state.collectionMenuId = null;
    state.tagMenuOpen = false;
    state.tagItemMenu = state.tagItemMenu === button.dataset.tagItemMenu ? null : button.dataset.tagItemMenu;
    renderSidebar();
  });
  root.querySelectorAll("[data-tag-item-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    tagItemAction(button.dataset.tagItemAction, button.dataset.tagValue).catch(showError);
  });
  root.querySelectorAll("[data-tag-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.tagMenuOpen = false;
    if (button.dataset.tagAction === "hide") {
      const previousSections = Array.isArray(state.preferences?.collapsedSidebarSections) ? [...state.preferences.collapsedSidebarSections] : [];
      const sections = new Set(previousSections);
      sections.add("tags");
      const nextSections = [...sections];
      state.preferences = { ...state.preferences, collapsedSidebarSections: nextSections };
      renderSidebar();
      persistSidebarPreferences({ collapsedSidebarSections: nextSections }, { collapsedSidebarSections: previousSections });
    } else {
      const previousTagSort = state.preferences?.tagSort;
      state.preferences = { ...state.preferences, tagSort: button.dataset.tagAction };
      renderSidebar();
      persistSidebarPreferences({ tagSort: button.dataset.tagAction }, { tagSort: previousTagSort });
    }
  });
  root.querySelectorAll("[data-group-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    groupAction(button.dataset.groupAction, button.dataset.groupId).catch(showError);
  });
  root.querySelectorAll("[data-collection-menu]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.groupMenuId = null;
    state.tagItemMenu = null;
    state.collectionMenuId = state.collectionMenuId === button.dataset.collectionMenu ? null : button.dataset.collectionMenu;
    renderSidebar();
  });
  root.querySelectorAll("[data-collection-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    collectionAction(button.dataset.collectionAction, button.dataset.collectionId).catch(showError);
  });
  root.querySelectorAll("[data-select-collection]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    const id = button.dataset.selectCollection;
    state.collectionSelection.ids.has(id) ? state.collectionSelection.ids.delete(id) : state.collectionSelection.ids.add(id);
    renderSidebar();
  });
  root.querySelectorAll("[data-selection-action]").forEach((button) => button.onclick = () => {
    const action = button.dataset.selectionAction;
    if (action === "cancel") state.collectionSelection = null;
    else if (action === "all") state.collectionSelection.ids = new Set(collectionsInGroup(state.collectionSelection.groupId).map((item) => item.id));
    else if (action === "delete") return deleteSelectedCollections().catch(showError);
    else if (action === "merge") return mergeSelectedCollections().catch(showError);
    renderSidebar();
  });
  root.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => switchView(button.dataset.view));
  root.querySelectorAll("[data-collection]").forEach((button) => button.onclick = () => switchView("all", button.dataset.collection));
  root.querySelectorAll("[data-empty-action]").forEach((button) => button.onclick = () => {
    if (button.dataset.emptyAction === "clear-search") {
      state.query = "";
      state.selected.clear();
      updateLibraryRoute();
      return load().catch(showError);
    }
    if (button.dataset.emptyAction === "all") return switchView("all");
    root.querySelector("#add-bookmark")?.click();
  });
  root.querySelectorAll("[data-search-query]").forEach((button) => button.onclick = () => {
    state.view = "all";
    state.collectionId = null;
    state.tag = "";
    state.selected.clear();
    commitSearch(button.dataset.searchQuery === state.query ? "" : button.dataset.searchQuery, false, "push");
  });
  root.querySelectorAll("[data-tag]").forEach((button) => button.onclick = () => {
    state.tagItemMenu = null;
    state.tag = button.dataset.tag === state.tag ? "" : button.dataset.tag;
    state.selected.clear();
    render();
  });
  bindWorkspaceHeader();
  root.querySelectorAll("[data-toggle-collection]").forEach((button) => button.onclick = () => {
    const id = button.dataset.toggleCollection;
    state.collapsedCollections.has(id) ? state.collapsedCollections.delete(id) : state.collapsedCollections.add(id);
    const collapsedCollectionIds = [...state.collapsedCollections];
    renderSidebar();
    savePreferences({ collapsedCollectionIds }).catch(showError);
  });
  root.querySelectorAll("[data-restore-collection]").forEach((button) => button.onclick = async () => {
    const item = state.trashedCollections.find((entry) => entry.id === button.dataset.restoreCollection);
    await mutate(`/v1/collections/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    load().catch(showError);
  });
  const searchToggle = root.querySelector("[data-search-filter-toggle]");
  if (searchToggle) searchToggle.onclick = (event) => {
    event.stopPropagation();
    const nextOpen = !state.searchMenuOpen;
    state.searchMenuOpen = nextOpen;
    const search = root.querySelector("#search");
    if (nextOpen) search?.focus();
    else {
      if (document.activeElement === search) search.blur();
      queueMicrotask(() => searchToggle.blur());
    }
    renderSearchMenu();
  };
  if (searchToggle) searchToggle.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    searchToggle.click();
  };
  bindSearchMenu();
  const search = root.querySelector("#search");
  const openSearchMenu = () => {
    if (state.searchMenuOpen) return;
    state.searchMenuOpen = true;
    renderSearchMenu();
  };
  search.addEventListener("focus", openSearchMenu);
  search.addEventListener("click", openSearchMenu);
  search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      commitSearch(search.value);
    }, 180);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    commitSearch(search.value, true, "push");
  });
  root.querySelectorAll("[data-select]").forEach((input) => input.onchange = () => {
    input.checked ? state.selected.add(input.dataset.select) : state.selected.delete(input.dataset.select);
    refreshSelectionUi();
  });
  root.querySelectorAll("[data-favorite]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.favorite);
    await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, favorite: !item.favorite }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-ask]").forEach((button) => button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const edit = [...root.querySelectorAll("[data-edit]")].find((candidate) => candidate.dataset.edit === button.dataset.ask);
    if (recommendationsEnabled() && edit) return edit.click();
    showError(new TypeError(t("询问功能暂未接入。")));
  });
  root.querySelectorAll('[data-button="preview"], [data-button="web"]').forEach((button) => button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    showError(new TypeError(t("预览功能暂未接入。")));
  });
  prepareCardActionProxies();
  root.querySelectorAll("[data-edit]").forEach((button) => button.onclick = () => {
    const item = state.items.find((entry) => entry.id === button.dataset.edit);
    if (!item) return;
    const form = editBookmarkDialog.querySelector("form");
    if (editBookmarkDialog.open && state.editingId === item.id) {
      if (button.dataset.editFocus === "tags") form.querySelector("#edit-tag-input")?.focus();
      return;
    }
    if (editBookmarkDialog.open && editFormIsDirty() && !window.confirm("当前编辑尚未保存，切换会放弃修改。确定继续吗？")) return;
    state.editingId = item.id;
    form._recommendationCreatedCollections = [];
    form.elements.link.value = item.link;
    form.elements.title.value = item.title;
    form.elements.description.value = item.description;
    form.elements.note.value = item.note;
    form.elements.reminder.value = dateTimeInputValue(item.reminder);
    form.elements.cover.value = item.cover || "";
    form.elements.media.value = JSON.stringify(Array.isArray(item.media) ? item.media : []);
    form.elements.collectionId.innerHTML = collectionOptions(state.collections, item.collectionId);
    const coverTrigger = form.querySelector("#edit-cover-trigger");
    coverTrigger.querySelector("#edit-cover-more").innerHTML = treeIcon("caret");
    coverTrigger.onclick = () => openCoverPicker();
    const collectionTrigger = form.querySelector("#edit-collection-trigger");
    const collectionLabel = form.querySelector("#edit-collection-name");
    const collectionSearch = collectionPickerDialog.querySelector("#collection-picker-search");
    const collectionList = collectionPickerDialog.querySelector("#collection-picker-list");
    const syncCollection = () => {
      const collectionId = form.elements.collectionId.value;
      form.querySelector(".edit-collection-icon").innerHTML = collectionIconMarkup(collectionIconValue(collectionId), false, collectionId === "unsorted");
      form.querySelector(".edit-collection-arrow").innerHTML = treeIcon("caret");
      collectionLabel.textContent = collectionPath(form.elements.collectionId.value);
      collectionTrigger.title = collectionLabel.textContent;
    };
    const finishPickerCollection = async (inlineForm) => {
      if (inlineForm.dataset.committing) return;
      inlineForm.dataset.committing = "true";
      if (!inlineForm.elements.name.value.trim()) {
        state.inlineCollectionCreate = null;
        renderCollections();
        collectionSearch.focus();
        return;
      }
      try {
        const created = await createInlineCollection(inlineForm);
        if (!created) return;
        form.elements.collectionId.innerHTML = collectionOptions(state.collections, created.id);
        syncCollection();
        collectionPickerDialog.close();
      } catch (error) {
        delete inlineForm.dataset.committing;
        showError(error);
      }
    };
    const renderCollections = () => {
      collectionList.innerHTML = collectionPickerRows(collectionSearch.value, form.elements.collectionId.value);
      const inlineInput = collectionList.querySelector("[data-inline-collection-form] input");
      if (inlineInput) inlineInput.onblur = () => finishPickerCollection(inlineInput.form);
      positionSidebarMenus();
    };
    syncCollection();
    collectionTrigger.onclick = () => {
      state.pickerCollectionMenuId = null;
      state.pickerGroupMenuId = null;
      state.inlineCollectionCreate = null;
      collectionSearch.value = "";
      collectionPickerDialog.querySelector(".collection-picker-search-icon").innerHTML = treeIcon("search");
      collectionPickerDialog.querySelector("#collection-picker-close").innerHTML = treeIcon("close");
      renderCollections();
      collectionPickerDialog.showModal();
      queueMicrotask(() => collectionSearch.focus());
    };
    collectionSearch.oninput = () => {
      state.pickerCollectionMenuId = null;
      state.pickerGroupMenuId = null;
      state.inlineCollectionCreate = null;
      renderCollections();
    };
    collectionList.onclick = (event) => {
      const createMain = event.target.closest("[data-picker-create-main]");
      if (createMain) {
        state.pickerCollectionMenuId = null;
        state.inlineCollectionCreate = { surface: "picker", groupId: createMain.dataset.pickerCreateMain, parentId: null };
        renderCollections();
        focusInlineCollection("picker");
        return;
      }
      const groupMenuButton = event.target.closest("[data-picker-group-menu]");
      if (groupMenuButton) {
        state.pickerCollectionMenuId = null;
        state.pickerGroupMenuId = state.pickerGroupMenuId === groupMenuButton.dataset.pickerGroupMenu ? null : groupMenuButton.dataset.pickerGroupMenu;
        renderCollections();
        return;
      }
      const groupMenuAction = event.target.closest("[data-picker-group-action]");
      if (groupMenuAction) {
        const actionName = groupMenuAction.dataset.pickerGroupAction;
        const groupId = groupMenuAction.dataset.groupId;
        state.pickerGroupMenuId = null;
        if (actionName === "create-collection") {
          state.inlineCollectionCreate = { surface: "picker", groupId, parentId: null };
          renderCollections();
          focusInlineCollection("picker");
          return;
        }
        if (actionName === "collapse" || actionName === "expand") {
          state.collapsedCollections = actionName === "collapse" ? new Set(expandableCollectionIds()) : new Set();
          renderCollections();
          savePreferences({ collapsedCollectionIds: [...state.collapsedCollections] }).catch(showError);
          return;
        }
        collectionPickerDialog.close();
        groupAction(actionName, groupId).catch(showError);
        return;
      }
      const toggle = event.target.closest("[data-picker-toggle-collection]");
      if (toggle) {
        event.stopPropagation();
        const id = toggle.dataset.pickerToggleCollection;
        state.collapsedCollections.has(id) ? state.collapsedCollections.delete(id) : state.collapsedCollections.add(id);
        renderCollections();
        savePreferences({ collapsedCollectionIds: [...state.collapsedCollections] }).catch(showError);
        return;
      }
      const menuButton = event.target.closest("[data-picker-collection-menu]");
      if (menuButton) {
        state.pickerCollectionMenuId = state.pickerCollectionMenuId === menuButton.dataset.pickerCollectionMenu ? null : menuButton.dataset.pickerCollectionMenu;
        renderCollections();
        return;
      }
      const action = event.target.closest("[data-picker-collection-action]");
      if (action) {
        state.pickerCollectionMenuId = null;
        if (action.dataset.pickerCollectionAction === "create-child") {
          const parent = state.collections.find((entry) => entry.id === action.dataset.collectionId);
          if (!parent) return;
          state.collapsedCollections.delete(parent.id);
          state.inlineCollectionCreate = { surface: "picker", groupId: collectionGroupId(parent), parentId: parent.id };
          renderCollections();
          focusInlineCollection("picker");
          return;
        }
        collectionPickerDialog.close();
        collectionAction(action.dataset.pickerCollectionAction, action.dataset.collectionId).catch(showError);
        return;
      }
      const option = event.target.closest("[data-pick-collection]");
      if (!option) return;
      form.elements.collectionId.value = option.dataset.pickCollection;
      syncCollection();
      collectionPickerDialog.close();
    };
    collectionList.onsubmit = async (event) => {
      const inlineForm = event.target.closest("[data-inline-collection-form]");
      if (!inlineForm) return;
      event.preventDefault();
      finishPickerCollection(inlineForm);
    };
    collectionList.onkeydown = (event) => {
      if (event.key !== "Escape" || !event.target.closest("[data-inline-collection-form]")) return;
      event.stopPropagation();
      event.target.closest("[data-inline-collection-form]").dataset.committing = "true";
      state.inlineCollectionCreate = null;
      renderCollections();
      collectionSearch.focus();
    };
    const collectionPickerBack = collectionPickerDialog.querySelector("#collection-picker-back");
    if (collectionPickerBack) {
      collectionPickerBack.innerHTML = treeIcon("back");
      collectionPickerBack.onclick = () => collectionPickerDialog.close();
    }
    collectionPickerDialog.querySelector("#collection-picker-close").onclick = () => collectionPickerDialog.close();
    collectionPickerDialog.onclose = () => {
      state.pickerCollectionMenuId = null;
      state.pickerGroupMenuId = null;
      if (state.inlineCollectionCreate?.surface === "picker") state.inlineCollectionCreate = null;
    };
    collectionPickerDialog.onclick = (event) => {
      if (!state.pickerCollectionMenuId || event.target.closest("[data-picker-collection-menu], [data-picker-collection-menu-panel]")) return;
      state.pickerCollectionMenuId = null;
      renderCollections();
    };
    const tagValue = form.elements.tags;
    const tagInput = form.querySelector("#edit-tag-input");
    const tagTokens = form.querySelector("#edit-tag-tokens");
    const tagField = form.querySelector(".edit-tags-field");
    const tagMenu = form.querySelector("#edit-tag-menu");
    const availableTags = tagList(state.items);
    let editTags = [...item.tags];
    const candidate = () => tagInput.value.trim().replace(/^#/, "").slice(0, 100);
    const syncTags = () => {
      tagValue.value = JSON.stringify(editTags);
      tagTokens.innerHTML = editTags.map((tag, index) => `<span class="edit-tag-token"><span>#</span><span>${escapeHtml(tag)}</span><button type="button" data-remove-edit-tag="${index}" aria-label="${t("删除标签")} ${escapeHtml(tag)}">×</button></span>`).join("");
      syncRecommendationTagButtons(form);
    };
    const updateTagMenu = () => {
      const value = candidate();
      const selected = new Set(editTags.map((tag) => tag.toLocaleLowerCase()));
      const matches = value ? availableTags.filter(([tag]) => tag.toLocaleLowerCase().includes(value.toLocaleLowerCase()) && !selected.has(tag.toLocaleLowerCase())).slice(0, 8) : [];
      const canCreate = value && !selected.has(value.toLocaleLowerCase()) && !availableTags.some(([tag]) => tag.toLocaleLowerCase() === value.toLocaleLowerCase());
      tagMenu.innerHTML = matches.length
        ? matches.map(([tag, count], index) => `<button type="button" role="option" aria-selected="${index === 0}" data-tag-option="${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><small>${count}</small></button>`).join("")
        : canCreate ? `<button type="button" role="option" aria-selected="true" data-create-tag><span>${escapeHtml(value)}</span><small>${t("新标签")}</small></button>` : "";
      tagMenu.hidden = !tagMenu.innerHTML;
      tagField.setAttribute("aria-expanded", String(Boolean(tagMenu.innerHTML)));
    };
    const addTag = (value) => {
      if (!value || editTags.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
      editTags.push(value);
      tagInput.value = "";
      syncTags();
      updateTagMenu();
      tagInput.focus();
    };
    syncTags();
    tagInput.value = "";
    updateTagMenu();
    tagField.onclick = () => tagInput.focus();
    tagInput.oninput = updateTagMenu;
    tagInput.onblur = () => {
      tagMenu.hidden = true;
      tagField.setAttribute("aria-expanded", "false");
    };
    tagInput.onkeydown = (event) => {
      if (event.key === "Enter" && candidate()) {
        event.preventDefault();
        addTag(tagMenu.querySelector("[data-tag-option]")?.dataset.tagOption || candidate());
      } else if (event.key === "Backspace" && !tagInput.value && editTags.length) {
        editTags.pop();
        syncTags();
      } else if (event.key === "Escape") {
        tagMenu.hidden = true;
        tagField.setAttribute("aria-expanded", "false");
      }
    };
    tagTokens.onclick = (event) => {
      const button = event.target.closest("[data-remove-edit-tag]");
      if (!button) return;
      editTags.splice(Number(button.dataset.removeEditTag), 1);
      syncTags();
      updateTagMenu();
      tagInput.focus();
    };
    tagMenu.onmousedown = (event) => event.preventDefault();
    tagMenu.onclick = (event) => {
      const option = event.target.closest("[data-tag-option], [data-create-tag]");
      if (option) addTag(option.dataset.tagOption || candidate());
    };
    editBookmarkDialog.dataset.bookmarkId = item.id;
    bindRecommendationForm(form, {
      getTags: () => [...editTags],
      setTags: (tags) => { editTags = [...tags]; syncTags(); updateTagMenu(); },
      syncCollection,
    });
    form.elements.favorite.checked = item.favorite;
    const notePreview = editBookmarkDialog.querySelector("#edit-note-preview");
    const markdownButton = editBookmarkDialog.querySelector("#edit-note-markdown");
    form.elements.note.hidden = false;
    notePreview.hidden = true;
    markdownButton.setAttribute("aria-pressed", "false");
    markdownButton.setAttribute("aria-label", t("预览 Markdown"));
    markdownButton.title = t("预览 Markdown");
    markdownButton.textContent = "M↓";
    markdownButton.onclick = () => {
      const previewing = markdownButton.getAttribute("aria-pressed") === "true";
      markdownButton.setAttribute("aria-pressed", String(!previewing));
      markdownButton.setAttribute("aria-label", previewing ? t("预览 Markdown") : t("编辑 Markdown"));
      markdownButton.title = previewing ? t("预览 Markdown") : t("编辑 Markdown");
      markdownButton.textContent = previewing ? "M↓" : "M↑";
      form.elements.note.hidden = !previewing;
      notePreview.hidden = previewing;
      if (!previewing) notePreview.innerHTML = renderMarkdown(form.elements.note.value);
    };
    syncEditCoverPreview(item);
    editBookmarkDialog.querySelector("#edit-open-link").href = item.link;
    editBookmarkDialog.querySelector("#edit-saved-at").textContent = `${t("已保存 ")}${dateTimeLabel(item.updatedAt || item.createdAt)}`;
    const deleteButton = editBookmarkDialog.querySelector("#edit-delete");
    deleteButton.textContent = t(state.view === "trash" ? "恢复" : "删除");
    deleteButton.onclick = async () => {
      if (state.view === "trash") await mutate(`/v1/bookmarks/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
      else {
        if (!window.confirm(`要将“${item.title || item.link}”移入废纸篓吗？`)) return;
        await mutate(`/v1/bookmarks/${item.id}?revision=${item.revision}`, { method: "DELETE" });
      }
      editBookmarkDialog.close("cancel");
      load().catch(showError);
    };
    editBookmarkDialog.dataset.highlights = JSON.stringify(item.highlights);
    const highlightsButton = form.querySelector("#edit-highlights");
    if (highlightsButton) highlightsButton.onclick = () => {
      editBookmarkDialog.dataset.highlights = JSON.stringify(editHighlights({ ...item, highlights: JSON.parse(editBookmarkDialog.dataset.highlights) }));
    };
    if (!editBookmarkDialog.open) editBookmarkDialog.show();
    state.editSnapshot = editFormSnapshot();
    syncEditPanelLayout();
    if (button.dataset.editFocus === "tags") queueMicrotask(() => form.querySelector("#edit-tag-input")?.focus());
  });
  root.querySelectorAll("[data-delete]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.delete);
    if (state.view === "trash") await mutate(`/v1/bookmarks/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    else await mutate(`/v1/bookmarks/${item.id}?revision=${item.revision}`, { method: "DELETE" });
    load().catch(showError);
  });
  root.querySelectorAll("[data-restore-bookmark]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.restoreBookmark);
    if (!item) return;
    await mutate(`/v1/bookmarks/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    load().catch(showError);
  });
  releaseCardActionProxies();
  root.querySelectorAll("#new-collection, #new-collection-secondary").forEach((button) => button.onclick = async () => {
    const parent = state.collections.find((item) => item.id === state.collectionId && item.id !== "unsorted");
    const groupId = parent ? collectionGroupId(parent) : "default";
    if (sidebarSectionCollapsed("collections")) {
      const sections = new Set(state.preferences?.collapsedSidebarSections || []);
      sections.delete("collections");
      await savePreferences({ collapsedSidebarSections: [...sections] });
    }
    state.inlineCollectionCreate = { surface: "sidebar", groupId, parentId: parent?.id || null };
    if (parent) state.collapsedCollections.delete(parent.id);
    renderSidebar();
    focusInlineCollection("sidebar");
  });
  root.querySelector("#add-bookmark").onclick = () => {
    const form = bookmarkDialog.querySelector("form");
    form.reset();
    form.elements.tags.value = "[]";
    form._recommendationCreatedCollections = [];
    form.elements.collectionId.innerHTML = collectionOptions(state.collections, state.collectionId || state.preferences.defaultCollectionId);
    bindRecommendationForm(form, {
      getTags: () => {
        try { return JSON.parse(form.elements.tags.value || "[]"); } catch { return []; }
      },
      setTags: (tags) => { form.elements.tags.value = JSON.stringify(tags); },
    });
    bookmarkDialog.showModal();
  };
  root.querySelector("#import").onclick = () => isPopupSurface()
    ? openFullPage("library.html?settings=import")
    : setSettingsRoute(true, "import");
  root.querySelector("#check-links").onclick = () => {
    if (!state.connectionInfo) return;
    return api("/v1/health-checks", { method: "POST", body: JSON.stringify({ collectionId: state.collectionId }) }).then(() => load()).catch(showError);
  };
  root.querySelector("[data-theme-trigger]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.themeMenuOpen = !state.themeMenuOpen;
    renderThemeMenu();
  });
  bindThemeMenu();
  bindDragDrop();
}

function clearDropTargets() {
  root.querySelectorAll(".drop-before, .drop-after, .is-dragging").forEach((element) => element.classList.remove("drop-before", "drop-after", "is-dragging"));
}

function beforeTarget(element, event, grid = false) {
  const rect = element.getBoundingClientRect();
  return grid ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2;
}

function markDropTarget(element, before) {
  clearDropTargets();
  element.classList.add(before ? "drop-before" : "drop-after");
}

function bindDragDrop() {
  root.querySelectorAll("[data-drag-bookmark]").forEach((element) => {
    element.ondragstart = (event) => {
      state.dragBookmark = element.dataset.dragBookmark;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.dragBookmark);
      element.classList.add("is-dragging");
    };
    element.ondragover = (event) => {
      const item = state.items.find((entry) => entry.id === state.dragBookmark);
      const target = state.items.find((entry) => entry.id === element.dataset.dragBookmark);
      if (!item || !target || item.id === target.id || item.collectionId !== target.collectionId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      markDropTarget(element, beforeTarget(element, event, state.layout === "grid"));
    };
    element.ondrop = (event) => {
      event.preventDefault();
      const before = beforeTarget(element, event, state.layout === "grid");
      reorderBookmark(element.dataset.dragBookmark, before).catch(showError);
    };
    element.ondragend = () => { state.dragBookmark = null; clearDropTargets(); };
  });
  root.querySelectorAll("[data-drop-collection]").forEach((element) => {
    element.ondragover = (event) => {
      const item = state.collections.find((entry) => entry.id === state.dragCollection);
      const target = state.collections.find((entry) => entry.id === element.dataset.dropCollection);
      if (!item || !target || item.id === target.id || item.parentId !== target.parentId) return;
      event.preventDefault();
      markDropTarget(element, beforeTarget(element, event));
    };
    element.ondrop = (event) => {
      event.preventDefault();
      reorderCollection(element.dataset.dropCollection, beforeTarget(element, event)).catch(showError);
    };
  });
  root.querySelectorAll("[data-drag-collection]").forEach((element) => {
    element.ondragstart = (event) => {
      state.dragCollection = element.dataset.dragCollection;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.dragCollection);
      element.classList.add("is-dragging");
    };
    element.ondragend = () => { state.dragCollection = null; clearDropTargets(); };
  });
}

function editHighlights(item) {
  if (!item.highlights.length) return item.highlights;
  const summary = item.highlights.map((highlight, index) => `${index + 1}. “${String(highlight.text || "").slice(0, 80)}” · ${highlight.color || "#ffe920"} · ${highlight.note || "（无备注）"}`).join("\n");
  const choice = window.prompt(`高亮：\n${summary}\n\n输入编号编辑，或输入 d<编号> 删除；留空则保持不变。`, "");
  if (!choice?.trim()) return item.highlights;
  const remove = choice.trim().match(/^d(\d+)$/i);
  const index = Number(remove?.[1] || choice) - 1;
  if (!Number.isInteger(index) || !item.highlights[index]) throw new TypeError("请选择列表中的高亮编号");
  if (remove) return item.highlights.filter((_, current) => current !== index);
  const current = item.highlights[index];
  const color = window.prompt("颜色（#ffe920、#0064ff、#00c564 或 #ff4646）", current.color || "#ffe920");
  if (color == null) return item.highlights;
  if (!["#ffe920", "#0064ff", "#00c564", "#ff4646"].includes(color.toLocaleLowerCase())) throw new TypeError("请选择四种预设颜色之一");
  const note = window.prompt("备注", current.note || "");
  if (note == null) return item.highlights;
  return item.highlights.map((highlight, currentIndex) => currentIndex === index ? { ...highlight, color: color.toLocaleLowerCase(), note: note.trim() } : highlight);
}

function downloadBackup(backup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `私有书签-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

function openBatchTagDialog(mode = "add") {
  if (!batchTagDialog) return Promise.resolve(null);
  const form = batchTagDialog.querySelector("form");
  const title = batchTagDialog.querySelector("#batch-tag-title");
  const submit = batchTagDialog.querySelector("#batch-tag-submit");
  const input = batchTagDialog.querySelector("#batch-tag-input");
  const tokens = batchTagDialog.querySelector("#batch-tag-tokens");
  const field = batchTagDialog.querySelector(".batch-tag-input-wrap");
  const menu = batchTagDialog.querySelector("#batch-tag-menu");
  const back = batchTagDialog.querySelector("#batch-tag-back");
  const close = batchTagDialog.querySelector("#batch-tag-close");
  const availableTags = tagList(state.allItems?.length ? state.allItems : state.items);
  const selectedTags = [];
  let highlighted = 0;
  let settled = false;
  const label = t(mode === "remove" ? "移除标签" : "添加标签");
  title.textContent = label;
  submit.textContent = label;
  back.innerHTML = treeIcon("back");
  close.innerHTML = treeIcon("close");

  const normalized = (value) => String(value || "").trim().replace(/^#/, "").slice(0, 100);
  const candidate = () => normalized(input.value);
  const selected = () => new Set(selectedTags.map((tag) => tag.toLocaleLowerCase()));
  const options = () => {
    const query = candidate().toLocaleLowerCase();
    const picked = selected();
    const matches = availableTags.filter(([tag]) => !picked.has(tag.toLocaleLowerCase()) && (!query || tag.toLocaleLowerCase().includes(query))).slice(0, 8);
    const canCreate = candidate() && !picked.has(candidate().toLocaleLowerCase()) && !availableTags.some(([tag]) => tag.toLocaleLowerCase() === candidate().toLocaleLowerCase());
    return canCreate ? [...matches, [candidate(), null, true]].slice(0, 8) : matches;
  };
  const renderOptions = () => {
    const list = options();
    highlighted = Math.min(highlighted, Math.max(0, list.length - 1));
    menu.innerHTML = list.map(([tag, count, create], index) => `<button type="button" class="batch-tag-option${index === highlighted ? " active" : ""}" role="option" aria-selected="${index === highlighted}" data-batch-tag-option="${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><small>${create ? t("新标签") : count}</small></button>`).join("");
    menu.hidden = !list.length;
    field.setAttribute("aria-expanded", String(Boolean(list.length)));
  };
  const renderTokens = () => {
    tokens.innerHTML = selectedTags.map((tag, index) => `<span class="batch-tag-token"><span>#</span><span>${escapeHtml(tag)}</span><button type="button" data-remove-batch-tag="${index}" aria-label="${t("删除标签")} ${escapeHtml(tag)}">×</button></span>`).join("");
    submit.disabled = !selectedTags.length;
  };
  const render = () => { renderTokens(); renderOptions(); };
  const add = (value) => {
    const tag = normalized(value);
    if (!tag || selected().has(tag.toLocaleLowerCase())) return;
    selectedTags.push(tag);
    input.value = "";
    highlighted = 0;
    render();
    input.focus();
  };
  const addValues = (value) => String(value || "").split(",").map((part) => normalized(part)).filter(Boolean).forEach(add);
  const finish = (result) => {
    if (settled) return;
    settled = true;
    form.onsubmit = null;
    input.oninput = null;
    input.onkeydown = null;
    input.onblur = null;
    menu.onclick = null;
    menu.onmousedown = null;
    tokens.onclick = null;
    back.onclick = null;
    close.onclick = null;
    batchTagDialog.oncancel = null;
    batchTagDialog.onclose = null;
    if (batchTagDialog.open) batchTagDialog.close();
    resolve(result);
  };

  return new Promise((resolve) => {
    const cancel = () => finish(null);
    form.onsubmit = (event) => {
      event.preventDefault();
      addValues(input.value);
      if (selectedTags.length) finish({ type: "tags", mode, tags: [...selectedTags] });
    };
    input.oninput = () => { highlighted = 0; renderOptions(); };
    input.onfocus = renderOptions;
    input.onkeydown = (event) => {
      const list = options();
      if (event.key === "ArrowDown" && list.length) {
        event.preventDefault();
        highlighted = (highlighted + 1) % list.length;
        renderOptions();
      } else if (event.key === "ArrowUp" && list.length) {
        event.preventDefault();
        highlighted = (highlighted + list.length - 1) % list.length;
        renderOptions();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const option = list[highlighted];
        add(option?.[0] || input.value);
      } else if (event.key === "Backspace" && !input.value && selectedTags.length) {
        selectedTags.pop();
        highlighted = 0;
        render();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    menu.onmousedown = (event) => event.preventDefault();
    menu.onclick = (event) => {
      const option = event.target.closest("[data-batch-tag-option]");
      if (option) add(option.dataset.batchTagOption);
    };
    tokens.onclick = (event) => {
      const remove = event.target.closest("[data-remove-batch-tag]");
      if (!remove) return;
      selectedTags.splice(Number(remove.dataset.removeBatchTag), 1);
      render();
      input.focus();
    };
    back.onclick = cancel;
    close.onclick = cancel;
    batchTagDialog.oncancel = (event) => { event.preventDefault(); cancel(); };
    batchTagDialog.onclose = () => { if (!settled) cancel(); };
    input.value = "";
    render();
    batchTagDialog.showModal();
    queueMicrotask(() => input.focus());
  });
}

async function batch(kind, collectionId) {
  const tagAction = kind === "tags" || kind === "tags-remove" ? await openBatchTagDialog(kind === "tags-remove" ? "remove" : "add") : null;
  if ((kind === "tags" || kind === "tags-remove") && !tagAction) return;
  const action = kind === "screenshot" ? { type: "screenshot" } : kind === "move" ? { type: "move", collectionId } : kind === "trash" ? { type: "trash" } : kind === "restore" ? { type: "restore" } : tagAction || { type: "favorite", favorite: kind === "favorite" };
  const items = state.items.filter((item) => state.selected.has(item.id)).map(({ id, revision }) => ({ id, revision }));
  await mutate("/v1/bookmarks/batch", { method: "POST", body: JSON.stringify({ items, action }) });
  state.selected.clear();
  load().catch(showError);
}

function positionAt(items, movingId, targetId, before) {
  const moving = items.find((item) => item.id === movingId);
  const ordered = items.filter((item) => item.id !== movingId);
  const target = ordered.findIndex((item) => item.id === targetId);
  ordered.splice(target < 0 ? ordered.length : target + (before ? 0 : 1), 0, moving);
  const index = ordered.findIndex((item) => item.id === movingId);
  const previous = ordered[index - 1]?.position;
  const next = ordered[index + 1]?.position;
  return previous == null ? (next ?? 0) - 1 : next == null ? previous + 1 : (previous + next) / 2;
}

async function reorderBookmark(targetId, before) {
  if (!state.dragBookmark || state.dragBookmark === targetId) return;
  const item = state.items.find((entry) => entry.id === state.dragBookmark);
  const target = state.items.find((entry) => entry.id === targetId);
  if (!item || !target || item.collectionId !== target.collectionId) return;
  const position = positionAt(state.items.filter((entry) => entry.collectionId === item.collectionId), item.id, targetId, before);
  state.dragBookmark = null;
  clearDropTargets();
  await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, position }) });
  load().catch(showError);
}

async function reorderCollection(targetId, before) {
  if (!state.dragCollection || state.dragCollection === targetId) return;
  const item = state.collections.find((entry) => entry.id === state.dragCollection);
  const target = state.collections.find((entry) => entry.id === targetId);
  if (!item || !target || item.parentId !== target.parentId) return;
  const siblings = state.collections.filter((entry) => entry.parentId === item.parentId);
  const position = positionAt(siblings, item.id, targetId, before);
  state.dragCollection = null;
  clearDropTargets();
  await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, position }) });
  load().catch(showError);
}

collectionValueDialog.addEventListener("close", async () => {
  const action = state.collectionValueAction;
  const item = state.collections.find((entry) => entry.id === state.collectionValueId);
  state.collectionValueAction = null;
  state.collectionValueId = null;
  if (collectionValueDialog.returnValue !== "save" || !item) return;
  const value = collectionValueDialog.querySelector("form").elements.value.value.trim();
  if (action === "rename") {
    await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, name: value }) });
    return load();
  }
});

collectionShareDialog.querySelector("#copy-collection-share").onclick = () => {
  navigator.clipboard.writeText(collectionShareDialog.querySelector("textarea").value)
    .then(() => window.alert("收藏集内容已复制到剪贴板。"))
    .catch(showError);
};

collectionShareDialog.querySelector("#system-collection-share").onclick = () => {
  navigator.share({ title: collectionShareDialog.dataset.title, text: collectionShareDialog.querySelector("textarea").value })
    .catch((error) => { if (error.name !== "AbortError") showError(error); });
};

bookmarkDialog.addEventListener("close", async () => {
  const form = bookmarkDialog.querySelector("form");
  if (bookmarkDialog.returnValue !== "create") {
    if (await cleanupRecommendationCollections(form)) load().catch(showError);
    return;
  }
  try {
    const fields = new FormData(form);
    await api("/v1/bookmarks", { method: "POST", body: JSON.stringify({ link: fields.get("link"), title: fields.get("title"), note: fields.get("note"), tags: JSON.parse(fields.get("tags") || "[]"), collectionId: fields.get("collectionId") }) });
    form.reset();
    form._recommendationCreatedCollections = [];
  } catch (error) {
    if (await cleanupRecommendationCollections(form)) load().catch(showError);
    showError(error);
    return;
  }
  load().catch(showError);
});

editBookmarkDialog.addEventListener("close", async () => {
  const form = editBookmarkDialog.querySelector("form");
  const bookmarkId = state.editingId || editBookmarkDialog.dataset.bookmarkId;
  state.editingId = "";
  state.editSnapshot = "";
  editBookmarkDialog.dataset.bookmarkId = "";
  syncEditPanelLayout(false);
  if (editBookmarkDialog.returnValue !== "save") {
    if (await cleanupRecommendationCollections(form)) load().catch(showError);
    return;
  }
  const item = state.items.find((entry) => entry.id === bookmarkId);
  if (!item) {
    if (await cleanupRecommendationCollections(form)) load().catch(showError);
    return;
  }
  try {
    const fields = new FormData(form);
    const saved = await mutate(`/v1/bookmarks/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        revision: item.revision,
        link: fields.get("link"),
        title: fields.get("title"),
        description: fields.get("description"),
        note: fields.get("note"),
        reminder: fields.get("reminder"),
        cover: fields.get("cover") || "",
        media: JSON.parse(fields.get("media") || "[]"),
        collectionId: fields.get("collectionId"),
        tags: JSON.parse(fields.get("tags") || "[]"),
        favorite: fields.has("favorite"),
        highlights: JSON.parse(editBookmarkDialog.dataset.highlights),
      }),
    });
    if (!saved) {
      if (await cleanupRecommendationCollections(form)) load().catch(showError);
      return;
    }
    form._recommendationCreatedCollections = [];
  } catch (error) {
    if (await cleanupRecommendationCollections(form)) load().catch(showError);
    showError(error);
    return;
  }
  load().catch(showError);
});

coverPickerDialog.querySelector("#cover-picker-back").innerHTML = treeIcon("back");
coverPickerDialog.querySelector("#cover-add-url").innerHTML = treeIcon("add");
coverPickerDialog.querySelector("#cover-upload").innerHTML = treeIcon("upload");
coverPickerDialog.querySelector("#cover-picker-close").innerHTML = treeIcon("close");
setCoverUploadEnabled(false);
coverPickerDialog.querySelector("#cover-picker-back").onclick = () => coverPickerDialog.close();
coverPickerDialog.querySelector("#cover-picker-close").onclick = () => coverPickerDialog.close();
coverPickerDialog.querySelector("#cover-upload").onclick = () => coverPickerDialog.querySelector("#cover-upload-file")?.click();
coverPickerDialog.querySelector("#cover-upload-file").onchange = (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  uploadEditCover(file).catch(showError);
};
coverPickerDialog.querySelector("#cover-add-url").onclick = () => {
  const form = coverUrlDialog.querySelector("form");
  form.reset();
  coverUrlDialog.showModal();
  queueMicrotask(() => form.elements.coverUrl.focus());
};
coverUrlDialog.addEventListener("close", () => {
  if (coverUrlDialog.returnValue !== "save") return;
  const value = httpUrl(coverUrlDialog.querySelector("form").elements.coverUrl.value);
  if (!value) return showError(new TypeError("请输入有效的 HTTP(S) 封面 URL"));
  setEditCoverDraft(value, [...editMediaDraft(), value]);
  renderCoverPicker();
});

document.addEventListener("pointerdown", (event) => {
  const settingsShell = event.target.closest(".settings-shell");
  const insideSettingsControl = event.target.closest("[data-settings-select], [data-settings-button-group], [data-settings-menu]");
  if (state.settingsOpen && state.settingsMenu && !insideSettingsControl) {
    state.settingsMenu = null;
    renderSettings();
    return;
  }
  if (state.settingsOpen && settingsShell?.classList.contains("settings-sidebar-open") && !event.target.closest(".settings-sidebar, .settings-mobile-menu")) {
    settingsShell.classList.remove("settings-sidebar-open");
  }
  const insideMobileSidebar = event.target.closest(".sidebar, [data-mobile-sidebar-toggle]");
  if (state.sidebarOpen && !insideMobileSidebar) setSidebarOpen(false);
  const input = document.querySelector("[data-inline-collection-form] input");
  if (input && !input.form.contains(event.target)) input.blur();
  const insideCardMenu = event.target.closest("[data-card-menu], [data-card-menu-panel]");
  if (state.cardMenuId && !insideCardMenu) closeCardMenu();
  const insideSearch = event.target.closest("[data-search-filter-toggle], #search-filter-menu, #search");
  if (state.searchMenuOpen && !insideSearch) closeSearchMenu();
  const insideTheme = event.target.closest("[data-theme-trigger], [data-theme-menu], #theme-menu");
  if (state.themeMenuOpen && !insideTheme) closeThemeMenu();
  const insideAccount = event.target.closest("[data-account-trigger], [data-account-menu]");
  if (state.accountMenuOpen && !insideAccount) setAccountMenuOpen(false);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.settingsOpen && state.settingsMenu) {
    state.settingsMenu = null;
    renderSettings();
    return;
  }
  if (event.key === "Escape" && state.settingsOpen) {
    setSettingsRoute(false);
    return;
  }
  if (event.key === "Escape" && state.sidebarOpen) {
    setSidebarOpen(false);
    return;
  }
  const search = root.querySelector("#search");
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") || (event.key === "/" && !typing)) {
    event.preventDefault();
    search?.focus();
    search?.select();
  }
  if (event.key === "Escape" && state.searchMenuOpen) {
    state.searchMenuOpen = false;
    renderSearchMenu();
    return;
  }
  if (event.key === "Escape" && state.sortMenuOpen) {
    state.sortMenuOpen = false;
    renderSortMenu();
    return;
  }
  if (event.key === "Escape" && state.viewMenuOpen) {
    state.viewMenuOpen = false;
    renderViewMenu();
    return;
  }
  if (event.key === "Escape" && state.themeMenuOpen) {
    closeThemeMenu();
    return;
  }
  if (event.key === "Escape" && state.accountMenuOpen) {
    setAccountMenuOpen(false);
    return;
  }
  if (event.key === "Escape" && state.cardMenuId) {
    closeCardMenu();
    return;
  }
  if (event.key === "Escape" && state.selectionMoreOpen) {
    state.selectionMoreOpen = false;
    refreshSelectionUi({ refreshHeader: true });
    return;
  }
  if (event.key === "Escape" && state.groupMenuId) {
    state.groupMenuId = null;
    renderSidebar();
    return;
  }
  if (event.key === "Escape" && state.collectionMenuId) {
    state.collectionMenuId = null;
    renderSidebar();
    return;
  }
  if (event.key === "Escape" && state.tagMenuOpen) {
    state.tagMenuOpen = false;
    renderSidebar();
    return;
  }
  if (event.key === "Escape" && state.tagItemMenu) {
    state.tagItemMenu = null;
    renderSidebar();
    return;
  }
  if (event.key === "Escape" && state.collectionSelection) {
    state.collectionSelection = null;
    renderSidebar();
    return;
  }
  if (event.key === "Escape" && document.activeElement === search && search.value) {
    event.preventDefault();
    search.value = "";
    state.query = "";
    state.selected.clear();
    updateLibraryRoute();
    load().catch(showError);
  }
});

document.addEventListener("click", (event) => {
  const insideMobileSidebar = event.target.closest(".sidebar, [data-mobile-sidebar-toggle]");
  if (state.sidebarOpen && !insideMobileSidebar) setSidebarOpen(false);
  const insideCardMenu = event.target.closest("[data-card-menu], [data-card-menu-panel]");
  if (state.cardMenuId && !insideCardMenu) closeCardMenu();
  const insideSearch = event.target.closest("[data-search-filter-toggle], #search-filter-menu, #search");
  if (state.searchMenuOpen && !insideSearch) closeSearchMenu();
  const insideSort = event.target.closest("[data-sort-trigger], [data-sort-menu]");
  if (state.sortMenuOpen && !insideSort) {
    state.sortMenuOpen = false;
    renderSortMenu();
  }
  const insideView = event.target.closest("[data-view-trigger], [data-view-menu]");
  if (state.viewMenuOpen && !insideView) {
    state.viewMenuOpen = false;
    renderViewMenu();
  }
  const insideTheme = event.target.closest("[data-theme-trigger], [data-theme-menu], #theme-menu");
  if (state.themeMenuOpen && !insideTheme) closeThemeMenu();
  const insideAccount = event.target.closest("[data-account-trigger], [data-account-menu]");
  if (state.accountMenuOpen && !insideAccount) setAccountMenuOpen(false);
  const insideSelectionMore = event.target.closest("[data-selection-more], [data-selection-more-menu]");
  if (state.selectionMoreOpen && !insideSelectionMore) {
    state.selectionMoreOpen = false;
    refreshSelectionUi({ refreshHeader: true });
  }
  if ((!state.groupMenuId && !state.collectionMenuId && !state.tagMenuOpen && !state.tagItemMenu) || event.target.closest("[data-group-menu], [data-group-menu-panel], [data-collection-menu], [data-collection-menu-panel], [data-tag-menu], [data-tag-menu-panel], [data-tag-item-menu], [data-tag-item-menu-panel]")) return;
  state.groupMenuId = null;
  state.collectionMenuId = null;
  state.tagMenuOpen = false;
  state.tagItemMenu = null;
  renderSidebar();
});

function showError(error) {
  console.error(error);
  if (error?.code === "locked") return showLockScreen();
  if (error?.code === "editing_conflict") {
    if (window.confirm("此项目已在其他设备上更新。现在刷新最新内容吗？未保存的修改不会应用。")) load().catch(console.error);
    return;
  }
  const message = error?.message || "请求失败";
  const host = root?.querySelector(".content, .settings-main-scroll") || root;
  if (!host) return;
  host.querySelector("[data-inline-error]")?.remove();
  const banner = document.createElement("div");
  banner.className = "inline-error";
  banner.dataset.inlineError = "";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" data-error-retry>${t("重试")}</button><button type="button" class="inline-error-dismiss" data-error-dismiss aria-label="${t("关闭")}">×</button>`;
  host.prepend(banner);
  banner.querySelector("[data-error-retry]").onclick = () => {
    banner.remove();
    load().catch(showError);
  };
  banner.querySelector("[data-error-dismiss]").onclick = () => banner.remove();
}

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  showError(event.reason);
});

window.addEventListener("popstate", () => {
  const section = new URL(location.href).searchParams.get("settings");
  state.settingsOpen = ["app", "account", "import", "backups", "pin"].includes(section);
  state.settingsSection = state.settingsOpen ? section : "app";
  state.settingsMenu = null;
  if (state.settingsOpen) {
    render();
    if (state.settingsSection === "backups") refreshBackupSettings().then(() => renderSettings()).catch(showError);
  }
  else if (state.settingsNeedsReload) {
    state.settingsNeedsReload = false;
    readLibraryRoute();
    load().catch(showError);
  } else {
    readLibraryRoute();
    load().catch(showError);
  }
});

await prepareLock();
const initialLock = await lockState();
if (initialLock.enabled && initialLock.locked) showLockScreen();
else {
  startLockMonitor(showLockScreen);
  load().catch(showError);
}
