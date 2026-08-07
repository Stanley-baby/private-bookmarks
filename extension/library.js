import { api, connection, disconnect } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { collectionOptions, connectionView, escapeHtml } from "./ui.js";

const root = document.querySelector("#app");
const collectionValueDialog = document.querySelector("#collection-value-dialog");
const collectionShareDialog = document.querySelector("#collection-share-dialog");
const bookmarkDialog = document.querySelector("#bookmark-dialog");
const editBookmarkDialog = document.querySelector("#edit-bookmark-dialog");
const coverPickerDialog = document.querySelector("#cover-picker-dialog");
const coverUrlDialog = document.querySelector("#cover-url-dialog");
const collectionPickerDialog = document.querySelector("#collection-picker-dialog");
const batchTagDialog = document.querySelector("#batch-tag-dialog");
const SEARCH_HISTORY_KEY = "private-bookmarks.search-history";
const initialSettingsRoute = new URL(location.href).searchParams.get("settings") === "app";

function readSearchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history.filter((item) => item && typeof item.query === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

const state = {
  view: "all", collectionId: null, query: "", quickFilter: "", tag: "", selected: new Set(), favoriteCount: 0,
  items: [], allItems: [], collections: [], collectionCounts: {}, trashCount: 0, trashedCollections: [], preferences: null, layout: "list",
  collapsedCollections: new Set(), dragBookmark: null, dragCollection: null, searchTimer: null, sidebarWidth: null, cardMenuId: null, cardActionProxies: null,
  searchMenuOpen: false, sortMenuOpen: false, viewMenuOpen: false, themeMenuOpen: false, recentSearches: readSearchHistory(), groupMenuId: null, collectionMenuId: null, pickerCollectionMenuId: null, pickerGroupMenuId: null, inlineCollectionCreate: null, tagMenuOpen: false, tagItemMenu: null, collectionValueAction: null, collectionValueId: null, collectionSelection: null,
  selectionMoreOpen: false, selectionScreenshotWorking: false, sidebarOpen: false, accountMenuOpen: false, mediaUploadEnabled: false,
  settingsOpen: initialSettingsRoute, settingsMenu: null,
};

function setSettingsRoute(open) {
  const url = new URL(location.href);
  if (open) url.searchParams.set("settings", "app");
  else url.searchParams.delete("settings");
  history.pushState({ settings: open }, "", `${url.pathname}${url.search}${url.hash}`);
  state.settingsOpen = Boolean(open);
  state.settingsMenu = null;
  render();
}

const EN_TEXT = Object.freeze({
  " 个书签": " bookmarks",
  "默认模式": "Default mode",
  "使用此封面": "Use this cover", "此书签还没有可用的候选封面。": "This bookmark has no candidate covers.", "正在创建…": "Creating…", "上传文件（需要配置 R2）": "Upload file (R2 required)", "正在上传封面…": "Uploading cover…", "已保存 ": "Saved ", "删除标签": "Remove tag", "编辑 Markdown": "Edit Markdown",
  "打开所有书签": "Open all bookmarks", "展开所有收藏集": "Expand all collections", "折叠所有收藏集": "Collapse all collections", "按名称排序所有收藏集": "Sort all collections by name", "删除所有空收藏集": "Delete all empty collections", "没有找到收藏集": "No collections found",
  "全部": "All",
  "应用": "App", "帐户": "Account", "订阅": "Subscription", "导入": "Import", "整合方式": "Integrations", "备份": "Backups", "帮助": "Help", "设置": "Settings", "私有书签": "Private Bookmarks", "私有实例": "Private instance",
  "语言": "Language", "界面样式": "Interface theme", "字体大小": "Font size", "大": "Large", "默认视图模式": "Default view", "列表": "List", "卡片": "Cards", "标题": "Title", "心情看板": "Moodboard", "点击书签时": "When clicking bookmarks", "在新标签页中打开": "Open in new tab", "在当前标签页中打开": "Open in current tab", "按钮组": "Button group", "搜索": "Search", "按相关性排序": "Sort by relevance", "排序标签": "Sort tags", "按名称": "By name", "按书签数量": "By bookmark count", "失效链接": "Broken links", "嵌套收藏": "Nested collections", "旧视图": "Legacy view", "询问 AI": "Ask AI", "推荐的收藏集和标签": "Recommended collections and tags", "仅 Pro 可用。AI 功能暂未接入。": "Only available for Pro. AI is not connected yet.", "AI 功能暂未接入。": "AI is not connected yet.",
  "所有书签": "All bookmarks", "未分类": "Unsorted", "星标": "Favorites", "待检查": "Pending check", "废纸篓": "Trash", "收藏": "Collections", "快速过滤…": "Quick filters…", "备注": "Notes", "高亮": "Highlights", "没有标签": "Untagged", "标签": "Tags", "建议的": "Suggested", "最近使用的": "Recently used", "删除最近项": "Remove recent item", "搜索帮助": "Search help", "排序": "Sort", "网站": "Website", "视图": "View", "封面": "Cover", "图标": "Icon", "左": "Left", "右": "Right", "书签信息": "Bookmark info", "描述": "Description", "在列表中显示": "Show in list", "在卡片中显示": "Show in cards", "在标题中显示": "Show in titles", "在心情看板中显示": "Show in moodboard", "应用到全部": "Apply to all", "添加": "Add", "导出书签": "Export bookmarks", "检查链接": "Check links", "导入书签": "Import bookmarks", "直接在浏览器打开": "Open in browser", "移动": "Move", "添加标签": "Add tags", "删除": "Delete", "取消": "Cancel", "更多": "More", "选择所有": "Select all", "创建页面截图": "Create page screenshot", "正在创建页面截图…": "Creating page screenshot…", "刷新预览": "Refresh preview", "添加到收藏夹": "Add to favorites", "从收藏夹移除": "Remove from favorites", "移除标签": "Remove tags", "此视图中还没有书签。": "No bookmarks in this view.", "主题：": "Theme: ", "主题": "Theme", "浅色": "Light", "深色": "Dark", "跟随系统": "System", "日落": "Sunset", "Default mode": "Default mode", "中文（汉语）": "中文（汉语）", "新标签": "New tag", "显示": "Show", "隐藏标签": "Hide tags", "按名称排序标签": "Sort tags by name", "按书签数排序标签": "Sort tags by count", "显示侧边栏": "Show sidebar", "关闭侧边栏": "Close sidebar",
  "关闭": "Close", "返回书签": "Back to bookmarks", "显示设置菜单": "Show settings menu", "可选": "Optional", "选项": " options", "书签详情": "Bookmark details", "暂未支持": "Not supported yet", "打开原网页": "Open original page", "更改图标": "Change icon", "添加描述": "Add description", "添加备注": "Add note", "预览 Markdown": "Preview Markdown", "添加标签…": "Add tags…", "最喜爱的": "Favorite", "提醒暂未支持": "Reminders are not supported yet", "添加 URL…": "Add URL…", "上传封面文件": "Upload cover file", "可用封面": "Available covers", "分享收藏夹": "Share collection", "复制": "Copy", "系统分享": "Share", "添加书签": "Add bookmark", "编辑": "Edit", "询问": "Ask", "Web存档": "Web archive", "保存": "Save", "添加 URL": "Add URL", "选择收藏集": "Select collection", "查找或创建新的收藏集…": "Find or create a collection…", "网址": "URL", "收藏夹": "Collection", "封面 URL": "Cover URL", "选择": "Select", "选择全部": "Select all", "恢复": "Restore", "截屏": "Screenshot", "创建嵌套的集合": "Create nested collection", "创建收藏集": "Create collection", "改名": "Rename", "分享": "Share", "显示分组": "Show group", "隐藏分组": "Hide group", "展开": "Expand", "折叠": "Collapse", "收起": "Collapse", "创建群组": "Create group", "删除分组": "Delete group", "新建收藏夹": "New collection", "新收藏": "New collection", "新群组": "New group", "更多操作": "More actions", "复制链接": "Copy link", "将链接复制到剪贴板": "Copy link to clipboard", "列表视图": "List view", "网格视图": "Grid view", "手动排序": "Manual order", "最近添加": "Recently added", "标题 (A-Z)": "Title (A-Z)", "网站 (A-Z)": "Website (A-Z)", "调整侧边栏宽度": "Adjust sidebar width", "当前标签页": "Current tab", "预览模式": "Preview mode", "Web 预览模式": "Web preview mode", "搜索设置 / 筛选": "Search settings / filters", "在条件前添加短横(-) 将其排除在搜索范围之外": "Prefix a condition with a hyphen (-) to exclude it from search", "浏览器扩展": "Browser extension", "下载应用": "Download app", "帮助与支持": "Help and support", "博客": "Blog", "更新内容?": "What's new?", "注销": "Log out", "按日期 ↑": "By date ↑", "按日期 ↓": "By date ↓", "类型": "Type", "创建日期": "Created", "在标题/描述中": "In title/description", "在URL中": "In URL", "移动到…": "Move to…", "移动到": "Move to", "全选": "Select all", "取消星标": "Remove favorite", "添加星标": "Add favorite", "收藏选项": "Collection options", "收藏集选项": "Collection options", "收藏夹名称": "Collection name", "高亮颜色": "Highlight color", "（无备注）": "(No note)"
});

function languageIsEnglish() {
  return state.preferences?.language === "en";
}

function t(text) {
  return languageIsEnglish() ? EN_TEXT[text] || text : text;
}

const translationEntries = Object.entries(EN_TEXT).sort(([a], [b]) => b.length - a.length);

function translateText(text) {
  if (!languageIsEnglish()) return text;
  return translationEntries.reduce((result, [source, translated]) => result.split(source).join(translated), text);
}

function localizeHtml(markup) {
  return translateText(markup);
}

const dialogTextSources = new WeakMap();
const dialogAttributeSources = new WeakMap();
const dialogDynamicSelector = "#cover-picker-items, #collection-picker-list, #batch-tag-menu, #edit-tag-menu, #edit-tag-tokens, #edit-note-preview";

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
  lock: '<path fill-rule="evenodd" d="M6 8V6a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1Zm1 0h6V6a3 3 0 1 0-6 0v2Zm-2 1v8h10V9H5Z"></path>',
  selectAll: '<g fill-rule="evenodd"><path d="M3 3h9v1H3v9H2V4a1 1 0 0 1 1-1Zm5 5h9v9H8V8Zm1 1v7h7V9H9Z"></path><path d="m10 12 1 1 4-4 .707.707-4.707 4.707L9.293 12.707 10 12Z"></path></g>',
  edit: '<path fill-rule="evenodd" d="m14.854 2.146 3 3a.5.5 0 0 1 0 .708l-10 10L3 17l1.146-4.854 10-10a.5.5 0 0 1 .708 0ZM14.5 3.207 5.075 12.63l-.71 3.004 3.005-.71 9.423-9.424-2.293-2.293Z"></path>',
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
  calendar: '<g fill-rule="evenodd"><path d="M3 8h14v9H3z" opacity=".1"></path><path fill-rule="nonzero" d="M7 1v2h6V1h1v2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2V1h1ZM3 8v8a1 1 0 0 0 .883.993L4 17h12a1 1 0 0 0 .993-.883L17 16V8H3Zm0-1h14V5a1 1 0 0 0-.883-.993L16 4h-2v2h-1V4H7v2H6V4H4a1 1 0 0 0-.993.883L3 5v2Z"></path></g>',
  settings: '<path d="m5.253 15.152 1.648-.915a1.167 1.167 0 0 1 1.074-.031c.157.076.319.143.484.2.358.126.632.417.736.781L9.713 17h.574l.518-1.813c.104-.364.378-.655.736-.78a4.63 4.63 0 0 0 .484-.201 1.167 1.167 0 0 1 1.074.03l1.648.916.405-.405-.915-1.648a1.167 1.167 0 0 1-.031-1.074 4.63 4.63 0 0 0 .2-.484c.126-.358.417-.632.781-.736L17 10.287v-.574l-1.813-.518a1.167 1.167 0 0 1-.78-.736 4.63 4.63 0 0 0-.201-.484 1.167 1.167 0 0 1 .03-1.074l.916-1.648-.405-.405-1.648.915a1.167 1.167 0 0 1-1.074.031 4.63 4.63 0 0 0-.484-.2 1.167 1.167 0 0 1-.736-.781L10.287 3h-.574l-.518 1.813a1.167 1.167 0 0 1-.736.78 4.63 4.63 0 0 0-.484.201 1.167 1.167 0 0 1-1.074-.03l-1.648-.916-.405.405.915 1.648c.184.332.196.732.031 1.074a4.63 4.63 0 0 0-.2.484 1.167 1.167 0 0 1-.781.736L3 9.713v.574l1.813.518c.364.104.655.378.78.736.058.165.125.327.201.484a1.17 1.17 0 0 1-.03 1.074l-.916 1.648.405.405ZM2.55 11.3a.792.792 0 0 1-.55-.734V9.434c0-.319.248-.648.55-.734l2.055-.587c.07-.203.153-.401.246-.593L3.813 5.65a.792.792 0 0 1 .13-.908l.8-.8a.808.808 0 0 1 .908-.13L7.52 4.85c.192-.093.39-.175.593-.246L8.7 2.55A.792.792 0 0 1 9.434 2h1.132c.319 0 .648.248.734.55l.587 2.055c.203.07.401.153.593.246l1.869-1.038a.792.792 0 0 1 .908.13l.8.8a.808.808 0 0 1 .13.908L15.15 7.52c.093.192.175.39.246.593l2.055.587c.304.087.55.402.55.734v1.132a.808.808 0 0 1-.55.734l-2.055.587a5.678 5.678 0 0 1-.246.593l1.038 1.869a.792.792 0 0 1-.13.908l-.8.8a.808.808 0 0 1-.908.13l-1.87-1.037c-.192.093-.39.175-.593.246L11.3 17.45a.792.792 0 0 1-.734.55H9.434a.808.808 0 0 1-.734-.55l-.587-2.055a5.678 5.678 0 0 1-.593-.246l-1.87 1.038a.792.792 0 0 1-.908-.13l-.8-.8a.808.808 0 0 1-.13-.908L4.85 12.48a5.678 5.678 0 0 1-.246-.593L2.55 11.3ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"></path>',
  extension: '<path d="M8 1a1 1 0 0 0-.993.883L7 2v3H2a1 1 0 0 0-.993.883L1 6v3h1.037l.186.008a3 3 0 0 1-.047 5.987L2 15H1v3a1 1 0 0 0 .883.993L2 19h3v-1.037l.008-.186a3 3 0 0 1 5.987.047L11 18v1h3a1 1 0 0 0 .993-.883L15 18v-5h3a2 2 0 1 0 0-4h-3V6a1 1 0 0 0-.883-.993L14 5H9V2a1 1 0 0 0-1-1Z"></path>',
  install: '<path d="M10 12.962 13.679 9H15l-5.5 6L4 9h1.321L9 12.962V4h1z"></path><path d="M9.5 1a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm0 1a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z"></path>',
  history: '<path d="M2 4.002v9.996c0 .162.186.455.335.525l7.59 3.572h-.85l7.59-3.572c.15-.07.335-.36.335-.525V4.002c0 .184.352.408.516.33l-7.59 3.573-.426.2-.426-.2-7.59-3.572c.16.076.516-.148.516-.33Zm-1 0c0-.553.41-.81.91-.574L9.5 7l7.59-3.572c.503-.236.91.028.91.574v9.996c0 .553-.41 1.195-.91 1.43L9.5 19l-7.59-3.572c-.503-.236-.91-.884-.91-1.43V4.002Z"></path>',
  exit: '<path d="M7 10v4c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v4H4.143L5 6 2 9.5 5 13l-.857-3H7v2h1v-2H7Zm1 0v4.154c0 .474.45.846 1 .846h7c.54 0 1-.38 1-.846V4.846C17 4.372 16.55 4 16 4H9c-.54 0-1 .38-1 .846V9h5v1H8Z"></path>',
  help: '<g fill-rule="evenodd"><path d="M10 18c-4.417 0-8-3.583-8-8s3.583-8 8-8 8 3.583 8 8-3.583 8-8 8Z" opacity=".1"></path><path fill-rule="nonzero" d="M19 10c0-4.974-4.026-9-9-9s-9 4.026-9 9 4.026 9 9 9 9-4.026 9-9Zm-9 7.94A7.942 7.942 0 0 1 2.06 10 7.942 7.942 0 0 1 10 2.06 7.942 7.942 0 0 1 17.94 10 7.942 7.942 0 0 1 10 17.94Z"></path><path fill-rule="nonzero" d="M10 14a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm.129-10a3.132 3.132 0 0 1 3.128 3.13c0 1.568-1.16 2.87-2.667 3.094v1.823a.462.462 0 0 1-.923 0V9.796c0-.255.207-.462.462-.462a2.207 2.207 0 0 0 2.205-2.205c0-1.216-.99-2.206-2.205-2.206-1.217 0-2.206.99-2.206 2.206a.462.462 0 0 1-.923 0A3.132 3.132 0 0 1 10.129 4Z"></path></g>',
  microTune: '<path fill-rule="evenodd" d="M2.5 5a2.5 2.5 0 0 1 2.45 2H10v1H4.95A2.5 2.5 0 1 1 2.5 5Zm0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5-6a2.5 2.5 0 1 1-2.45 3H0V2h5.05A2.5 2.5 0 0 1 7.5 0Zm0 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"></path>',
  microArrow: '<path d="m2 4 2.995 3L7.99 4z"></path>',
  microOpen: '<path fill-rule="evenodd" d="M7.293 2H3.5a.5.5 0 1 1 0-1h5a.498.498 0 0 1 .5.5v5a.5.5 0 1 1-1 0V2.707L1.854 8.854a.5.5 0 0 1-.708-.708L7.293 2Z"></path>',
  microClose: '<path fill-rule="evenodd" d="M5 5.707 2.211 8.496a.995.995 0 0 1-1.416.006l.703.703a1.006 1.006 0 0 1 .006-1.416L4.293 5 1.504 2.211A.995.995 0 0 1 1.498.795l-.703.703a1.006 1.006 0 0 1 1.416.006L5 4.293l2.789-2.789A.997.997 0 0 1 9.207 1.5L8.5.793a1.006 1.006 0 0 1-.004 1.418L5.707 5l2.789 2.789c.4.4.395 1.028.004 1.418l.707-.707a1.006 1.006 0 0 1-1.418-.004L5 5.707Z"></path>',
  back: '<path fill-rule="evenodd" d="M4.115 10 11 15.594V17L2 9.5 11 2v1.406L4.115 9H17v1H4.115Z"></path>',
  more: '<path fill-rule="evenodd" d="M4 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"></path>',
  click: '<path fill-rule="evenodd" d="M9.5 2a.5.5 0 0 1 .5.5v5.792l4.096-4.095a.5.5 0 0 1 .707.707l-4.096 4.095L16.5 9a.5.5 0 1 1 0 1l-5.794-.001 4.097 4.097a.5.5 0 0 1-.707.707L10 10.707V16.5a.5.5 0 1 1-1 0v-5.794l-4.096 4.097a.5.5 0 0 1-.707-.707L8.292 10H2.5a.5.5 0 0 1 0-1h5.793L4.197 4.904a.5.5 0 0 1 .707-.707L9 8.293V2.5a.5.5 0 0 1 .5-.5Z"></path>',
  open: '<path fill-rule="evenodd" d="M17.993 7V2.5c0-.277-.222-.5-.5-.5h-4.5c-.277 0-.5.222-.5.5s.223.5.5.5h3.246l-8.392 8.392a.5.5 0 1 0 .707.707l8.44-8.44V7a.5.5 0 1 0 1 0ZM14 16l-9.033.017a.984.984 0 0 1-.983-.984L4 6c0-.543.457-1 1-1h4.5V4H5C3.913 4 3 5.11 3 6.197v8.836C3 16.119 3.881 17 4.967 17h8.836C14.889 17 16 16.086 16 15v-4.5h-1V15c0 .543-.457 1-1 1Z"></path>',
  moveTo: '<path d="M1 8h11v2l3 3h1v3H1z" opacity=".12"></path><path d="M1 15h15v1H1z" opacity=".12"></path><path d="m6 3 2 2h7v1H7.5l-2-2H1v3h11v1H1v8h15v-3h1v2.998C17 16.55 16.545 17 16 17H1c-.552 0-1-.45-1-1.007V4.007C0 3.45.451 3 .99 3H6Zm11 0v6.929L18.688 8H20l-3.5 4L13 8h1.313L16 9.929V3h1Z"></path>',
  selectionClose: '<path fill-rule="evenodd" d="m10.95 10.25 6.4 6.4c.2.2.2.52 0 .7-.2.2-.5.2-.7 0l-6.4-6.4-6.4 6.4c-.2.2-.52 0-.7 0-.2-.18-.2-.5 0-.7l6.4-6.4-6.4-6.4c-.2-.2-.2-.5 0-.7.18-.2.5-.2.7 0l6.4 6.4 6.4-6.4c.2-.2.5-.2.7 0 .2.2.2.5 0 .7l-6.4 6.4Z"></path>',
  close: '<path fill-rule="evenodd" d="m10.95 10.25 6.4 6.4c.2.2.2.52 0 .7-.2.2-.5.2-.7 0l-6.4-6.4-6.4 6.4c-.2.2-.52.2-.7 0-.2-.18-.2-.5 0-.7l6.4-6.4-6.4-6.4c-.2-.2-.2-.5 0-.7.18-.2.5-.2.7 0l6.4 6.4 6.4-6.4c.2-.2.5-.2.7 0 .2.2.2.5.2.7l-6.4 6.4Z"></path>',
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
  viewMasonry: '<g fill-rule="evenodd"><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 2 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006Z" opacity=".09"></path><path d="M2 3.998A.994.994 0 0 1 3.003 3h4.994A1 1 0 0 1 9 3.998v7.004A.994.994 0 0 1 7.997 12H3.003A1 1 0 0 1 2 11.002V3.998ZM2 14c0-.552.438-1 1.003-1h4.994A.999.999 0 0 1 9 14v3c0 .552-.438 1-1.003 1H3.003A.999.999 0 0 1 8 17v-3Zm8-10.01A.99.99 0 0 1 11.003 3h4.994c.554 0 1.003.451 1.003.99v4.02a.99.99 0 0 1-1.003.99h-4.994A1.002 1.002 0 0 1 10 8.01V3.99Zm0 7.007c0-.55.438-.997 1.003-.997h4.994c.554 0 1.003.453 1.003.997v6.006c0 .55-.438.997-1.003.997h-4.994A1.004 1.004 0 0 1 10 17.003v-6.006ZM3 4h5v7H3V4Zm8 7h5v6h-5v-6Zm0-7h5v4h-5V4ZM3 14h5v3H3v-3Z"></path></g>',
  download: '<path d="M12.172 1a2 2 0 0 1 1.414.586l3.828 3.828A2 2 0 0 1 18 6.828V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h8.172Zm0 1H4a1 1 0 0 0-.993.883L3 3v14a1 1 0 0 0 .883.993L4 18h12a1 1 0 0 0 .993-.883L17 17V6.828a1 1 0 0 0-.206-.608l-.087-.099-3.828-3.828a2.002 2.002 0 0 0-.576-.284L12.172 2ZM10 6v6.929L11.687 11H13l-3.5 4L6 11h1.312L9 12.929V6h1Z"></path>',
};

treeIcons.check = '<path fill-rule="evenodd" d="m8.126 13.168.686-.058-3-3-.624.78 3 3 .37.297.316-.355 7-8-.748-.664z"></path>';
treeIcons.viewMasonry = treeIcons.viewMasonry.replaceAll("A.999.999 0 0 1 9 14", "A.999 1 0 0 1 9 14").replaceAll("A.999 1 0 0 1 8 17", "A.999 1 0 0 1 2 17");

function treeIcon(name, compact = false) {
  const small = compact || name === "microArrow";
  return `<svg class="tree-svg ${small ? "tree-svg-small" : ""}" viewBox="0 0 ${small ? "10 10" : "20 20"}" aria-hidden="true">${treeIcons[name]}</svg>`;
}

function microIcon(name) {
  return `<svg class="search-micro-icon" viewBox="0 0 10 10" aria-hidden="true">${treeIcons[name]}</svg>`;
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
    const icon = state.preferences?.collectionIconByCollectionId?.[item.id];
    return `<div class="collection-branch"><div class="collection-row ${state.collectionId === item.id ? "active" : ""}" style="--depth:${depth}" data-drop-collection="${item.id}" ${editable && !selecting ? `data-drag-collection="${item.id}" draggable="true"` : ""}>${control}<button class="collection-link" ${selecting ? `data-select-collection="${item.id}"` : `data-collection="${item.id}"`}><span class="collection-icon">${icon ? `<span class="collection-emoji">${escapeHtml(icon)}</span>` : treeIcon("folder")}</span><span class="collection-name">${escapeHtml(item.name)}</span>${sidebarCount(count, "collection-count")}</button>${editable && !selecting ? `<span class="collection-actions"><button data-collection-menu="${item.id}" title="收藏集选项" aria-label="${escapeHtml(item.name)}选项">${treeIcon("more")}</button></span>` : ""}</div>${collectionMenu(item)}${inlineCollectionRow("sidebar", groupId, item.id, depth + 1)}${hasChildren && (!collapsed || selecting) ? collectionTree(groupId, item.id, depth + 1) : ""}</div>`;
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
    return `<section class="sidebar-section collections-section ${collapsed ? "section-collapsed" : ""}" data-group="${group.id}"><div class="sidebar-label"><button class="sidebar-section-toggle" data-sidebar-toggle="collections" aria-expanded="${!collapsed}">${escapeHtml(group.title)}</button>${collapsed ? `<button class="section-show" data-sidebar-toggle="collections">显示</button>` : `<button data-group-menu="${group.id}" title="收藏选项" aria-label="${escapeHtml(group.title)}选项">＋</button>`}</div>${collapsed ? "" : `${groupMenu(group)}${selection}${inlineCollectionRow("sidebar", group.id, null, 0)}${group.hidden ? `<button class="show-group" data-group-action="show" data-group-id="${group.id}">显示分组</button>` : collectionTree(group.id)}`}</section>`;
  }).join("");
}

const SEARCH_SUGGESTIONS = [
  { id: "favorite", label: "最喜爱的", token: "important:true", icon: "like", className: "favorite" },
  { id: "tags", label: "标签", token: "#", icon: "searchTag", className: "tags" },
  { id: "note", label: "备注", token: "note:true", icon: "note", className: "note" },
  { id: "type", label: "类型", token: "type:link", icon: "type", className: "type" },
  { id: "created", label: "创建日期", token: "created:", icon: "calendar", className: "created" },
  { id: "info", label: "在标题/描述中", token: "info:", icon: "info", className: "info" },
  { id: "url", label: "在URL中", token: "url:", icon: "link", className: "url" },
];

function searchFilterFor(query) {
  const value = String(query || "").trim();
  const lower = value.toLocaleLowerCase();
  if (lower === "important" || lower === "important:true") return { kind: "favorite" };
  if (lower === "#" || lower === "tags" || lower === "tag:") return { kind: "tags" };
  if (lower === "notag:true") return { kind: "untagged" };
  if (lower === "note:true" || lower === "note:") return { kind: "note" };
  if (lower.startsWith("note:")) return { kind: "note", value: value.slice(5).trim() };
  if (lower === "type:" || lower === "type:link") return { kind: "type", value: lower.slice(5) };
  if (lower.startsWith("type:")) return { kind: "type", value: lower.slice(5).trim() };
  if (lower === "created:" || lower === "created") return { kind: "created", value: "" };
  if (lower.startsWith("created:")) return { kind: "created", value: value.slice(8).trim() };
  if (lower === "info:" || lower === "info") return { kind: "info", value: "" };
  if (lower.startsWith("info:")) return { kind: "info", value: value.slice(5).trim() };
  if (lower === "url:" || lower === "url") return { kind: "url", value: "" };
  if (lower.startsWith("url:")) return { kind: "url", value: value.slice(4).trim() };
  if (value.startsWith("#")) return { kind: "tag", value: value.slice(1).trim().toLocaleLowerCase() };
  return null;
}

function matchesSearchFilter(item, filter) {
  if (!filter) return true;
  const text = (value) => String(value || "").toLocaleLowerCase();
  if (filter.kind === "favorite") return Boolean(item.favorite);
  if (filter.kind === "tags") return item.tags.length > 0;
  if (filter.kind === "untagged") return item.tags.length === 0;
  if (filter.kind === "note") return !filter.value ? Boolean(item.note) : text(item.note).includes(text(filter.value));
  if (filter.kind === "type") return !filter.value || filter.value === "link";
  if (filter.kind === "created") return Boolean(item.createdAt) && (!filter.value || text(item.createdAt).includes(text(filter.value)));
  if (filter.kind === "info") return `${item.title || ""} ${item.description || ""}`.toLocaleLowerCase().includes(text(filter.value));
  if (filter.kind === "url") return text(item.link).includes(text(filter.value));
  if (filter.kind === "tag") return item.tags.some((tag) => text(tag) === text(filter.value));
  return true;
}

function queryPath() {
  const params = new URLSearchParams();
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (state.query && !searchFilterFor(state.query)) params.set("search", state.query);
  return `/v1/bookmarks?${params}`;
}

function searchSuggestionCount(id) {
  const items = state.allItems.length ? state.allItems : state.items;
  if (id === "favorite") return items.filter((item) => item.favorite).length;
  if (id === "tags") return items.filter((item) => item.tags.length).length;
  if (id === "note") return items.filter((item) => item.note).length;
  if (id === "type") return items.length;
  if (id === "created") return items.filter((item) => item.createdAt).length;
  if (id === "info") return items.filter((item) => item.title || item.description).length;
  if (id === "url") return items.filter((item) => item.link).length;
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
  const suggestions = SEARCH_SUGGESTIONS.map((item) => `<button type="button" class="search-filter-item" role="option" data-search-token="${escapeHtml(item.token)}"><span class="search-filter-icon ${item.className}">${treeIcon(item.icon)}</span><span class="search-filter-title">${t(item.label)}</span><small class="search-filter-count">${searchSuggestionCount(item.id)}</small></button>`).join("");
  const recent = state.recentSearches.map((item) => `<button type="button" class="search-filter-item search-recent-item" role="option" data-search-recent="${escapeHtml(item.query)}"><span class="search-filter-icon recent">${treeIcon("search")}</span><span class="search-filter-title">${escapeHtml(item.query)}</span><small class="search-filter-count">${searchHistoryTime(item.usedAt)}</small></button>`).join("");
  return `<div id="search-filter-menu" class="search-filter-menu ${state.searchMenuOpen ? "" : "hidden"}" role="listbox" aria-label="${t("搜索")}"><div class="search-filter-section-title">${t("建议的")}</div>${suggestions}<div class="search-filter-section-title search-recent-title"><span>${t("最近使用的")}</span><button type="button" class="search-recent-clear" data-search-recent-clear title="${t("删除最近项")}" aria-label="${t("删除最近项")}">${microIcon("microClose")}</button></div>${recent}<div class="search-filter-help"><span>${languageIsEnglish() ? "Prefix a condition with a hyphen (-) to exclude it from search" : "在条件前添加短横(-) 将其排除在搜索范围之外"}</span><a href="https://help.raindrop.io/using-search" target="_blank" rel="noopener" title="${t("搜索帮助")}" aria-label="${t("搜索帮助")}">${treeIcon("help")}</a></div></div>`;
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
  const search = root.querySelector("#search");
  if (document.activeElement === search) search.blur();
  renderSearchMenu();
}

function commitSearch(value, remember = true) {
  clearTimeout(state.searchTimer);
  state.query = String(value || "").trim();
  state.selected.clear();
  state.cardMenuId = null;
  if (remember) rememberSearch(state.query);
  load().catch(showError);
}

function bindSearchMenu() {
  root.querySelectorAll("[data-search-token], [data-search-recent]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    const query = button.dataset.searchToken ?? button.dataset.searchRecent;
    const input = root.querySelector("#search");
    if (input) input.value = query;
    state.searchMenuOpen = false;
    commitSearch(query);
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
  group.innerHTML = `<button type="button" class="search-filter-toggle" data-search-filter-toggle title="${t("搜索设置 / 筛选")}" aria-label="${t("搜索设置 / 筛选")}" aria-expanded="${state.searchMenuOpen}" tabindex="-1">${microIcon("microTune")}${microIcon("microArrow")}</button>`;
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

function viewName() {
  if (state.collectionId) return state.collections.find((item) => item.id === state.collectionId)?.name || "收藏夹";
  return t(({ all: "所有书签", favorites: "星标", broken: "失效链接", unknown: "待检查", trash: "废纸篓" })[state.view]);
}

function workspaceHref() {
  const params = new URLSearchParams();
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
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
  const moreMenu = state.selectionMoreOpen ? `<div class="selection-more-menu" role="menu" data-selection-more-menu><button type="button" role="menuitem" data-selection-more-action="screenshot" ${state.selectionScreenshotWorking ? "disabled" : ""}>${treeIcon("web")}<span>${state.selectionScreenshotWorking ? "正在创建页面截图…" : "创建页面截图"}</span></button><button type="button" role="menuitem" data-selection-more-action="refresh">${treeIcon("refresh")}<span>刷新预览</span></button><span class="menu-separator"></span><button type="button" role="menuitem" data-selection-more-action="favorite">${treeIcon("likeActive")}<span>添加到收藏夹</span></button><button type="button" role="menuitem" data-selection-more-action="unfavorite">${treeIcon("like")}<span>从收藏夹移除</span></button><span class="menu-separator"></span><button type="button" role="menuitem" data-selection-more-action="remove-tags">${treeIcon("tagAction")}<span>移除标签</span></button></div>` : "";
  return `<header class="workspace-head workspace-selection-head" data-is-header="true"><div class="workspace-first-action"><div id="select-all" class="select-all selection-toggle button-dQdc" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="active"><label class="selection-checkbox"><input tabindex="-1" type="checkbox" title="选择所有" ${allSelected ? "checked" : ""}></label></div></div><div class="workspace-name selection-name">${escapeHtml(title)}&nbsp;</div><div class="workspace-space"></div><button type="button" class="selection-action selection-move" title="移动" aria-label="移动" data-selection-move aria-haspopup="dialog">${treeIcon("moveTo")}<span>移动</span></button><button class="selection-action" title="添加标签" aria-label="添加标签" data-batch="tags">${treeIcon("tagAction")}<span>添加标签</span></button><button class="selection-action selection-danger" title="删除" aria-label="删除" data-batch="trash">${treeIcon("trash")}<span>删除</span></button><button id="export" class="selection-action" title="更多" aria-label="更多">${treeIcon("download")}<span>导出书签</span></button><button class="selection-action" title="直接在浏览器打开" aria-label="直接在浏览器打开" data-selection-open>${treeIcon("open")}<span>直接在浏览器打开</span></button><div class="selection-more-wrap"><button class="selection-action selection-more" title="更多" aria-label="更多" aria-expanded="${state.selectionMoreOpen}" data-selection-more>${treeIcon("more")}</button>${moreMenu}</div><div class="workspace-space"></div><button class="selection-action selection-cancel" title="取消" aria-label="取消" data-selection-clear>${treeIcon("selectionClose")}<span>取消</span></button></header>`;
}

function workspaceHeaderMarkup(items, selection) {
  if (selection.length) return selectionHeaderMarkup(selection);
  const sort = sortOption();
  const allSelected = Boolean(items.length && selection.length === items.length);
  const view = viewOption();
  const firstAction = selection.length
    ? `<div class="workspace-first-action"><div id="select-all" class="select-all selection-toggle button-dQdc" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="active"><label class="selection-checkbox"><input tabindex="-1" type="checkbox" title="选择所有" ${allSelected ? "checked" : ""}></label></div></div><span class="selection-count" aria-live="polite">${selection.length}</span>`
    : `<div class="workspace-first-action"><div id="select-all" class="select-all button-dQdc button-JeZa" role="button" tabindex="0" title="选择所有" aria-label="选择所有" data-variant="default" data-accent="default" data-size="default" data-selectable="true"><div class="workspace-cloud icon-vkJU icon-yhAy"><span class="workspace-icon icon-VKRw">${treeIcon("all")}</span></div><label class="select-checkbox select-U4Ec" title="选择所有"><input tabindex="-1" type="checkbox" ${allSelected ? "checked" : ""}></label></div></div><div class="workspace-name">${escapeHtml(viewName())}</div><a class="workspace-open" href="${escapeHtml(workspaceHref())}" target="_blank" rel="noopener" title="在新标签页中打开" aria-label="在新标签页中打开">${microIcon("microOpen")}</a>`;
  const selectionActions = selection.length
    ? `<div class="selection-actions"><button title="添加星标" data-batch="favorite">★</button><button title="取消星标" data-batch="unfavorite">☆</button><button title="编辑标签" data-batch="tags">#</button><select id="move-to" aria-label="移动到"><option value="">移动到…</option>${state.collections.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select>${state.view === "trash" ? `<button data-batch="restore">恢复</button>` : `<button class="danger" data-batch="trash">删除</button>`}<button id="export" class="export" title="导出书签" aria-label="导出书签">${treeIcon("download")}<span>导出书签</span></button><button data-selection-clear title="取消选择" aria-label="取消选择">×</button></div>`
    : `<div class="workspace-tools"><div class="workspace-sort" role="button" tabindex="0" title="排序" aria-label="排序" aria-haspopup="menu" aria-expanded="${state.sortMenuOpen}" data-sort-trigger><span class="workspace-sort-icon">${treeIcon(sort?.icon || "sortCreated")}</span><span class="workspace-sort-label">${sort?.label || "排序"}</span></div><div class="view-switcher" role="group" aria-label="视图"><button class="view-trigger active" data-view-trigger title="视图" aria-label="视图" aria-haspopup="menu" aria-expanded="${state.viewMenuOpen}">${treeIcon(view.icon)}<span>${view.label}</span></button></div><button id="export" class="export" title="更多" aria-label="导出书签">${treeIcon("download")}<span>导出书签</span></button></div>`;
  return `<header class="workspace-head${selection.length ? " workspace-selection-head" : ""}" data-is-header="true">${firstAction}<div class="workspace-space"></div>${selectionActions}</header>${selection.length ? "" : `${sortMenuMarkup()}${viewMenuMarkup()}`}`;
}

function visibleItems() {
  const searchFilter = searchFilterFor(state.query);
  return state.items.filter((item) => {
    if (searchFilter && !matchesSearchFilter(item, searchFilter)) return false;
    if (state.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === state.tag.toLocaleLowerCase())) return false;
    if (state.quickFilter === "notes" && !item.note) return false;
    if (state.quickFilter === "highlights" && !item.highlights.length) return false;
    if (state.quickFilter === "untagged" && item.tags.length) return false;
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
  const tags = new Map();
  for (const item of items) for (const tag of item.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  return [...tags].sort(state.preferences?.tagSort === "count"
    ? ([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB, "zh-CN")
    : ([tagA], [tagB]) => tagA.localeCompare(tagB, "zh-CN")).slice(0, 40);
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
    return `<div class="collection-picker-row" style="--depth:${depth}"><button type="button" role="option" class="collection-picker-item ${item.id === selectedId ? "active" : ""}" aria-selected="${item.id === selectedId}" data-pick-collection="${item.id}">${arrow}<span class="collection-picker-icon">${treeIcon(item.id === "unsorted" ? "inbox" : "folder")}</span><span class="collection-picker-item-name">${escapeHtml(collectionName(item.id))}</span>${count > 0 ? `<small class="collection-picker-count">${count}</small>` : ""}</button><button type="button" class="collection-picker-more" data-picker-collection-menu="${item.id}" title="更多" aria-label="${escapeHtml(collectionName(item.id))}更多" aria-expanded="${state.pickerCollectionMenuId === item.id}">${treeIcon("more")}</button>${menu(item)}</div>`;
  };
  if (value) {
    const matches = state.collections.filter((item) => collectionName(item.id).toLocaleLowerCase().includes(value));
    return matches.length ? matches.map((item) => row(item)).join("") : '<p class="collection-picker-empty">没有找到收藏集</p>';
  }
  const children = (groupId, parentId = null, depth = 0) => state.collections
    .filter((item) => item.id !== "unsorted" && item.parentId === parentId && (parentId !== null || collectionGroupId(item) === groupId))
    .map((item) => row(item, depth) + inlineCollectionRow("picker", groupId, item.id, depth + 1) + (state.collapsedCollections.has(item.id) ? "" : children(groupId, item.id, depth + 1))).join("");
  const unsorted = state.collections.find((item) => item.id === "unsorted");
  return `${unsorted ? row(unsorted) : ""}${collectionGroups().map((group) => `<div class="collection-picker-group"><span>${escapeHtml(group.title)}</span><button type="button" class="collection-picker-group-more" data-picker-group-menu="${group.id}" title="更多" aria-label="${escapeHtml(group.title)}更多" aria-expanded="${state.pickerGroupMenuId === group.id}">${treeIcon("more")}</button></div>${groupMenu(group)}${inlineCollectionRow("picker", group.id, null, 0)}${children(group.id)}`).join("")}`;
}

function collectionPickerRows(query, selectedId) {
  return localizeHtml(collectionPickerRowsSource(query, selectedId));
}

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
  const source = item.cover === "<screenshot>" ? item.link : item.cover || item.link;
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

function activeEditItem() {
  const id = editBookmarkDialog.dataset.bookmarkId;
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

function card(item, index) {
  const selected = state.selected.has(item.id) ? "checked" : "";
  const titleView = state.layout === "simple";
  const gridView = state.layout === "grid";
  const masonryView = state.layout === "masonry";
  const coverSrc = titleView ? faviconUrl(item.link) : masonryView ? masonryCoverUrl(item) : gridView ? gridCoverUrl(item) : listCoverUrl(item);
  const coverSize = titleView ? 20 : 56;
  const cardLinkTarget = settingsPreference("bookmarkClick", "new_tab") === "current_tab" ? "" : "target=\"_blank\" rel=\"noopener\"";
  const note = item.note ? renderMarkdown(item.note) : "";
  const description = item.description ? escapeHtml(item.description) : "";
  const tags = item.tags.map((tag) => `<span class="card-tag"><span class="card-tag-icon">${treeIcon("tag", true)}</span>${escapeHtml(tag)}</span>`).join("");
  const status = item.health.status === "broken" ? `<section><span class="health broken" title="失效链接">⌁</span></section>` : "";
  const source = `<section><a class="card-path" href="#" data-card-collection="${escapeHtml(item.collectionId)}"><span class="card-path-icon">${treeIcon(item.collectionId === "unsorted" ? "inbox" : "folder")}</span>${escapeHtml(masonryView ? collectionName(item.collectionId) : collectionPath(item.collectionId))}</a></section>${item.favorite ? `<section data-inline="true" class="card-important">${treeIcon("importantActive", true)}</section>` : ""}<section>${escapeHtml(host(item.link))}</section>${item.createdAt ? `<section>${dateLabel(item.createdAt)}</section>` : ""}${item.highlights.length ? `<section>${item.highlights.length} 条高亮</section>` : ""}${status}`;
  const primaryActions = `<a role="button" href="${escapeHtml(item.link)}" title="直接在浏览器打开" aria-label="直接在浏览器打开" data-button="current_tab">${treeIcon("click")}</a><a role="button" href="${escapeHtml(item.link)}" target="_blank" rel="noopener" title="预览模式" aria-label="预览模式" data-button="preview">${treeIcon("show")}</a><button type="button" title="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" aria-label="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" data-button="important" data-favorite="${item.id}">${treeIcon(item.favorite ? "likeActive" : "like")}</button><button type="button" class="card-action-more" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="${state.cardMenuId === item.id}" data-card-menu="${escapeHtml(item.id)}">${treeIcon("more")}</button>`;
  const masonryActions = `<a role="button" href="${escapeHtml(item.link)}" title="直接在浏览器打开" aria-label="直接在浏览器打开" data-button="current_tab">${treeIcon("click")}</a><a role="button" href="${escapeHtml(item.link)}" target="_blank" rel="noopener" title="在新标签页中打开" aria-label="在新标签页中打开" data-button="new_tab">${treeIcon("open")}</a><a role="button" href="${escapeHtml(item.link)}" target="_blank" rel="noopener" title="预览模式" aria-label="预览模式" data-button="preview">${treeIcon("show")}</a><a role="button" href="${escapeHtml(item.link)}" target="_blank" rel="noopener" title="Web 预览模式" aria-label="Web 预览模式" data-button="web">${treeIcon("web")}</a><button type="button" title="将链接复制到剪贴板" aria-label="将链接复制到剪贴板" data-button="copy" data-copy-link="${escapeHtml(item.link)}">${treeIcon("duplicates")}</button><button type="button" title="询问" aria-label="询问" data-button="ask">${treeIcon("ai")}</button><button type="button" title="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" aria-label="${item.favorite ? "从收藏夹移除" : "添加到收藏夹"}" data-button="important" data-favorite="${item.id}">${treeIcon(item.favorite ? "likeActive" : "like")}</button><button type="button" title="编辑标签" aria-label="编辑标签" data-button="tags" data-edit="${item.id}" data-edit-focus="tags">${treeIcon("tag")}</button><button type="button" title="编辑" aria-label="编辑" data-button="edit" data-edit="${item.id}">编辑</button><button type="button" title="删除" aria-label="删除" data-button="remove" data-delete="${item.id}">${treeIcon("trash")}</button>`;
  const menuOpen = state.cardMenuId === item.id ? " card-menu-open" : "";
  const actionMarkup = masonryView ? masonryActions : primaryActions;
  const coverAttrs = masonryView || gridView ? `width="${masonryGridWidth()}"` : `width="${coverSize}" height="${titleView ? 20 : 48}"`;
  const sourceMarkup = masonryView || gridView ? `<source srcset="${escapeHtml(coverSrc)}" type="image/webp">` : "";
  return `<article role="listitem" draggable="true" data-drag-bookmark="${item.id}" class="bookmark-card${selected ? " selected" : ""}${state.selected.size ? " selection-mode" : ""}${masonryView ? " masonry-card" : ""}${menuOpen}" style="--stagger:${Math.min(index, 12)}"><picture role="img" class="card-cover">${sourceMarkup}<img src="${escapeHtml(coverSrc)}" alt="" ${coverAttrs} referrerpolicy="no-referrer"></picture><div class="card-copy"><div class="card-title">${escapeHtml(item.title || item.link)}</div><div class="card-details">${note ? `<div class="card-note">${note}</div>` : ""}${description ? `<div class="card-description">${description}</div>` : ""}${tags ? `<div class="card-tags">${tags}</div>` : ""}</div><div class="card-source">${source}</div></div><div class="card-actions">${actionMarkup}</div><label class="card-select" title="选择"><input aria-label="选择${escapeHtml(item.title || item.link)}" type="checkbox" data-select="${item.id}" ${selected}></label><a class="card-permalink" href="${escapeHtml(item.link)}" ${cardLinkTarget} tabindex="0">${escapeHtml(item.title || item.link)}</a></article>`;
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
  const quick = (id, icon, label, count, attribute = `data-quick-filter="${id}"`) => count > 0
    ? `<button class="quick-filter tree-item ${(attribute.startsWith("data-view") ? state.view === id : state.quickFilter === id) ? "active" : ""}" ${attribute}><span class="tree-expand"></span><span class="tree-icon">${icon === "?" ? "?" : treeIcon(icon, icon === "tag")}</span><span class="tree-title">${label}</span>${sidebarCount(count)}</button>`
    : "";
  const nav = (active, icon, label, count, attribute) => `<button class="nav-item tree-item ${active ? "active" : ""}" ${attribute}><span class="tree-expand"></span><span class="tree-icon">${treeIcon(label === "星标" ? "star" : icon)}</span><span class="tree-title">${label}</span>${sidebarCount(count)}</button>`;
  const favorite = state.favoriteCount ? nav(state.view === "favorites", "tag", "星标", state.favoriteCount, 'data-view="favorites"') : "";
  return `<aside class="sidebar"><div class="sidebar-head"><div class="account-wrap"><button type="button" class="account-trigger" data-account-trigger aria-haspopup="menu" aria-expanded="${state.accountMenuOpen}" title="私有书签"><span class="account-mark"><img src="icons/bookmark.svg" width="20" height="20" alt=""></span><span class="account-name">私有书签</span><span class="sidebar-caret">${treeIcon("microArrow")}</span></button>${accountMenuMarkup()}</div><button id="new-collection" class="icon-button" title="新建收藏夹" aria-label="新建收藏夹">＋</button></div><nav class="nav"><section class="sidebar-section primary-nav">${nav(state.view === "all" && !state.collectionId, "all", "所有书签", total, 'data-view="all"')}${nav(state.collectionId === "unsorted", "inbox", "未分类", state.collectionCounts.unsorted || 0, 'data-collection="unsorted"')}${favorite}${state.trashCount ? nav(state.view === "trash", "folder", "废纸篓", state.trashCount, 'data-view="trash"') : ""}</section><section class="sidebar-section collections-section"><div class="sidebar-label"><span>收藏</span><button id="new-collection-secondary" title="新建收藏夹" aria-label="新建收藏夹">＋</button></div>${collectionTree()}</section><section class="sidebar-section filters-section"><div class="sidebar-label"><span>快速过滤…</span></div>${quick("notes", "note", "备注", items.filter((item) => item.note).length)}${quick("highlights", "tag", "高亮", items.filter((item) => item.highlights.length).length)}${quick("untagged", "tag", "没有标签", items.filter((item) => !item.tags.length).length)}${quick("broken", "link", "失效链接", items.filter((item) => item.health.status === "broken").length, 'data-view="broken"')}${quick("unknown", "?", "待检查", items.filter((item) => item.health.status === "unknown").length, 'data-view="unknown"')}</section>${tags.length ? `<section class="sidebar-section tag-section"><div class="sidebar-label">标签 (${tags.length})</div>${tags.map(([tag, count]) => `<div class="tag-row"><button class="tag-filter tree-item ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}"><span class="tree-expand"></span><span class="tree-icon">${treeIcon("tag", true)}</span><span class="tree-title">${escapeHtml(tag)}</span>${sidebarCount(count)}</button><button class="tag-item-menu-trigger" data-tag-item-menu="${escapeHtml(tag)}" title="${escapeHtml(tag)}选项" aria-label="${escapeHtml(tag)}选项" aria-expanded="${state.tagItemMenu === tag}">${treeIcon("more")}</button>${state.tagItemMenu === tag ? `<div class="tag-item-menu" role="menu" data-tag-item-menu-panel><button type="button" role="menuitem" data-tag-item-action="rename" data-tag-value="${escapeHtml(tag)}">重命名标签</button><button type="button" role="menuitem" data-tag-item-action="delete" data-tag-value="${escapeHtml(tag)}">删除标签</button></div>` : ""}</div>`).join("")}</section>` : ""}</nav></aside>`;
}

function accountMenuMarkup() {
  const item = (icon, label, action) => `<button type="button" role="menuitem" data-account-action="${action}">${treeIcon(icon)}<span>${label}</span></button>`;
  return `<div class="account-menu" role="menu" data-account-menu ${state.accountMenuOpen ? "" : "hidden"}>${item("settings", "设置", "settings")}<span class="menu-separator"></span>${item("extension", "浏览器扩展", "extension")}${item("install", "下载应用", "download")}<span class="menu-separator"></span>${item("help", "帮助与支持", "help")}${item("history", "博客", "blog")}${item("calendar", "更新内容?", "updates")}<span class="menu-separator"></span>${item("exit", "注销", "logout")}</div>`;
}

const SETTINGS_NAV = [
  ["app", "应用", "app", true],
  ["account", "帐户", "user", false],
  ["subscription", "订阅", "diamond", false],
  ["import", "导入", "upload", false],
  ["integrations", "整合方式", "integrations", false],
  ["backups", "备份", "backup", false],
  ["tfa", "2FA", "lock", false],
];

const SETTINGS_THEME_OPTIONS = [
  { value: "light", label: "浅色", sidebar: "day", main: "day" },
  { value: "dark", label: "深色", sidebar: "night", main: "night" },
  { value: "auto", label: "跟随系统", sidebar: "night", main: "day" },
  { value: "sunset", label: "日落", sidebar: "sunset", main: "sunset" },
];

const LANGUAGE_OPTIONS = [
  { value: "zh-Hans", label: "中文（汉语）" },
  { value: "en", label: "English" },
];

function settingsPreference(key, fallback) {
  const value = state.preferences?.[key];
  return value == null ? fallback : value;
}

function settingsControlMarkup(key, value, options, icon = "") {
  const current = options.find((option) => option.value === value) || options[0];
  const open = state.settingsMenu === key;
  const labelFor = (option) => key === "language" ? option.label : t(option.label);
  const menu = open ? `<div class="settings-dropdown" role="listbox" data-settings-menu="${key}">${options.map((option) => `<button type="button" role="option" aria-selected="${option.value === current.value}" class="settings-dropdown-option ${key === "language" ? "settings-language-option" : ""} ${option.value === current.value ? "active" : ""}" data-settings-option="${key}" data-settings-value="${escapeHtml(option.value)}">${key === "language" ? `<span class="settings-dropdown-check">${option.value === current.value ? treeIcon("check") : ""}</span>` : ""}${icon ? treeIcon(icon) : ""}<span>${escapeHtml(labelFor(option))}</span></button>`).join("")}</div>` : "";
  return `<div class="settings-control-wrap"><button type="button" class="settings-outline-button" data-settings-select="${key}" aria-haspopup="listbox" aria-expanded="${open}">${icon ? treeIcon(icon) : ""}<span>${escapeHtml(labelFor(current))}</span><span class="settings-control-arrow">${treeIcon("microArrow")}</span></button>${menu}</div>`;
}

function settingsThemeMarkup(theme) {
  return SETTINGS_THEME_OPTIONS.map((option) => `<button type="button" class="settings-theme-option ${theme === option.value ? "active" : ""}" data-settings-theme="${option.value}" aria-pressed="${theme === option.value}" aria-label="${t(option.label)}" title="${t(option.label)}"><span class="settings-theme-preview" data-sidebar-theme="${option.sidebar}" data-main-theme="${option.main}" aria-hidden="true"><span class="settings-theme-sidebar"></span><span class="settings-theme-main">${Array.from({ length: 5 }, () => "<span></span>").join("")}</span></span></button>`).join("");
}

function settingsMarkup() {
  const theme = themeOption().value;
  const defaultView = validLayout(settingsPreference("defaultView", "list")) || "list";
  const bookmarkClick = settingsPreference("bookmarkClick", "new_tab");
  const tagSort = settingsPreference("tagSort", "name");
  const nav = SETTINGS_NAV.map(([id, label, icon, supported]) => `<button type="button" class="settings-nav-item ${id === "app" ? "active" : ""}" data-settings-section="${id}" ${supported ? "" : "disabled"}>${treeIcon(icon)}<span>${t(label)}</span></button>`).join("");
  const viewOptions = VIEW_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
  const clickOptions = [{ value: "new_tab", label: "在新标签页中打开" }, { value: "current_tab", label: "在当前标签页中打开" }];
  const brokenLinkOptions = [{ value: "default", label: "默认模式" }];
  const language = settingsPreference("language", "zh-Hans");
  return localizeHtml(`<main class="settings-shell"><aside class="settings-sidebar"><header class="settings-sidebar-head"><button type="button" class="settings-icon-button settings-close" data-settings-close title="关闭" aria-label="关闭">${treeIcon("close")}</button><button type="button" class="settings-icon-button" data-settings-back title="返回书签" aria-label="返回书签">${treeIcon("back")}</button></header><div class="settings-sidebar-content"><div class="settings-profile"><span class="settings-avatar">${treeIcon("user")}</span><div class="settings-profile-copy"><strong>私有书签</strong><span>私有实例</span></div></div><div class="settings-nav-title">设置</div><nav class="settings-nav" aria-label="设置">${nav}</nav><div class="settings-nav-title settings-version">私有书签</div><a class="settings-nav-item settings-help" href="https://help.raindrop.io" target="_blank" rel="noopener">${treeIcon("help")}<span>帮助</span></a></div></aside><section class="settings-main"><div class="settings-main-inner"><header class="settings-main-header"><button type="button" class="settings-mobile-menu" title="显示设置菜单" aria-label="显示设置菜单">${treeIcon("menu")}</button><h1>应用</h1></header><div class="settings-main-scroll"><div class="settings-content"><div class="settings-grid"><div class="settings-label">语言</div><div>${settingsControlMarkup("language", language, LANGUAGE_OPTIONS)}</div><div class="settings-label">界面样式</div><div class="settings-theme-picker" role="group" aria-label="界面样式">${settingsThemeMarkup(theme)}</div><div class="settings-label">字体大小</div><div><label class="settings-check"><input type="checkbox" data-settings-toggle="largeFont" ${settingsPreference("largeFont", false) ? "checked" : ""}>大</label></div><div class="settings-separator"></div><div class="settings-label">默认视图模式</div><div>${settingsControlMarkup("defaultView", defaultView, viewOptions, "viewGrid")}</div><div class="settings-label">点击书签时</div><div>${settingsControlMarkup("bookmarkClick", bookmarkClick, clickOptions)}</div><div class="settings-label">按钮组</div><div><button type="button" class="settings-outline-button settings-button-group" aria-label="按钮组" title="按钮组">${treeIcon("selectAll")}${treeIcon("show")}${treeIcon("edit")}${treeIcon("trash")}<span class="settings-control-arrow">${treeIcon("microArrow")}</span></button></div><div class="settings-label">搜索</div><div><label class="settings-check settings-disabled"><input type="checkbox" disabled>按相关性排序</label></div><div class="settings-separator"></div><div class="settings-label">排序标签</div><div><label class="settings-radio"><input type="radio" name="settings-tag-sort" value="name" data-settings-tag-sort ${tagSort !== "count" ? "checked" : ""}>按名称</label><label class="settings-radio"><input type="radio" name="settings-tag-sort" value="count" data-settings-tag-sort ${tagSort === "count" ? "checked" : ""}>按书签数量</label></div><div class="settings-label">失效链接 <a class="settings-help-link" href="https://help.raindrop.io/broken-links#reducing-false-positives" target="_blank" rel="noopener">[?]</a></div><div>${settingsControlMarkup("brokenLinks", "default", brokenLinkOptions)}</div><div class="settings-label">嵌套收藏</div><div><label class="settings-check settings-disabled"><input type="checkbox" disabled>旧视图</label></div><div class="settings-separator"></div><div class="settings-label">AI</div><div><label class="settings-check settings-disabled"><input type="checkbox" disabled>询问 AI <a class="settings-help-link" href="https://help.raindrop.io/stella" target="_blank" rel="noopener">[?]</a></label><label class="settings-check settings-disabled"><input type="checkbox" disabled>推荐的收藏集和标签</label><p class="settings-sub-label">Only available for <a href="https://app.raindrop.io/settings/pro" target="_blank" rel="noopener">Pro</a>. AI 功能暂未接入。</p></div></div></div></div></div></section></main>`);
}

function renderSettings() {
  document.title = languageIsEnglish() ? "Private Bookmarks" : "私有书签";
  root.innerHTML = settingsMarkup();
  const aiNote = root.querySelector(".settings-sub-label");
  if (aiNote) aiNote.innerHTML = languageIsEnglish() ? 'Only available for <a href="https://app.raindrop.io/settings/pro" target="_blank" rel="noopener">Pro</a>. AI is not connected yet.' : '仅 Pro 可用。AI 功能暂未接入。';
  applyTheme();
  localizeDialogs();
  bindSettings();
}

function setSettingsPreference(key, value) {
  const previous = state.preferences?.[key];
  state.preferences = { ...state.preferences, [key]: value };
  state.settingsMenu = null;
  applyTheme();
  renderSettings();
  savePreferences({ [key]: value }).catch((error) => {
    state.preferences = { ...state.preferences, [key]: previous };
    applyTheme();
    renderSettings();
    showError(error);
  });
}

function bindSettings() {
  root.querySelector(".settings-mobile-menu")?.addEventListener("click", () => root.querySelector(".settings-shell")?.classList.toggle("settings-sidebar-open"));
  root.querySelectorAll("[data-settings-back], [data-settings-close]").forEach((button) => button.onclick = () => {
    state.accountMenuOpen = false;
    setSettingsRoute(false);
  });
  root.querySelectorAll("[data-settings-select]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    state.settingsMenu = state.settingsMenu === button.dataset.settingsSelect ? null : button.dataset.settingsSelect;
    renderSettings();
  });
  root.querySelectorAll("[data-settings-option]").forEach((option) => option.onclick = () => setSettingsPreference(option.dataset.settingsOption, option.dataset.settingsValue));
  root.querySelectorAll("[data-settings-toggle]").forEach((input) => input.onchange = () => setSettingsPreference(input.dataset.settingsToggle, input.checked));
  root.querySelectorAll("[data-settings-tag-sort]").forEach((input) => input.onchange = () => setSettingsPreference("tagSort", input.value));
  root.querySelectorAll("[data-settings-theme]").forEach((button) => button.onclick = () => setSettingsPreference("theme", button.dataset.settingsTheme));
}

async function load() {
  const path = queryPath();
  const requests = [api("/v1/bootstrap"), api(path), path === "/v1/bookmarks?" ? null : api("/v1/bookmarks?")];
  if (state.view === "trash") requests.push(api("/v1/collections?trash=1"));
  const [boot, items, allItems, trashedCollections = []] = await Promise.all(requests);
  setCoverUploadEnabled(boot.capabilities?.mediaUpload);
  state.collections = boot.collections;
  state.collectionCounts = boot.collectionCounts || {};
  state.trashCount = boot.trashCount || 0;
  state.preferences = boot.preferences;
  state.layout = layoutForScope(boot.preferences);
  state.collapsedCollections = new Set(Array.isArray(boot.preferences.collapsedCollectionIds) ? boot.preferences.collapsedCollectionIds : []);
  state.items = items;
  state.allItems = allItems || items;
  state.favoriteCount = (allItems || items).filter((item) => item.favorite).length;
  state.trashedCollections = trashedCollections;
  applyTheme();
  render();
}

function render() {
  if (state.settingsOpen) return renderSettings();
  document.title = languageIsEnglish() ? "Private Bookmarks" : "私有书签";
  const items = sortedItems();
  const selection = items.filter((item) => state.selected.has(item.id));
  if (!selection.length) state.selectionMoreOpen = false;
  const collectionTrash = state.view === "trash" ? state.trashedCollections.map((item) => `<article class="bookmark-card collection-trash-card"><span>▱</span><span><strong>${escapeHtml(item.name)}</strong><span class="card-meta">收藏夹及其下级项目</span></span><button data-restore-collection="${item.id}" title="恢复收藏夹">↩</button></article>`).join("") : "";
  const cardMenuItem = items.find((item) => item.id === state.cardMenuId);
  if (!cardMenuItem) state.cardMenuId = null;
  const cardMenu = cardMenuItem ? cardActionMenu(cardMenuItem) : "";
  root.innerHTML = localizeHtml(`<main class="library">${sidebarMarkup()}<section class="content"><header class="topbar"><label class="quick-search"><span>⌕</span><input id="search" value="${escapeHtml(state.query)}" placeholder="搜索" autocomplete="off"><kbd>⌘ K</kbd></label><div class="top-actions"><button id="check-links" class="top-action-icon" title="检查链接" aria-label="检查链接">${treeIcon("refresh")}</button><div class="theme-menu-wrap"><button id="theme" class="top-action-icon theme-trigger" title="主题：${themeOption().label}" aria-label="主题：${themeOption().label}" aria-haspopup="menu" aria-expanded="${state.themeMenuOpen}" data-theme-trigger>${treeIcon(themeOption().icon)}</button>${themeMenuMarkup()}</div><button id="import" class="top-action-icon" title="导入书签" aria-label="导入书签">${treeIcon("upload")}</button><input id="import-file" class="hidden" type="file" accept="application/json,text/html,.json,.html,.htm"><button id="add-bookmark" class="primary add-bookmark">＋ 添加</button></div></header><section class="workspace"><header class="workspace-head"><div class="workspace-title"><button id="select-all" class="select-all" title="选择全部" aria-label="选择全部" aria-pressed="${Boolean(items.length && selection.length === items.length)}"><span class="select-checkbox">${items.length && selection.length === items.length ? "✓" : ""}</span></button><h1>☁ ${escapeHtml(viewName())}</h1><span class="count">${items.length}</span></div><div class="workspace-tools"><select id="sort" aria-label="排序"><option value="manual" ${state.preferences?.sort === "manual" ? "selected" : ""}>手动排序</option><option value="title" ${state.preferences?.sort === "title" ? "selected" : ""}>标题 (A-Z)</option><option value="host" ${state.preferences?.sort === "host" ? "selected" : ""}>网站 (A-Z)</option><option value="created" ${state.preferences?.sort === "created" ? "selected" : ""}>最近添加</option></select><div class="view-switcher" role="group" aria-label="视图"><button data-layout="list" class="${state.layout === "list" ? "active" : ""}" title="列表视图" aria-pressed="${state.layout === "list"}">☷ 列表</button><button data-layout="grid" class="${state.layout === "grid" ? "active" : ""}" title="网格视图" aria-pressed="${state.layout === "grid"}">▦ 网格</button></div><button id="export" class="export" title="导出书签">⇩ 导出书签</button></div></header><section class="cards layout-${state.layout}" role="list">${collectionTrash}${items.length ? items.map(card).join("") : collectionTrash || `<p class="empty">此视图中还没有书签。</p>`}${cardMenu}</section><div class="bookmark-count-footer" data-compact="false">${items.length} 个书签</div></section></section></main>`);
  const sidebar = root.querySelector(".sidebar");
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
    setSettingsRoute(true);
    return;
  }
  if (action !== "logout") return;
  await disconnect();
  state.selected.clear();
  state.accountMenuOpen = false;
  connectionView(root, () => load().catch(showError));
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
  const favoriteFilter = root.querySelector('.primary-nav [data-view="favorites"]');
  if (state.favoriteCount && favoriteFilter) {
    favoriteFilter.classList.add("quick-filter", "favorite-filter");
    favoriteFilter.querySelector(".tree-icon").innerHTML = treeIcon("like");
    favoriteFilter.querySelector(".tree-count").textContent = state.favoriteCount;
    root.querySelector(".filters-section .sidebar-label").after(favoriteFilter);
  } else {
    favoriteFilter?.remove();
  }
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
  tagSection.querySelector(".sidebar-label").innerHTML = `<button class="sidebar-section-toggle" data-sidebar-toggle="tags" aria-expanded="${!tagsCollapsed}">${t("标签")} (${tags.length})</button>${tagsCollapsed ? `<button class="section-show" data-sidebar-toggle="tags">${t("显示")}</button>` : `<button class="tag-menu-trigger" data-tag-menu title="${t("标签")} ${t("更多")}" aria-label="${t("标签")} ${t("更多")}" aria-expanded="${state.tagMenuOpen}">${treeIcon("more")}</button>`}`;
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
  state.tag = "";
  state.quickFilter = "";
  state.selected.clear();
  state.selectionMoreOpen = false;
  load().catch(showError);
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
    collectionValueDialog.querySelector("h2").textContent = "修改收藏夹名称";
    form.elements.value.value = item.name;
    form.elements.value.placeholder = "收藏夹名称";
    form.elements.value.required = true;
    state.collectionValueAction = "rename";
    state.collectionValueId = item.id;
    collectionValueDialog.returnValue = "";
    renderSidebar();
    return collectionValueDialog.showModal();
  }
  if (action === "icon") {
    const form = collectionValueDialog.querySelector("form");
    collectionValueDialog.querySelector("h2").textContent = "更改收藏夹图标";
    form.elements.value.value = state.preferences?.collectionIconByCollectionId?.[item.id] || "";
    form.elements.value.placeholder = "输入图标或 Emoji，留空恢复默认";
    form.elements.value.required = false;
    state.collectionValueAction = "icon";
    state.collectionValueId = item.id;
    collectionValueDialog.returnValue = "";
    renderSidebar();
    return collectionValueDialog.showModal();
  }
  if (action === "share") {
    const bookmarks = await api(`/v1/bookmarks?collection=${encodeURIComponent(item.id)}`);
    const text = [`${item.name}（${bookmarks.length}）`, ...bookmarks.map((bookmark) => `${bookmark.title || bookmark.link}\n${bookmark.link}`)].join("\n\n");
    collectionShareDialog.querySelector("h2").textContent = `分享“${item.name}”`;
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
  root.querySelector("#export").onclick = () => api("/v1/export").then(downloadBackup).catch(showError);
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
    card.querySelector("[data-select]").checked = selected;
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
  root.querySelectorAll("[data-quick-filter]").forEach((button) => button.onclick = () => {
    state.quickFilter = button.dataset.quickFilter === state.quickFilter ? "" : button.dataset.quickFilter;
    state.tag = "";
    state.selected.clear();
    render();
  });
  root.querySelectorAll("[data-tag]").forEach((button) => button.onclick = () => {
    state.tagItemMenu = null;
    state.tag = button.dataset.tag === state.tag ? "" : button.dataset.tag;
    state.quickFilter = "";
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
    commitSearch(search.value);
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
  prepareCardActionProxies();
  root.querySelectorAll("[data-edit]").forEach((button) => button.onclick = () => {
    const item = state.items.find((entry) => entry.id === button.dataset.edit);
    const form = editBookmarkDialog.querySelector("form");
    form.elements.link.value = item.link;
    form.elements.title.value = item.title;
    form.elements.description.value = item.description;
    form.elements.note.value = item.note;
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
      form.querySelector(".edit-collection-icon").innerHTML = treeIcon(form.elements.collectionId.value === "unsorted" ? "inbox" : "folder");
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
    editBookmarkDialog.dataset.bookmarkId = item.id;
    editBookmarkDialog.dataset.highlights = JSON.stringify(item.highlights);
    const highlightsButton = form.querySelector("#edit-highlights");
    if (highlightsButton) highlightsButton.onclick = () => {
      editBookmarkDialog.dataset.highlights = JSON.stringify(editHighlights({ ...item, highlights: JSON.parse(editBookmarkDialog.dataset.highlights) }));
    };
    editBookmarkDialog.showModal();
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
    form.elements.collectionId.innerHTML = collectionOptions(state.collections, state.collectionId || state.preferences.defaultCollectionId);
    bookmarkDialog.showModal();
  };
  root.querySelector("#import").onclick = () => root.querySelector("#import-file").click();
  root.querySelector("#import-file").onchange = (event) => importFile(event.target.files[0]).catch(showError);
  root.querySelector("#check-links").onclick = async () => { await api("/v1/health-checks", { method: "POST", body: JSON.stringify({ collectionId: state.collectionId }) }); load().catch(showError); };
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

async function importFile(file) {
  if (!file) return;
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const backup = JSON.parse(text);
    if (backup.format !== "private-bookmarks/v1") throw new TypeError("这不是私有书签备份文件");
    downloadBackup(await api("/v1/export"));
    if (!window.confirm("要用此备份替换整个书签资料库吗？已先下载当前快照。")) return;
    await api("/v1/restore", { method: "POST", body: JSON.stringify({ confirm: true, backup }) });
  } else {
    const document = new DOMParser().parseFromString(text, "text/html");
    const links = [...document.querySelectorAll("a[href]")].map((link) => ({ link: link.href, title: link.textContent.trim(), collectionId: "unsorted" })).filter((item) => /^https?:/.test(item.link));
    for (const item of links) await api("/v1/bookmarks", { method: "POST", body: JSON.stringify(item) });
  }
  state.selected.clear();
  await load();
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
  if (action === "icon") {
    const icons = { ...(state.preferences?.collectionIconByCollectionId || {}) };
    if (value) icons[item.id] = value.slice(0, 8);
    else delete icons[item.id];
    await savePreferences({ collectionIconByCollectionId: icons });
    renderSidebar();
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
  if (bookmarkDialog.returnValue !== "create") return;
  const form = bookmarkDialog.querySelector("form");
  const fields = new FormData(form);
  await api("/v1/bookmarks", { method: "POST", body: JSON.stringify({ link: fields.get("link"), title: fields.get("title"), collectionId: fields.get("collectionId") }) });
  form.reset();
  load().catch(showError);
});

editBookmarkDialog.addEventListener("close", async () => {
  if (editBookmarkDialog.returnValue !== "save") return;
  const item = state.items.find((entry) => entry.id === editBookmarkDialog.dataset.bookmarkId);
  if (!item) return;
  const fields = new FormData(editBookmarkDialog.querySelector("form"));
  await mutate(`/v1/bookmarks/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      revision: item.revision,
      link: fields.get("link"),
      title: fields.get("title"),
      description: fields.get("description"),
      note: fields.get("note"),
      cover: fields.get("cover") || "",
      media: JSON.parse(fields.get("media") || "[]"),
      collectionId: fields.get("collectionId"),
      tags: JSON.parse(fields.get("tags") || "[]"),
      favorite: fields.has("favorite"),
      highlights: JSON.parse(editBookmarkDialog.dataset.highlights),
    }),
  });
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
  const insideSettingsControl = event.target.closest("[data-settings-select], [data-settings-menu]");
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
  if (error?.code === "editing_conflict") {
    if (window.confirm("此项目已在其他设备上更新。现在刷新最新内容吗？未保存的修改不会应用。")) load().catch(console.error);
    return;
  }
  window.alert(error.message || "请求失败");
}

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  showError(event.reason);
});

window.addEventListener("popstate", () => {
  state.settingsOpen = new URL(location.href).searchParams.get("settings") === "app";
  state.settingsMenu = null;
  render();
});

if (await connection()) load().catch(showError);
else connectionView(root, () => load().catch(showError));
