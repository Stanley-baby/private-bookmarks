import assert from "node:assert/strict";
import test from "node:test";
import { bookmarkType, dateFilterSuggestions, duplicateLinks, languageFilterSuggestions, matchesSearchFilters, parseSearchQuery } from "../extension/filters.js";

const bookmark = (changes = {}) => ({
  link: "https://example.com/article",
  title: "Example",
  description: "",
  note: "",
  tags: [],
  highlights: [],
  favorite: false,
  reminder: "",
  health: { status: "unknown" },
  ...changes,
});

test("quick filter search conditions compose and support exclusion", () => {
  const parsed = parseSearchQuery("reading note:true -#later type:document");
  assert.equal(parsed.text, "reading");
  assert.deepEqual(parsed.filters, [
    { kind: "note", value: "true", excluded: false },
    { kind: "tag", value: "later", excluded: true },
    { kind: "type", value: "document", excluded: false },
  ]);

  assert.equal(matchesSearchFilters(bookmark({ link: "https://example.com/guide.pdf", note: "Read", tags: ["work"] }), parsed.filters, new Set()), true);
  assert.equal(matchesSearchFilters(bookmark({ link: "https://example.com/guide.pdf", note: "Read", tags: ["later"] }), parsed.filters, new Set()), false);
});

test("duplicate and metadata filters match bookmark state", () => {
  const first = bookmark({ link: "https://example.com/same", reminder: "2026-08-08T09:00:00.000Z" });
  const links = duplicateLinks([first, bookmark({ link: first.link }), bookmark()]);
  assert.deepEqual([...links], [first.link]);
  assert.equal(matchesSearchFilters(first, parseSearchQuery("duplicate:true reminder:true").filters, links), true);
  assert.equal(matchesSearchFilters(first, parseSearchQuery("broken:true").filters, links), false);
});

test("bookmark type uses explicit metadata then safe file extensions", () => {
  assert.equal(bookmarkType(bookmark({ type: "article", link: "https://example.com/file.pdf" })), "article");
  assert.equal(bookmarkType(bookmark({ link: "https://example.com/photo.webp?size=2" })), "image");
  assert.equal(bookmarkType(bookmark({ link: "https://example.com/report.pdf" })), "document");
  assert.equal(bookmarkType(bookmark()), "link");
});

test("language and creation date filters match reference search syntax", () => {
  const item = bookmark({ language: "zh", createdAt: "2026-08-07T09:00:00.000Z" });
  assert.equal(matchesSearchFilters(item, parseSearchQuery("lang:zh created:2026-08").filters), true);
  assert.equal(matchesSearchFilters(item, parseSearchQuery("lang:en").filters), false);
  assert.equal(matchesSearchFilters(item, parseSearchQuery("created:<2026-08-08").filters), true);
  assert.equal(matchesSearchFilters(item, parseSearchQuery("created:>2026-08-08").filters), false);
  assert.equal(matchesSearchFilters(item, parseSearchQuery("created:>2026").filters), false);
  assert.equal(matchesSearchFilters(item, parseSearchQuery("created:<2027").filters), true);
});

test("date and language suggestions are derived from bookmark metadata", () => {
  const items = [
    bookmark({ language: "zh", createdAt: "2026-08-07T09:00:00.000Z" }),
    bookmark({ language: "zh-CN", createdAt: "2026-07-01T09:00:00.000Z" }),
    bookmark({ language: "en", createdAt: "2025-12-01T09:00:00.000Z" }),
  ];
  assert.deepEqual(dateFilterSuggestions(items), [{ value: "2026-08", count: 1 }, { value: "2026-07", count: 1 }, { value: "2025-12", count: 1 }]);
  assert.deepEqual(dateFilterSuggestions(items, "2026"), [{ value: "2026-08", count: 1 }, { value: "2026-07", count: 1 }]);
  assert.deepEqual(languageFilterSuggestions(items), [{ value: "zh", count: 2 }, { value: "en", count: 1 }]);
});
