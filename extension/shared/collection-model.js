const DEFAULT_GROUP = Object.freeze({ id: "default", title: "收藏", hidden: false });

function live(item) {
  return Boolean(item) && !item.deletedAt && !item.purgedAt && !item.permanentDeletedAt;
}

export function collectionSubtreeIds(collections = [], rootId) {
  const ids = new Set([rootId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of collections) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function validateCollectionChange(collections = [], input = {}, existing, { allowDeletedParent = false, allowUnsorted = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("收藏夹数据无效");
  const id = input.id || existing?.id || "";
  const name = String(input.name ?? existing?.name ?? "").trim().slice(0, 200);
  if (!name) throw new TypeError("收藏夹名称不能为空");
  const parentId = input.parentId === undefined ? existing?.parentId || null : String(input.parentId || "") || null;
  if (id === "unsorted") {
    if (existing && !allowUnsorted && (input.name !== undefined || input.parentId !== undefined || input.position !== undefined || input.icon !== undefined)) {
      throw new TypeError("未分类收藏夹不可修改");
    }
    if (input.parentId && input.parentId !== null) throw new TypeError("未分类收藏夹不可嵌套");
    return { id, name: existing?.name || name, parentId: null, position: 0 };
  }
  if (parentId === id) throw new TypeError("收藏夹不能包含自身");
  const parent = parentId ? collections.find((item) => item.id === parentId && (allowDeletedParent || live(item))) : null;
  if (parentId && !parent) throw new TypeError("父收藏夹不存在");
  if (parentId && id && collectionSubtreeIds(collections, id).has(parentId)) throw new TypeError("收藏夹不能移动到自己的子级");
  const rawPosition = input.position ?? existing?.position ?? 0;
  const position = Number(rawPosition);
  if (!Number.isFinite(position)) throw new TypeError("位置必须是数字");
  const icon = input.icon === undefined ? existing?.icon : normalizeIcon(input.icon);
  return { id, name, parentId, position, ...(icon ? { icon } : {}) };
}

export function positionBetween(collections = [], movingId, targetId, before = true, parentId) {
  const moving = collections.find((item) => item.id === movingId);
  const nextParentId = parentId === undefined ? moving?.parentId || null : parentId || null;
  const siblings = collections
    .filter((item) => live(item) && item.id !== movingId && (item.parentId || null) === nextParentId)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || String(left.name).localeCompare(String(right.name), "zh-CN") || String(left.id).localeCompare(String(right.id)));
  const targetIndex = targetId ? siblings.findIndex((item) => item.id === targetId) : -1;
  const insertAt = targetIndex < 0 ? siblings.length : targetIndex + (before ? 0 : 1);
  const previous = siblings[insertAt - 1]?.position;
  const next = siblings[insertAt]?.position;
  return previous == null ? (next ?? 0) - 1 : next == null ? previous + 1 : (previous + next) / 2;
}

export function emptyCollectionRoots(collections = [], bookmarks = []) {
  const liveCollections = collections.filter(live);
  const hasBookmarks = (id) => bookmarks.some((item) => live(item) && item.collectionId === id);
  function hasBookmarksInSubtree(id) {
    return hasBookmarks(id) || liveCollections.filter((item) => item.parentId === id).some((child) => hasBookmarksInSubtree(child.id));
  }
  const emptyIds = new Set(liveCollections.filter((item) => item.id !== "unsorted" && !hasBookmarksInSubtree(item.id)).map((item) => item.id));
  return liveCollections.filter((item) => emptyIds.has(item.id) && !emptyIds.has(item.parentId));
}

export function mergeCollectionRecords(collections = [], bookmarks = [], sourceIds = [], targetId, now = new Date().toISOString()) {
  const ids = [...new Set(sourceIds)];
  if (ids.length < 2 || !targetId || !ids.includes(targetId)) throw new TypeError("至少选择两个收藏夹并指定合并目标");
  const selected = ids.map((id) => collections.find((item) => item.id === id));
  if (selected.some((item) => !live(item)) || selected.some((item) => item.id === "unsorted")) throw new TypeError("只能合并有效收藏夹");
  if (new Set(selected.map((item) => item.parentId || null)).size !== 1) throw new TypeError("只能合并同一层级的收藏夹");
  const selectedIds = new Set(ids);
  if (selected.some((item) => selected.some((other) => other.id !== item.id && collectionSubtreeIds(collections, item.id).has(other.id)))) {
    throw new TypeError("不能合并存在上下级关系的收藏夹");
  }
  const target = selected.find((item) => item.id === targetId);
  const collectionsNext = collections.map((item) => {
    if (item.id === targetId) return item;
    if (selectedIds.has(item.parentId)) return { ...item, parentId: targetId, updatedAt: now };
    if (selectedIds.has(item.id)) return { ...item, deletedAt: now, deletedByCollectionId: item.id, updatedAt: now, revision: Number(item.revision || 0) + 1 };
    return item;
  });
  const bookmarksNext = bookmarks.map((item) => live(item) && selectedIds.has(item.collectionId) && item.collectionId !== targetId
    ? { ...item, collectionId: targetId, updatedAt: now, revision: Number(item.revision || 0) + 1 }
    : item);
  return {
    target,
    collections: collectionsNext,
    bookmarks: bookmarksNext,
    movedBookmarks: bookmarks.filter((item) => selectedIds.has(item.collectionId) && item.collectionId !== targetId && live(item)).length,
    movedCollections: collections.filter((item) => selectedIds.has(item.parentId)).length,
    removedIds: ids.filter((id) => id !== targetId),
  };
}

export function collectionShareText(collection, bookmarks = []) {
  const items = bookmarks.filter((item) => live(item));
  return [String(collection.name) + "（" + items.length + "）", ...items.map((item) => String(item.title || item.link) + "\n" + item.link)].join("\n\n");
}

export function collectionGroups(preferences = {}) {
  const groups = Array.isArray(preferences.collectionGroups) ? preferences.collectionGroups : [];
  const seen = new Set();
  const normalized = groups.map((item) => {
    const id = String(item?.id || "").trim();
    const title = String(item?.title || "").trim().slice(0, 100);
    if (!id || !title || seen.has(id)) return null;
    seen.add(id);
    return { id, title, hidden: item.hidden === true };
  }).filter(Boolean);
  return normalized.length ? normalized : [{ ...DEFAULT_GROUP }];
}

export function collectionGroupAssignments(preferences = {}) {
  return preferences.collectionGroupByCollectionId && typeof preferences.collectionGroupByCollectionId === "object"
    ? { ...preferences.collectionGroupByCollectionId }
    : {};
}

function normalizeIcon(value) {
  const icon = String(value || "").trim().slice(0, 2_000);
  if (!icon) return "";
  if (/^https?:\/\//i.test(icon)) return icon;
  if (/^data:image\/(?:jpeg|png|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i.test(icon)) return icon;
  if (!/[\s<>]/.test(icon) && icon.length <= 16) return icon;
  throw new TypeError("收藏夹图标无效");
}
