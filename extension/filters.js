const TYPES = new Set(["link", "article", "image", "video", "audio", "document"]);
const EXTENSIONS = {
  image: new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]),
  video: new Set(["m4v", "mkv", "mov", "mp4", "webm"]),
  audio: new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]),
  document: new Set(["csv", "doc", "docx", "epub", "md", "ods", "odt", "pdf", "ppt", "pptx", "txt", "xls", "xlsx"]),
};

export function bookmarkType(item) {
  if (TYPES.has(item?.type)) return item.type;
  let extension = "";
  try { extension = new URL(item?.link).pathname.split(".").pop().toLocaleLowerCase(); } catch { /* invalid links are rejected on write */ }
  return Object.entries(EXTENSIONS).find(([, extensions]) => extensions.has(extension))?.[0] || "link";
}

export function duplicateLinks(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.link, (counts.get(item.link) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([link]) => link));
}

export function parseSearchQuery(query) {
  const filters = [];
  const text = [];
  for (const raw of String(query || "").trim().match(/"[^"]*"|\S+/g) || []) {
    const excluded = raw.startsWith("-");
    const token = excluded ? raw.slice(1) : raw;
    if (token.startsWith("#")) {
      filters.push({ kind: "tag", value: token.slice(1).toLocaleLowerCase(), excluded });
      continue;
    }
    const match = token.match(/^(important|note|highlights|notag|reminder|broken|duplicate|type|created|info|url|link):(.*)$/i);
    if (!match) {
      text.push(raw.replace(/^"|"$/g, ""));
      continue;
    }
    filters.push({ kind: match[1].toLocaleLowerCase() === "link" ? "url" : match[1].toLocaleLowerCase(), value: match[2].replace(/^"|"$/g, ""), excluded });
  }
  return { text: text.join(" "), filters };
}

export function matchesSearchFilters(item, filters, duplicates = new Set()) {
  const lower = (value) => String(value || "").toLocaleLowerCase();
  const matches = ({ kind, value }) => {
    const expected = lower(value);
    if (kind === "important") return Boolean(item.favorite);
    if (kind === "note") return expected && expected !== "true" ? lower(item.note).includes(expected) : Boolean(item.note);
    if (kind === "highlights") return Boolean(item.highlights?.length);
    if (kind === "notag") return !item.tags?.length;
    if (kind === "reminder") return Boolean(item.reminder);
    if (kind === "broken") return item.health?.status === "broken";
    if (kind === "duplicate") return duplicates.has(item.link);
    if (kind === "type") return !expected || bookmarkType(item) === expected;
    if (kind === "created") return Boolean(item.createdAt) && (!expected || lower(item.createdAt).includes(expected));
    if (kind === "info") return lower(`${item.title || ""} ${item.description || ""}`).includes(expected);
    if (kind === "url") return lower(item.link).includes(expected);
    if (kind === "tag") return expected ? item.tags?.some((tag) => lower(tag) === expected) : Boolean(item.tags?.length);
    return true;
  };
  return filters.every((filter) => filter.excluded ? !matches(filter) : matches(filter));
}
