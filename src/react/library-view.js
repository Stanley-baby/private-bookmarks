import { duplicateLinks, matchesSearchFilters, parseSearchQuery } from "../../extension/filters.js";

const SEARCH_SYNTAX = ["important:true", "note:true", "highlights:true", "notag:true", "reminder:true", "broken:true", "duplicate:true", "type:", "lang:", "created:", "#"];
const SORTS = new Set(["manual", "created", "-created", "title", "-title", "domain", "-domain"]);

export function filterBookmarks(items, { query = "", tag = "", scope = null } = {}) {
  const parsed = parseSearchQuery(query);
  const needle = parsed.text.trim().toLocaleLowerCase();
  const duplicates = duplicateLinks(items);
  return items.filter((item) => {
    if (scope && !scope.has(item.collectionId)) return false;
    if (tag && !(tag === "__notes__" ? item.note : tag === "__untagged__" ? !item.tags?.length : item.tags?.includes(tag))) return false;
    const text = [item.title, item.link, item.description, item.note, item.tags?.join(" ")].join(" ").toLocaleLowerCase();
    return (!needle || text.includes(needle)) && matchesSearchFilters(item, parsed.filters, duplicates);
  });
}

export function searchSuggestions(query, history = []) {
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return history.slice(0, 5);
  return [...new Set([...history, ...SEARCH_SYNTAX].filter((item) => item.toLocaleLowerCase().startsWith(needle)))].slice(0, 8);
}

export function sortBookmarks(items, sort = "manual", manualOrder = []) {
  if (!SORTS.has(sort)) sort = "manual";
  if (sort === "manual") {
    const positions = new Map(manualOrder.map((id, index) => [id, index]));
    return [...items].sort((left, right) => (positions.get(left.id) ?? Infinity) - (positions.get(right.id) ?? Infinity));
  }
  const descending = sort.startsWith("-");
  const field = descending ? sort.slice(1) : sort;
  const value = (item) => field === "created" ? item.createdAt || "" : field === "domain" ? (() => { try { return new URL(item.link).hostname; } catch { return item.link || ""; } })() : item.title || item.link || "";
  return [...items].sort((left, right) => String(value(left)).localeCompare(String(value(right)), "zh-CN") * (descending ? -1 : 1));
}

export function reorderVisibleIds(allIds, visibleIds, id, offset) {
  const from = visibleIds.indexOf(id), to = from + offset;
  if (from < 0 || to < 0 || to >= visibleIds.length) return allIds;
  const reordered = [...visibleIds];
  reordered.splice(to, 0, reordered.splice(from, 1)[0]);
  let index = 0;
  const visible = new Set(visibleIds);
  return allIds.map((itemId) => visible.has(itemId) ? reordered[index++] : itemId);
}

export function visibleSelection(selectedIds, visibleItems) {
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  return selectedIds.filter((id) => visibleIds.has(id));
}
