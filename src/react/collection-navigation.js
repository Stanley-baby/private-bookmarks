function compareCollections(left, right) {
  return (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id);
}

export function flattenCollections(collections, collapsed = new Set()) {
  const children = new Map();
  for (const collection of collections) {
    const parentId = collection.parentId || null;
    const values = children.get(parentId) || [];
    values.push(collection);
    children.set(parentId, values);
  }
  for (const values of children.values()) values.sort(compareCollections);
  const result = [];
  const visited = new Set();
  const hideDescendants = (parentId) => {
    for (const child of children.get(parentId) || []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      hideDescendants(child.id);
    }
  };
  const visit = (parentId, depth) => {
    for (const collection of children.get(parentId) || []) {
      if (visited.has(collection.id)) continue;
      visited.add(collection.id);
      result.push({ collection, depth });
      if (collapsed.has(collection.id)) hideDescendants(collection.id);
      else visit(collection.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const collection of [...collections].sort(compareCollections)) {
    if (!visited.has(collection.id)) {
      visited.add(collection.id);
      result.push({ collection, depth: 0 });
      if (collapsed.has(collection.id)) hideDescendants(collection.id);
      else visit(collection.id, 1);
    }
  }
  return result;
}

export function descendantCollectionIds(collections, collectionId) {
  const ids = new Set([collectionId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const collection of collections) if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) {
      ids.add(collection.id);
      changed = true;
    }
  }
  return ids;
}

export function collectionPath(collections, collectionId) {
  if (collectionId === "unsorted") return "未分类";
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const names = [];
  const visited = new Set();
  for (let collection = byId.get(collectionId); collection && !visited.has(collection.id); collection = byId.get(collection.parentId)) {
    visited.add(collection.id);
    names.unshift(collection.name);
  }
  return names.join(" / ") || "未分类";
}
