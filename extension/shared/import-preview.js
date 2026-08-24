import { canonicalImportLink, parseImportText } from "../import.js";

function parseJson(source) {
  let value;
  try { value = JSON.parse(source); } catch { throw new TypeError("JSON 文件无效"); }
  const items = Array.isArray(value) ? value : Array.isArray(value?.bookmarks) ? value.bookmarks : null;
  if (!items) throw new TypeError("JSON 文件不包含书签");
  const collections = Array.isArray(value?.collections) ? value.collections : [];
  const collectionById = new Map(collections.map((item) => [item.id, item]));
  const collectionPath = (id) => {
    const path = [], visited = new Set();
    while (id && !visited.has(id)) {
      visited.add(id);
      const collection = collectionById.get(id);
      if (!collection) break;
      path.unshift(collection.name);
      id = collection.parentId;
    }
    return path;
  };
  const invalid = [];
  const valid = items.flatMap((item, index) => {
    try { return [{ ...item, link: canonicalImportLink(item?.link || item?.url), collectionPath: collectionPath(item?.collectionId) }]; }
    catch { invalid.push({ index, reason: "invalid-url", value: item?.link || item?.url || "" }); return []; }
  });
  return { format: "json", items: valid, invalid, collections };
}

export function previewImport(source, metadata = {}, existingLinks = []) {
  const json = /\.json$/i.test(metadata.name || "") || metadata.type === "application/json";
  const parsed = json ? parseJson(source) : parseImportText(source, metadata);
  const existing = new Set(existingLinks.map((value) => { try { return canonicalImportLink(value); } catch { return String(value || ""); } }));
  const seen = new Set();
  const items = [], candidates = [];
  let duplicates = 0, media = 0, favorites = 0;
  for (const sourceItem of parsed.items || []) {
    let link;
    try { link = canonicalImportLink(sourceItem.link); } catch { continue; }
    const item = { ...sourceItem, link, id: crypto.randomUUID() };
    candidates.push(item);
    if (item.favorite) favorites += 1;
    media += Array.isArray(item.media) ? item.media.length : 0;
    media += Array.isArray(item.resources) ? item.resources.length : 0;
    if (existing.has(link) || seen.has(link)) { duplicates += 1; continue; }
    seen.add(link); items.push(item);
  }
  return { format: parsed.format, records: candidates.length, items, candidates, duplicates, invalid: parsed.invalid || [], media, favorites };
}
