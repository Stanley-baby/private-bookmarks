const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with",
  "com", "http", "https", "www", "html", "page", "www",
]);

const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;

function tokens(values) {
  const text = values.filter(Boolean).join(" ").toLocaleLowerCase();
  const segments = segmenter
    ? [...segmenter.segment(text)].filter((item) => item.isWordLike).map((item) => item.segment)
    : text.match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(segments.map((item) => item.trim()).filter((item) => item.length > 1 && !STOP_WORDS.has(item)))];
}

function bookmarkTokens(item) {
  return tokens([item.title, item.description, item.link, ...(Array.isArray(item.tags) ? item.tags : [])]);
}

function score(query, candidate) {
  const words = new Set(candidate);
  return query.reduce((total, token) => total + (words.has(token) ? token.length > 2 ? 2 : 1 : 0), 0);
}

function contextItem(item, relevance) {
  return {
    relevance,
    title: item.title || "",
    description: item.description || "",
    link: item.link || "",
    collectionId: item.collectionId || "unsorted",
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 12) : [],
  };
}

export function recommendBookmark(input = {}, bookmarks = [], collections = []) {
  const query = tokens([input.title, input.description, input.link, ...(Array.isArray(input.tags) ? input.tags : [])]);
  const currentTags = new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => String(tag).toLocaleLowerCase()));
  if (!query.length) return { collectionId: null, tags: [], matches: [] };

  const collectionScores = new Map();
  const tagScores = new Map();
  const matches = bookmarks.map((item) => {
    const relevance = score(query, bookmarkTokens(item));
    return relevance ? { item, relevance } : null;
  }).filter(Boolean).sort((a, b) => b.relevance - a.relevance);

  for (const { item, relevance } of matches) {
    if (item.collectionId && item.collectionId !== "unsorted") collectionScores.set(item.collectionId, (collectionScores.get(item.collectionId) || 0) + relevance);
    for (const tag of Array.isArray(item.tags) ? item.tags : []) {
      const display = String(tag).trim();
      const key = display.toLocaleLowerCase();
      if (display && !currentTags.has(key)) {
        const entry = tagScores.get(key) || { name: display, score: 0 };
        entry.score += relevance;
        tagScores.set(key, entry);
      }
    }
  }

  const collectionId = [...collectionScores.entries()]
    .sort(([idA, scoreA], [idB, scoreB]) => scoreB - scoreA || idA.localeCompare(idB))[0]?.[0] || null;
  const validCollection = collectionId && collections.some((item) => item.id === collectionId) ? collectionId : null;
  const tags = [...tagScores.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 5)
    .map((item) => item.name);

  return {
    collectionId: validCollection,
    tags,
    matches: matches.slice(0, 24).map(({ item, relevance }) => contextItem(item, relevance)),
  };
}
