import assert from "node:assert/strict";
import test from "node:test";
import { bookmarkType, duplicateLinks, matchesSearchFilters, parseSearchQuery } from "../extension/filters.js";

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
