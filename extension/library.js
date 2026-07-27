import { api, connection } from "./api.js";
import { connectionView, escapeHtml } from "./ui.js";

const root = document.querySelector("#app");
const dialog = document.querySelector("#collection-dialog");
const state = { view: "all", collectionId: null, query: "", selected: new Set(), items: [], collections: [], trashedCollections: [], preferences: null, dragBookmark: null, dragCollection: null };

function applyTheme() {
  document.documentElement.style.colorScheme = state.preferences?.theme === "light" || state.preferences?.theme === "dark" ? state.preferences.theme : "light dark";
}

function tree(parentId = null, depth = 0) {
  return state.collections.filter((item) => item.parentId === parentId).map((item) => `<span draggable="true" data-drag-collection="${item.id}" class="collection-row indent" style="--depth:${depth}"><button class="${state.collectionId === item.id ? "active" : ""}" data-collection="${item.id}">▸ ${escapeHtml(item.name)}</button>${item.id === "unsorted" ? "" : `<button data-edit-collection="${item.id}" title="Edit collection">✎</button><button data-delete-collection="${item.id}" title="Delete collection">⌫</button>`}</span>${tree(item.id, depth + 1)}`).join("");
}

function queryPath() {
  const params = new URLSearchParams();
  if (state.collectionId) params.set("collection", state.collectionId);
  else if (state.view !== "all") params.set("view", state.view);
  if (state.query) params.set("search", state.query);
  return `/v1/bookmarks?${params}`;
}

async function mutate(path, init) {
  try {
    return await api(path, init);
  } catch (error) {
    if (error?.code !== "editing_conflict") throw error;
    if (!window.confirm("This item changed on another device. Press OK to overwrite it with your change, or Cancel to refresh the latest version.")) {
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

function card(item) {
  const selected = state.selected.has(item.id) ? "checked" : "";
  const detail = item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") || `<span class="muted">${escapeHtml(item.description || item.note || "No notes")}${item.highlights.length ? ` · ${item.highlights.length} highlight${item.highlights.length === 1 ? "" : "s"}` : ""}</span>`;
  return `<article draggable="true" data-drag-bookmark="${item.id}" class="card"><input aria-label="Select ${escapeHtml(item.title || item.link)}" type="checkbox" data-select="${item.id}" ${selected}><a class="card-main" href="${escapeHtml(item.link)}" target="_blank"><img class="card-cover" src="${escapeHtml(item.cover || "icons/bookmark.svg")}" alt="" onerror="this.src='icons/bookmark.svg'"><span><strong class="card-title">${escapeHtml(item.title || item.link)}</strong><span class="card-url">${escapeHtml(item.link)}</span><span class="tags">${detail}</span></span></a><span class="card-actions"><button title="Edit" data-edit="${item.id}">✎</button><button title="${item.favorite ? "Remove favorite" : "Favorite"}" data-favorite="${item.id}">${item.favorite ? "★" : "☆"}</button><button title="${state.view === "trash" ? "Restore" : "Delete"}" data-delete="${item.id}">${state.view === "trash" ? "↩" : "⌫"}</button></span></article>`;
}

async function load() {
  const requests = [api("/v1/bootstrap"), api(queryPath())];
  if (state.view === "trash") requests.push(api("/v1/collections?trash=1"));
  const [boot, items, trashedCollections = []] = await Promise.all(requests);
  state.collections = boot.collections;
  state.preferences = boot.preferences;
  state.items = items;
  state.trashedCollections = trashedCollections;
  applyTheme();
  render();
}

function render() {
  const selection = state.items.filter((item) => state.selected.has(item.id));
  const collectionTrash = state.view === "trash" ? state.trashedCollections.map((item) => `<article class="card"><span>▸</span><span><strong>${escapeHtml(item.name)}</strong><span class="card-url">Collection and descendants</span></span><button data-restore-collection="${item.id}">↩</button></article>`).join("") : "";
  root.innerHTML = `<main class="library"><aside class="sidebar"><div class="sidebar-head"><img src="icons/bookmark.svg" width="24" height="24" alt=""><strong>Private Bookmarks</strong><button id="new-collection" title="New collection">＋</button></div><nav class="nav"><button class="${state.view === "all" && !state.collectionId ? "active" : ""}" data-view="all">▣ All bookmarks</button><button class="${state.view === "favorites" ? "active" : ""}" data-view="favorites">★ Favorites</button><button class="${state.view === "broken" ? "active" : ""}" data-view="broken">⌁ Broken links</button><button class="${state.view === "unknown" ? "active" : ""}" data-view="unknown">? Needs review</button><button class="${state.view === "trash" ? "active" : ""}" data-view="trash">⌫ Trash</button><hr>${tree()}</nav></aside><section class="content"><header class="list-tools"><input id="search" value="${escapeHtml(state.query)}" placeholder="Search bookmarks"><button id="import" title="Import">↑</button><button id="export" title="Export">↓</button><input id="import-file" class="hidden" type="file" accept="application/json,text/html,.json,.html,.htm"><button id="check-links" title="Check links">⌁</button><button id="theme" title="Theme">◐</button><span class="count">${state.items.length}</span></header>${selection.length ? `<div class="batch"><strong>${selection.length} selected</strong><button data-batch="favorite">★</button><button data-batch="unfavorite">☆</button><button data-batch="tags">#</button><select id="move-to"><option value="">Move to…</option>${state.collections.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select>${state.view === "trash" ? `<button data-batch="restore">Restore</button>` : `<button class="danger" data-batch="trash">Delete</button>`}</div>` : ""}<section class="cards">${collectionTrash}${state.items.length ? state.items.map(card).join("") : collectionTrash || `<p class="empty">No bookmarks here yet.</p>`}</section></section></main>`;
  bind();
}

function switchView(view, collectionId = null) {
  state.view = view;
  state.collectionId = collectionId;
  state.selected.clear();
  load().catch(showError);
}

function bind() {
  root.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => switchView(button.dataset.view));
  root.querySelectorAll("[data-collection]").forEach((button) => button.onclick = () => switchView("all", button.dataset.collection));
  root.querySelectorAll("[data-delete-collection]").forEach((button) => button.onclick = async () => {
    const item = state.collections.find((entry) => entry.id === button.dataset.deleteCollection);
    if (!window.confirm(`Move ${item.name} and its contents to Trash?`)) return;
    await mutate(`/v1/collections/${item.id}?revision=${item.revision}`, { method: "DELETE" });
    switchView("all");
  });
  root.querySelectorAll("[data-edit-collection]").forEach((button) => button.onclick = async () => {
    const item = state.collections.find((entry) => entry.id === button.dataset.editCollection);
    const name = window.prompt("Collection name", item.name);
    if (!name?.trim()) return;
    const parentName = window.prompt("Parent collection name (leave blank for top level)", state.collections.find((entry) => entry.id === item.parentId)?.name || "");
    const parent = parentName ? state.collections.find((entry) => entry.name === parentName) : null;
    if (parentName && !parent) throw new TypeError("No collection has that name");
    await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, name, parentId: parent?.id || null }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-restore-collection]").forEach((button) => button.onclick = async () => {
    const item = state.trashedCollections.find((entry) => entry.id === button.dataset.restoreCollection);
    await mutate(`/v1/collections/${item.id}/restore`, { method: "POST", body: JSON.stringify({ revision: item.revision }) });
    load().catch(showError);
  });
  root.querySelector("#search").addEventListener("change", (event) => { state.query = event.target.value.trim(); state.selected.clear(); load().catch(showError); });
  root.querySelectorAll("[data-select]").forEach((input) => input.onchange = () => { input.checked ? state.selected.add(input.dataset.select) : state.selected.delete(input.dataset.select); render(); });
  root.querySelectorAll("[data-favorite]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.favorite);
    await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, favorite: !item.favorite }) });
    load().catch(showError);
  });
  root.querySelectorAll("[data-edit]").forEach((button) => button.onclick = async () => {
    const item = state.items.find((entry) => entry.id === button.dataset.edit);
    const title = window.prompt("Title", item.title);
    if (title == null) return;
    const note = window.prompt("Note", item.note);
    if (note == null) return;
    const tags = window.prompt("Tags (comma separated)", item.tags.join(", "));
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
  root.querySelector("#new-collection").onclick = () => dialog.showModal();
  root.querySelector("#export").onclick = () => api("/v1/export").then(downloadBackup).catch(showError);
  root.querySelector("#import").onclick = () => root.querySelector("#import-file").click();
  root.querySelector("#import-file").onchange = (event) => importFile(event.target.files[0]).catch(showError);
  root.querySelector("#check-links").onclick = async () => { await api("/v1/health-checks", { method: "POST", body: JSON.stringify({ collectionId: state.collectionId }) }); load().catch(showError); };
  root.querySelector("#theme").onclick = async () => {
    const themes = ["auto", "light", "dark"];
    const theme = themes[(themes.indexOf(state.preferences.theme) + 1) % themes.length];
    const preferences = await mutate("/v1/preferences", { method: "PATCH", body: JSON.stringify({ revision: state.preferences.revision, preferences: { ...state.preferences, theme } }) });
    if (preferences) {
      state.preferences = preferences;
      applyTheme();
    }
  };
  root.querySelectorAll("[data-drag-bookmark]").forEach((card) => {
    card.ondragstart = () => { state.dragBookmark = card.dataset.dragBookmark; };
    card.ondragover = (event) => event.preventDefault();
    card.ondrop = () => reorderBookmark(card.dataset.dragBookmark);
  });
  root.querySelectorAll("[data-drag-collection]").forEach((row) => {
    row.ondragstart = () => { state.dragCollection = row.dataset.dragCollection; };
    row.ondragover = (event) => event.preventDefault();
    row.ondrop = () => reorderCollection(row.dataset.dragCollection);
  });
}

function editHighlights(item) {
  if (!item.highlights.length) return item.highlights;
  const summary = item.highlights.map((highlight, index) => `${index + 1}. “${String(highlight.text || "").slice(0, 80)}” · ${highlight.color || "#ffe920"} · ${highlight.note || "(no note)"}`).join("\n");
  const choice = window.prompt(`Highlights:\n${summary}\n\nEnter a number to edit, or d<number> to delete. Leave blank to keep all.`, "");
  if (!choice?.trim()) return item.highlights;
  const remove = choice.trim().match(/^d(\d+)$/i);
  const index = Number(remove?.[1] || choice) - 1;
  if (!Number.isInteger(index) || !item.highlights[index]) throw new TypeError("Choose a listed highlight number");
  if (remove) return item.highlights.filter((_, current) => current !== index);
  const current = item.highlights[index];
  const color = window.prompt("Color (#ffe920, #0064ff, #00c564, or #ff4646)", current.color || "#ffe920");
  if (color == null) return item.highlights;
  if (!["#ffe920", "#0064ff", "#00c564", "#ff4646"].includes(color.toLocaleLowerCase())) throw new TypeError("Choose one of the four highlight colors");
  const note = window.prompt("Note", current.note || "");
  if (note == null) return item.highlights;
  return item.highlights.map((highlight, currentIndex) => currentIndex === index ? { ...highlight, color: color.toLocaleLowerCase(), note: note.trim() } : highlight);
}

function downloadBackup(backup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `private-bookmarks-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

async function importFile(file) {
  if (!file) return;
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const backup = JSON.parse(text);
    if (backup.format !== "private-bookmarks/v1") throw new TypeError("This is not a Private Bookmarks backup");
    downloadBackup(await api("/v1/export"));
    if (!window.confirm("Replace the entire bookmark library with this backup? A snapshot was downloaded first.")) return;
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
  const action = kind === "move" ? { type: "move", collectionId } : kind === "trash" ? { type: "trash" } : kind === "restore" ? { type: "restore" } : kind === "tags" ? { type: "tags", mode: window.confirm("Add these tags? Cancel removes them.") ? "add" : "remove", tags: (window.prompt("Tags (comma separated)") || "").split(",") } : { type: "favorite", favorite: kind === "favorite" };
  const items = state.items.filter((item) => state.selected.has(item.id)).map(({ id, revision }) => ({ id, revision }));
  await mutate("/v1/bookmarks/batch", { method: "POST", body: JSON.stringify({ items, action }) });
  state.selected.clear();
  load().catch(showError);
}

function positionBetween(items, movingId, targetId) {
  const ordered = items.filter((item) => item.id !== movingId);
  const target = ordered.findIndex((item) => item.id === targetId);
  ordered.splice(target < 0 ? ordered.length : target, 0, items.find((item) => item.id === movingId));
  const index = ordered.findIndex((item) => item.id === movingId);
  const before = ordered[index - 1]?.position;
  const after = ordered[index + 1]?.position;
  return before == null ? (after ?? 0) - 1 : after == null ? before + 1 : (before + after) / 2;
}

async function reorderBookmark(targetId) {
  if (!state.dragBookmark || state.dragBookmark === targetId) return;
  const item = state.items.find((entry) => entry.id === state.dragBookmark);
  const target = state.items.find((entry) => entry.id === targetId);
  if (!target || item.collectionId !== target.collectionId) return;
  await mutate(`/v1/bookmarks/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, position: positionBetween(state.items, item.id, targetId) }) });
  state.dragBookmark = null;
  load().catch(showError);
}

async function reorderCollection(targetId) {
  if (!state.dragCollection || state.dragCollection === targetId) return;
  const item = state.collections.find((entry) => entry.id === state.dragCollection);
  const target = state.collections.find((entry) => entry.id === targetId);
  if (!target || item.parentId !== target.parentId) return;
  const siblings = state.collections.filter((entry) => entry.parentId === item.parentId);
  await mutate(`/v1/collections/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, position: positionBetween(siblings, item.id, targetId) }) });
  state.dragCollection = null;
  load().catch(showError);
}

dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "create") return;
  const name = new FormData(dialog.querySelector("form")).get("name");
  await api("/v1/collections", { method: "POST", body: JSON.stringify({ name, parentId: state.collectionId || null }) });
  dialog.querySelector("form").reset();
  load().catch(showError);
});

function showError(error) {
  console.error(error);
  if (error?.code === "editing_conflict") {
    if (window.confirm("This item changed on another device. Refresh the latest version now? Your unsaved change was not applied.")) load().catch(console.error);
    return;
  }
  window.alert(error.message || "Request failed");
}

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  showError(event.reason);
});

if (await connection()) load().catch(showError);
else connectionView(root, () => load().catch(showError));
