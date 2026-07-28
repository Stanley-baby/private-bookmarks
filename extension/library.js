import { api, connection } from "./api.js";
import { collectionOptions, connectionView, escapeHtml } from "./ui.js";

const root = document.querySelector("#app");
const dialog = document.querySelector("#collection-dialog");
const bookmarkDialog = document.querySelector("#bookmark-dialog");
const state = {
  view: "all", collectionId: null, query: "", quickFilter: "", tag: "", selected: new Set(),
  items: [], collections: [], collectionCounts: {}, trashCount: 0, trashedCollections: [], preferences: null, layout: "list",
  collapsedCollections: new Set(), dragBookmark: null, dragCollection: null, searchTimer: null,
};

function applyTheme() {
  document.documentElement.style.colorScheme = state.preferences?.theme === "light" || state.preferences?.theme === "dark" ? state.preferences.theme : "light dark";
}

function collectionTree(parentId = null, depth = 0) {
  return state.collections.filter((item) => item.parentId === parentId && item.id !== "unsorted").map((item) => {
    const hasChildren = state.collections.some((child) => child.parentId === item.id);
    const collapsed = state.collapsedCollections.has(item.id);
    const editable = item.id !== "unsorted";
    const count = state.collectionCounts[item.id] || 0;
    return `<div class="collection-branch"><div class="collection-row indent" style="--depth:${depth}" data-drop-collection="${item.id}" ${editable ? `data-drag-collection="${item.id}" draggable="true"` : ""}><button class="collection-toggle ${hasChildren ? "" : "placeholder"}" ${hasChildren ? `data-toggle-collection="${item.id}" aria-label="${collapsed ? "展开" : "收起"}${escapeHtml(item.name)}" aria-expanded="${!collapsed}"` : "tabindex=\"-1\""}>${collapsed ? "›" : "⌄"}</button><button class="collection-link ${state.collectionId === item.id ? "active" : ""}" data-collection="${item.id}"><span class="collection-icon">▱</span><span class="collection-name">${escapeHtml(item.name)}</span><small class="collection-count">${count}</small></button>${editable ? `<span class="collection-actions"><button data-edit-collection="${item.id}" title="编辑收藏夹" aria-label="编辑${escapeHtml(item.name)}">✎</button><button data-delete-collection="${item.id}" title="移入废纸篓" aria-label="将${escapeHtml(item.name)}移入废纸篓">⌫</button></span>` : ""}</div>${hasChildren && !collapsed ? collectionTree(item.id, depth + 1) : ""}</div>`;
  }).join("");
}

function queryPath() {
  const params = new URLSearchParams();
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (state.query) params.set("search", state.query);
  return `/v1/bookmarks?${params}`;
}

function viewName() {
  if (state.collectionId) return state.collections.find((item) => item.id === state.collectionId)?.name || "收藏夹";
  return ({ all: "所有书签", favorites: "星标", broken: "失效链接", unknown: "待检查", trash: "废纸篓" })[state.view];
}

function visibleItems() {
  return state.items.filter((item) => {
    if (state.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === state.tag.toLocaleLowerCase())) return false;
    if (state.quickFilter === "notes" && !item.note) return false;
    if (state.quickFilter === "highlights" && !item.highlights.length) return false;
    if (state.quickFilter === "untagged" && item.tags.length) return false;
    return true;
  });
}

function tagList(items) {
  const tags = new Map();
  for (const item of items) for (const tag of item.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  return [...tags].sort(([a], [b]) => a.localeCompare(b)).slice(0, 40);
}

function host(link) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return link; }
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
  const tags = item.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("");
  const description = escapeHtml(item.description || item.note || "");
  const status = item.health.status === "broken" ? `<span class="health broken" title="失效链接">⌁</span>` : "";
  return `<article draggable="true" data-drag-bookmark="${item.id}" class="bookmark-card" style="--stagger:${Math.min(index, 12)}"><label class="card-select"><input aria-label="选择${escapeHtml(item.title || item.link)}" type="checkbox" data-select="${item.id}" ${selected}></label><a class="card-main" href="${escapeHtml(item.link)}" target="_blank"><span class="card-cover"><img src="${escapeHtml(item.cover || "icons/bookmark.svg")}" alt="" referrerpolicy="no-referrer"></span><span class="card-copy"><strong class="card-title">${escapeHtml(item.title || item.link)}</strong>${description ? `<span class="card-description">${description}</span>` : ""}<span class="card-meta">${tags || ""}<span class="domain">${escapeHtml(host(item.link))}</span>${item.highlights.length ? `<span>· ${item.highlights.length} 条高亮</span>` : ""}${status}</span></span></a><span class="card-actions"><button title="编辑" aria-label="编辑书签" data-edit="${item.id}">✎</button><button title="${item.favorite ? "取消星标" : "添加星标"}" aria-label="${item.favorite ? "取消星标" : "添加星标"}" data-favorite="${item.id}">${item.favorite ? "★" : "☆"}</button><button title="${state.view === "trash" ? "恢复" : "移入废纸篓"}" aria-label="${state.view === "trash" ? "恢复" : "移入废纸篓"}" data-delete="${item.id}">${state.view === "trash" ? "↩" : "⌫"}</button></span></article>`;
}

async function load() {
  const requests = [api("/v1/bootstrap"), api(queryPath())];
  if (state.view === "trash") requests.push(api("/v1/collections?trash=1"));
  const [boot, items, trashedCollections = []] = await Promise.all(requests);
  state.collections = boot.collections;
  state.collectionCounts = boot.collectionCounts || {};
  state.trashCount = boot.trashCount || 0;
  state.preferences = boot.preferences;
  state.layout = boot.preferences.layout === "grid" ? "grid" : "list";
  state.collapsedCollections = new Set(Array.isArray(boot.preferences.collapsedCollectionIds) ? boot.preferences.collapsedCollectionIds : []);
  state.items = items;
  state.trashedCollections = trashedCollections;
  applyTheme();
  render();
}

function render() {
  const items = visibleItems();
  const selection = items.filter((item) => state.selected.has(item.id));
  const tags = tagList(state.items);
  const total = Object.values(state.collectionCounts).reduce((sum, count) => sum + count, 0);
  const collectionTrash = state.view === "trash" ? state.trashedCollections.map((item) => `<article class="bookmark-card collection-trash-card"><span>▱</span><span><strong>${escapeHtml(item.name)}</strong><span class="card-meta">收藏夹及其下级项目</span></span><button data-restore-collection="${item.id}" title="恢复收藏夹">↩</button></article>`).join("") : "";
  const quick = (id, icon, label) => `<button class="quick-filter ${state.quickFilter === id ? "active" : ""}" data-quick-filter="${id}"><span>${icon}</span>${label}</button>`;
  const nav = (active, icon, label, count, attribute) => `<button class="nav-item ${active ? "active" : ""}" ${attribute}><span>${icon}</span><span>${label}</span><small class="nav-count">${count}</small></button>`;
  root.innerHTML = `<main class="library"><aside class="sidebar"><div class="sidebar-head"><span class="account-mark"><img src="icons/bookmark.svg" width="18" height="18" alt=""></span><strong>私有书签</strong><button id="new-collection" class="icon-button" title="新建收藏夹" aria-label="新建收藏夹">＋</button></div><nav class="nav"><section class="sidebar-section">${nav(state.view === "all" && !state.collectionId, "☁", "所有书签", total, 'data-view="all"')}${nav(state.collectionId === "unsorted", "▱", "未分类", state.collectionCounts.unsorted || 0, 'data-collection="unsorted"')}${nav(state.view === "favorites", "★", "星标", state.items.filter((item) => item.favorite).length, 'data-view="favorites"')}${nav(state.view === "trash", "⌫", "废纸篓", state.trashCount, 'data-view="trash"')}</section><section class="sidebar-section collections-section"><div class="sidebar-label"><span>收藏夹</span><button id="new-collection-secondary" title="新建收藏夹" aria-label="新建收藏夹">＋</button></div>${collectionTree()}</section><section class="sidebar-section filters-section"><div class="sidebar-label">快速筛选…</div>${quick("notes", "▤", "备注")}${quick("highlights", "▰", "高亮")}${quick("untagged", "#", "没有标签")}<button class="quick-filter ${state.view === "broken" ? "active" : ""}" data-view="broken"><span>⌁</span>失效链接</button><button class="quick-filter ${state.view === "unknown" ? "active" : ""}" data-view="unknown"><span>?</span>待检查</button></section>${tags.length ? `<section class="sidebar-section tag-section"><div class="sidebar-label">标签 (${tags.length})</div>${tags.map(([tag, count]) => `<button class="tag-filter ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}"><span>#${escapeHtml(tag)}</span><small>${count}</small></button>`).join("")}</section>` : ""}</nav></aside><section class="content"><header class="topbar"><label class="quick-search"><span>⌕</span><input id="search" value="${escapeHtml(state.query)}" placeholder="搜索" autocomplete="off"><kbd>⌘ K</kbd></label><div class="top-actions"><button id="check-links" title="检查链接" aria-label="检查链接">⌁</button><button id="theme" title="切换主题" aria-label="切换主题">◐</button><button id="import" title="导入" aria-label="导入">↑</button><button id="export" title="导出" aria-label="导出">↓</button><input id="import-file" class="hidden" type="file" accept="application/json,text/html,.json,.html,.htm"></div></header><section class="workspace"><header class="workspace-head"><div><p class="eyebrow">资料库</p><h1>${escapeHtml(viewName())}</h1></div><div class="workspace-tools"><button id="add-bookmark" class="primary add-bookmark">＋ 添加</button><span class="count">${items.length}</span><div class="view-switcher" role="group" aria-label="视图"><button data-layout="list" class="${state.layout === "list" ? "active" : ""}" title="列表视图" aria-pressed="${state.layout === "list"}">☷</button><button data-layout="grid" class="${state.layout === "grid" ? "active" : ""}" title="网格视图" aria-pressed="${state.layout === "grid"}">▦</button></div></div></header>${selection.length ? `<div class="batch"><strong>已选择 ${selection.length} 项</strong><button title="添加星标" data-batch="favorite">★</button><button title="取消星标" data-batch="unfavorite">☆</button><button title="编辑标签" data-batch="tags">#</button><select id="move-to"><option value="">移动到…</option>${state.collections.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select>${state.view === "trash" ? `<button data-batch="restore">恢复</button>` : `<button class="danger" data-batch="trash">移入废纸篓</button>`}</div>` : ""}<section class="cards layout-${state.layout}">${collectionTrash}${items.length ? items.map(card).join("") : collectionTrash || `<p class="empty">此视图中还没有书签。</p>`}</section></section></section></main>`;
  bind();
}

function switchView(view, collectionId = null) {
  state.view = view;
  state.collectionId = collectionId;
  state.tag = "";
  state.quickFilter = "";
  state.selected.clear();
  load().catch(showError);
}

async function savePreferences(changes) {
  const { revision, ...preferences } = state.preferences;
  const next = await mutate("/v1/preferences", { method: "PATCH", body: JSON.stringify({ revision, preferences: { ...preferences, ...changes } }) });
  if (next) state.preferences = next;
  return next;
}

function bind() {
  root.querySelectorAll(".card-cover img").forEach((image) => image.addEventListener("error", () => { image.src = "icons/bookmark.svg"; }, { once: true }));
  root.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => switchView(button.dataset.view));
  root.querySelectorAll("[data-collection]").forEach((button) => button.onclick = () => switchView("all", button.dataset.collection));
  root.querySelectorAll("[data-delete-collection]").forEach((button) => button.onclick = async () => {
    const item = state.collections.find((entry) => entry.id === button.dataset.deleteCollection);
    if (!window.confirm(`要将“${item.name}”及其内容移入废纸篓吗？`)) return;
    await mutate(`/v1/collections/${item.id}?revision=${item.revision}`, { method: "DELETE" });
    switchView("all");
  });
  root.querySelectorAll("[data-quick-filter]").forEach((button) => button.onclick = () => {
    state.quickFilter = button.dataset.quickFilter === state.quickFilter ? "" : button.dataset.quickFilter;
    state.tag = "";
    state.selected.clear();
    render();
  });
  root.querySelectorAll("[data-tag]").forEach((button) => button.onclick = () => {
    state.tag = button.dataset.tag === state.tag ? "" : button.dataset.tag;
    state.quickFilter = "";
    state.selected.clear();
    render();
  });
  root.querySelectorAll("[data-layout]").forEach((button) => button.onclick = () => {
    const layout = button.dataset.layout;
    if (layout === state.layout) return;
    state.layout = layout;
    render();
    savePreferences({ layout }).catch(showError);
  });
  root.querySelectorAll("[data-toggle-collection]").forEach((button) => button.onclick = () => {
    const id = button.dataset.toggleCollection;
    state.collapsedCollections.has(id) ? state.collapsedCollections.delete(id) : state.collapsedCollections.add(id);
    const collapsedCollectionIds = [...state.collapsedCollections];
    render();
    savePreferences({ collapsedCollectionIds }).catch(showError);
  });
  root.querySelectorAll("[data-edit-collection]").forEach((button) => button.onclick = async () => {
    const item = state.collections.find((entry) => entry.id === button.dataset.editCollection);
    const name = window.prompt("收藏夹名称", item.name);
    if (!name?.trim()) return;
    const parentName = window.prompt("上级收藏夹名称（留空为顶级）", state.collections.find((entry) => entry.id === item.parentId)?.name || "");
    const parent = parentName ? state.collections.find((entry) => entry.name === parentName) : null;
    if (parentName && !parent) throw new TypeError("未找到该收藏夹");
    await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, name, parentId: parent?.id || null }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-restore-collection]").forEach((button) => button.onclick = async () => {
    const item = state.trashedCollections.find((entry) => entry.id === button.dataset.restoreCollection);
    await mutate(`/v1/collections/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    load().catch(showError);
  });
  const search = root.querySelector("#search");
  search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.query = search.value.trim();
      state.selected.clear();
      load().catch(showError);
    }, 180);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    clearTimeout(state.searchTimer);
    state.query = search.value.trim();
    state.selected.clear();
    load().catch(showError);
  });
  root.querySelectorAll("[data-select]").forEach((input) => input.onchange = () => { input.checked ? state.selected.add(input.dataset.select) : state.selected.delete(input.dataset.select); render(); });
  root.querySelectorAll("[data-favorite]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.favorite);
    await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, favorite: !item.favorite }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-edit]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.edit);
    const title = window.prompt("标题", item.title);
    if (title == null) return;
    const note = window.prompt("备注", item.note);
    if (note == null) return;
    const tags = window.prompt("标签（以逗号分隔）", item.tags.join(", "));
    if (tags == null) return;
    const highlights = editHighlights(item);
    await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, title, note, tags: tags.split(","), highlights }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-delete]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.delete);
    if (state.view === "trash") await mutate(`/v1/bookmarks/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    else await mutate(`/v1/bookmarks/${item.id}?revision=${item.revision}`, { method: "DELETE" });
    load().catch(showError);
  });
  root.querySelectorAll("[data-batch]").forEach((button) => button.onclick = () => batch(button.dataset.batch));
  root.querySelector("#move-to")?.addEventListener("change", (event) => event.target.value && batch("move", event.target.value));
  root.querySelectorAll("#new-collection, #new-collection-secondary").forEach((button) => button.onclick = () => dialog.showModal());
  root.querySelector("#add-bookmark").onclick = () => {
    const form = bookmarkDialog.querySelector("form");
    form.elements.collectionId.innerHTML = collectionOptions(state.collections, state.collectionId || state.preferences.defaultCollectionId);
    bookmarkDialog.showModal();
  };
  root.querySelector("#export").onclick = () => api("/v1/export").then(downloadBackup).catch(showError);
  root.querySelector("#import").onclick = () => root.querySelector("#import-file").click();
  root.querySelector("#import-file").onchange = (event) => importFile(event.target.files[0]).catch(showError);
  root.querySelector("#check-links").onclick = async () => { await api("/v1/health-checks", { method: "POST", body: JSON.stringify({ collectionId: state.collectionId }) }); load().catch(showError); };
  root.querySelector("#theme").onclick = async () => {
    const themes = ["auto", "light", "dark"];
    const theme = themes[(themes.indexOf(state.preferences.theme) + 1) % themes.length];
    if (await savePreferences({ theme })) applyTheme();
  };
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

async function batch(kind, collectionId) {
  const action = kind === "move" ? { type: "move", collectionId } : kind === "trash" ? { type: "trash" } : kind === "restore" ? { type: "restore" } : kind === "tags" ? { type: "tags", mode: window.confirm("点击“确定”添加标签，点击“取消”移除标签。") ? "add" : "remove", tags: (window.prompt("标签（以逗号分隔）") || "").split(",") } : { type: "favorite", favorite: kind === "favorite" };
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

dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "create") return;
  const name = new FormData(dialog.querySelector("form")).get("name");
  await api("/v1/collections", { method: "POST", body: JSON.stringify({ name, parentId: state.collectionId || null }) });
  dialog.querySelector("form").reset();
  load().catch(showError);
});

bookmarkDialog.addEventListener("close", async () => {
  if (bookmarkDialog.returnValue !== "create") return;
  const form = bookmarkDialog.querySelector("form");
  const fields = new FormData(form);
  await api("/v1/bookmarks", { method: "POST", body: JSON.stringify({ link: fields.get("link"), title: fields.get("title"), collectionId: fields.get("collectionId") }) });
  form.reset();
  load().catch(showError);
});

document.addEventListener("keydown", (event) => {
  const search = root.querySelector("#search");
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") || (event.key === "/" && !typing)) {
    event.preventDefault();
    search?.focus();
    search?.select();
  }
  if (event.key === "Escape" && document.activeElement === search && search.value) {
    event.preventDefault();
    search.value = "";
    state.query = "";
    state.selected.clear();
    load().catch(showError);
  }
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

if (await connection()) load().catch(showError);
else connectionView(root, () => load().catch(showError));
