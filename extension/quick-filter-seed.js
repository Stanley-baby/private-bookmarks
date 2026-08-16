const seedId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function healthFor(link, status) {
  return {
    status,
    checkedAt: status === "unknown" ? null : "2026-08-15T09:00:00.000Z",
    finalUrl: status === "broken" ? link : "",
  };
}

function highlight(index, text) {
  return { id: `quick-filter-highlight-${index}`, text, position: 0, color: "#ffe920", note: "fixture" };
}

function bookmark(index, fields) {
  const { created, health = "healthy", highlights = [], ...rest } = fields;
  return {
    id: seedId(index),
    collectionId: "unsorted",
    ...rest,
    highlights,
    health: healthFor(rest.link, health),
    createdAt: `${created}T09:00:00.000Z`,
  };
}

export const QUICK_FILTER_BOOKMARKS = Object.freeze([
  bookmark(1, { type: "link", language: "en", created: "2026-08-01", link: "https://filters.example.test/launch", title: "Launch checklist", description: "Launch plan", note: "launch note", tags: ["launch", "work", "later"], favorite: true }),
  bookmark(2, { type: "link", language: "zh", created: "2026-08-07", link: "https://filters.example.test/description-highlight", title: "Highlight guide", description: "Reading description", tags: ["reading", "highlight"], highlights: [highlight(2, "important reading")] }),
  bookmark(3, { type: "link", language: "en", created: "2026-08-08", link: "https://filters.example.test/reminder", title: "Reminder planner", description: "Calendar planning", tags: ["planning", "reminder"], reminder: "2026-09-01T09:00:00.000Z" }),
  bookmark(4, { type: "link", language: "ja", created: "2026-08-09", link: "https://filters.example.test/broken", title: "Broken endpoint", description: "Status example", tags: ["ops", "broken"], health: "broken" }),
  bookmark(5, { type: "link", language: "zh-CN", created: "2026-08-10", link: "https://filters.example.test/untagged", title: "Untagged reference", description: "Plain reference", tags: [], health: "unknown" }),

  bookmark(6, { type: "article", language: "en", created: "2026-07-01", link: "https://filters.example.test/launch", title: "Launch article duplicate", description: "Duplicate launch", tags: ["launch", "work", "archive"], favorite: true }),
  bookmark(7, { type: "article", language: "zh-Hans", created: "2026-07-08", link: "https://filters.example.test/article-notes", title: "Article notes", description: "Article details", note: "NoteKeyword review", tags: ["work", "notes", "later"] }),
  bookmark(8, { type: "article", language: "en", created: "2026-07-15", link: "https://filters.example.test/article-highlight", title: "Article highlight", description: "Highlight details", tags: ["reading", "highlight", "research"], highlights: [highlight(8, "article excerpt")] }),
  bookmark(9, { type: "article", language: "fr", created: "2026-07-20", link: "https://filters.example.test/article-reminder", title: "Article reminder", description: "Article calendar", tags: ["planning", "reminder"], reminder: "2026-09-09T09:00:00.000Z" }),
  bookmark(10, { type: "article", language: "de", created: "2026-06-30", link: "https://filters.example.test/broken-article", title: "Broken article", description: "Broken article", tags: ["ops", "broken", "archive"], health: "broken" }),

  bookmark(11, { type: "image", language: "en", created: "2025-12-01", link: "https://filters.example.test/shared-resource", title: "TitleKeyword image", description: "Image catalog", tags: ["design", "image"], favorite: true }),
  bookmark(12, { type: "image", language: "zh", created: "2025-12-15", link: "https://filters.example.test/image-gallery", title: "Image gallery", description: "DescriptionKeyword gallery", tags: ["design", "gallery"], health: "unknown" }),
  bookmark(13, { type: "image", language: "ko", created: "2025-11-20", link: "https://filters.example.test/UrlKeyword/image", title: "Image URL marker", description: "Image highlight", tags: ["research", "highlight"], highlights: [highlight(13, "image marker")] }),
  bookmark(14, { type: "image", language: "en", created: "2025-10-05", link: "https://filters.example.test/image-reminder", title: "Image reminder", description: "Image calendar", tags: ["design", "reminder"], reminder: "2026-10-14T09:00:00.000Z" }),
  bookmark(15, { type: "image", language: "es", created: "2025-09-01", link: "https://filters.example.test/broken-image", title: "Broken image", description: "Broken image", tags: [], health: "broken" }),

  bookmark(16, { type: "video", language: "en", created: "2024-08-01", link: "https://filters.example.test/video-notes", title: "Video notes", description: "Video description", note: "NoteKeyword video", tags: ["media", "video", "work"], favorite: true }),
  bookmark(17, { type: "video", language: "zh", created: "2024-07-10", link: "https://filters.example.test/video-pending", title: "Video pending", description: "Video pending", tags: ["media"], health: "unknown" }),
  bookmark(18, { type: "video", language: "ja", created: "2024-06-05", link: "https://filters.example.test/video-highlight", title: "Video highlight", description: "Video highlight", tags: ["media", "highlight", "research"], highlights: [highlight(18, "video excerpt")] }),
  bookmark(19, { type: "video", language: "en", created: "2024-05-01", link: "https://filters.example.test/video-reminder", title: "Video reminder", description: "Video calendar", tags: ["media", "reminder"], reminder: "2026-11-19T09:00:00.000Z" }),
  bookmark(20, { type: "video", language: "pt", created: "2024-04-30", link: "https://filters.example.test/broken-video", title: "Broken video", description: "Broken video", tags: ["media", "broken"], health: "broken" }),

  bookmark(21, { type: "audio", language: "zh", created: "2023-12-01", link: "https://filters.example.test/audio-notes", title: "Audio notes", description: "Audio description", note: "NoteKeyword audio", tags: ["media", "audio"], favorite: true }),
  bookmark(22, { type: "audio", language: "en", created: "2023-11-11", link: "https://filters.example.test/audio-pending", title: "Audio pending", description: "Audio pending", tags: ["audio"], health: "unknown" }),
  bookmark(23, { type: "audio", language: "fr", created: "2023-10-01", link: "https://filters.example.test/audio-highlight", title: "Audio highlight", description: "Audio highlight", tags: ["audio", "highlight"], highlights: [highlight(23, "audio excerpt")] }),
  bookmark(24, { type: "audio", language: "en", created: "2023-09-01", link: "https://filters.example.test/audio-reminder", title: "Audio reminder", description: "Audio calendar", tags: ["audio", "reminder"], reminder: "2026-12-24T09:00:00.000Z" }),
  bookmark(25, { type: "audio", language: "es", created: "2023-08-08", link: "https://filters.example.test/broken-audio", title: "Broken audio", description: "Broken audio", tags: ["audio", "broken"], health: "broken" }),

  bookmark(26, { type: "document", language: "en", created: "2022-12-31", link: "https://filters.example.test/shared-resource", title: "Release document", description: "ReleaseKeyword document", note: "Release note", tags: ["release", "document", "work"], favorite: true }),
  bookmark(27, { type: "document", language: "zh", created: "2022-08-01", link: "https://filters.example.test/document-pending", title: "Pending document", description: "Document pending", note: "NoteKeyword pending", tags: ["document"], health: "unknown" }),
  bookmark(28, { type: "document", language: "de", created: "2022-07-01", link: "https://filters.example.test/document-highlight", title: "Document highlight", description: "Document highlight", tags: ["document", "highlight"], highlights: [highlight(28, "document excerpt")] }),
  bookmark(29, { type: "document", language: "en", created: "2022-06-01", link: "https://filters.example.test/document-reminder", title: "Document reminder", description: "Document calendar", tags: ["document", "reminder"], reminder: "2027-01-29T09:00:00.000Z", health: "unknown" }),
  bookmark(30, { type: "document", language: "zh", created: "2022-05-01", link: "https://filters.example.test/broken-document", title: "Broken document", description: "Broken document", tags: ["document", "broken", "archive"], health: "broken" }),
]);

/** Append only missing fixture IDs through the existing /v1/import entry. */
export async function appendQuickFilterBookmarks(api, items = QUICK_FILTER_BOOKMARKS) {
  if (typeof api !== "function") throw new TypeError("An API function is required");
  const existing = await api("/v1/bookmarks");
  const existingIds = new Set((Array.isArray(existing) ? existing : []).map((item) => item?.id).filter(Boolean));
  const pending = items.filter((item) => !existingIds.has(item.id));
  if (pending.length) await api("/v1/import", { method: "POST", body: JSON.stringify({ items: pending }) });
  return { added: pending.length, skipped: items.length - pending.length };
}

/** Restore fixture-only health metadata when the connected Worker exposes sync. */
export async function syncQuickFilterHealth(api, items = QUICK_FILTER_BOOKMARKS) {
  if (typeof api !== "function") throw new TypeError("An API function is required");
  const current = await api("/v1/bookmarks");
  const byId = new Map((Array.isArray(current) ? current : []).map((item) => [item?.id, item]));
  const changes = items.map((item) => {
    const existing = byId.get(item.id);
    if (!existing) return null;
    const revision = Number(existing.revision) || 1;
    return {
      entity: "bookmark",
      baseRevision: revision,
      record: { ...existing, ...item, revision: revision + 1, updatedAt: new Date().toISOString() },
    };
  }).filter(Boolean);
  if (!changes.length) return { updated: 0, skipped: items.length };
  const result = await api("/v1/sync/push", { method: "POST", body: JSON.stringify({ changes }) });
  if (!Array.isArray(result?.applied) || result.applied.length !== changes.length) throw new Error("测试书签状态同步不完整");
  return { updated: changes.length, skipped: items.length - changes.length };
}

function testLink(index) {
  if ([4, 10, 15, 20, 25, 30].includes(index)) return `https://example.com/nonexistent-quick-filter-test?quick-filter=${index}`;
  if ([1, 6, 11, 26].includes(index)) return "https://example.com/?quick-filter=duplicate";
  if (index === 13) return "https://example.com/?quick-filter=13&UrlKeyword=1";
  return `https://example.com/?quick-filter=${index}`;
}

/** Give the remote link checker deterministic healthy/broken URLs. */
export async function prepareQuickFilterLinks(api, items = QUICK_FILTER_BOOKMARKS) {
  if (typeof api !== "function") throw new TypeError("An API function is required");
  const current = await api("/v1/bookmarks");
  const byId = new Map((Array.isArray(current) ? current : []).map((item) => [item?.id, item]));
  const updates = items.map((item) => {
    const existing = byId.get(item.id);
    const index = Number(item.id.match(/(\d{12})$/)?.[1]);
    const link = testLink(index);
    return existing && existing.link !== link ? { id: item.id, revision: Number(existing.revision) || 1, link } : null;
  }).filter(Boolean);
  for (const update of updates) await api(`/v1/bookmarks/${encodeURIComponent(update.id)}`, { method: "PATCH", body: JSON.stringify({ revision: update.revision, link: update.link }) });
  return { updated: updates.length, skipped: items.length - updates.length };
}
