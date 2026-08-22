import assert from "node:assert/strict";
import test from "node:test";
import { duplicateLinks, languageFilterSuggestions, matchesSearchFilters, parseSearchQuery } from "../extension/filters.js";
import { appendQuickFilterBookmarks, QUICK_FILTER_BOOKMARKS, syncQuickFilterHealth } from "./quick-filter-seed.js";

function search(items, query) {
  const { text, filters } = parseSearchQuery(query);
  const duplicates = duplicateLinks(items);
  const needle = text.toLocaleLowerCase();
  return items.filter((item) => {
    if (!matchesSearchFilters(item, filters, duplicates)) return false;
    if (!needle) return true;
    return [item.title, item.description, item.link, item.note, ...(item.tags || []), ...(item.highlights || []).map((value) => value.text)].join(" ").toLocaleLowerCase().includes(needle);
  });
}

test("quick-filter seed covers legacy filters and appends idempotently", async () => {
  assert.equal(QUICK_FILTER_BOOKMARKS.length, 30);
  assert.equal(new Set(QUICK_FILTER_BOOKMARKS.map((item) => item.id)).size, 30);
  assert.deepEqual(new Set(QUICK_FILTER_BOOKMARKS.map((item) => item.type)), new Set(["link", "article", "image", "video", "audio", "document"]));
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.favorite).length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.note).length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.highlights.length).length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.reminder).length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.health.status === "broken").length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => item.health.status === "unknown").length, 6);
  assert.equal(QUICK_FILTER_BOOKMARKS.filter((item) => !item.tags.length).length, 2);
  assert.ok(QUICK_FILTER_BOOKMARKS.some((item) => item.tags.length >= 3));
  assert.ok(QUICK_FILTER_BOOKMARKS.every((item) => item.createdAt.startsWith("20")));

  const records = new Map([["existing", { id: "existing", title: "keep this bookmark" }]]);
  const calls = [];
  const api = async (path, init = {}) => {
    calls.push({ path, init });
    if (path === "/v1/bookmarks") return [...records.values()];
    if (path === "/v1/import") {
      for (const item of JSON.parse(init.body).items) records.set(item.id, { ...item, revision: 1 });
      return { count: JSON.parse(init.body).items.length };
    }
    if (path === "/v1/sync/push") {
      const changes = JSON.parse(init.body).changes;
      for (const change of changes) records.set(change.record.id, change.record);
      return { applied: changes.map((change) => ({ entity: change.entity, record: change.record })), conflicts: [] };
    }
    throw new Error(`Unexpected API path: ${path}`);
  };

  assert.deepEqual(await appendQuickFilterBookmarks(api), { added: 30, skipped: 0 });
  assert.deepEqual(await appendQuickFilterBookmarks(api), { added: 0, skipped: 30 });
  assert.equal(records.size, 31);
  assert.equal(calls.filter(({ path }) => path === "/v1/import").length, 1);
  assert.equal(records.get("existing").title, "keep this bookmark");

  assert.deepEqual(await syncQuickFilterHealth(api), { updated: 30, skipped: 0 });
  assert.equal(records.get(QUICK_FILTER_BOOKMARKS[3].id).health.status, "broken");

  const items = QUICK_FILTER_BOOKMARKS;
  for (const type of ["link", "article", "image", "video", "audio", "document"]) assert.equal(search(items, `type:${type}`).length, 5);
  assert.equal(search(items, "important:true").length, 6);
  assert.equal(search(items, "note:true").length, 6);
  assert.equal(search(items, "highlights:true").length, 6);
  assert.equal(search(items, "reminder:true").length, 6);
  assert.equal(search(items, "broken:true").length, 6);
  assert.equal(search(items, "notag:true").length, 2);
  assert.equal(search(items, "duplicate:true").length, 4);
  assert.equal(search(items, "#highlight").length, 6);
  assert.equal(search(items, "lang:zh").length, 8);
  assert.equal(search(items, "created:2026-08").length, 5);
  assert.equal(search(items, "created:<2026-01-01").length, 20);

  assert.deepEqual(search(items, "TitleKeyword").map((item) => item.id), [QUICK_FILTER_BOOKMARKS[10].id]);
  assert.deepEqual(search(items, "DescriptionKeyword").map((item) => item.id), [QUICK_FILTER_BOOKMARKS[11].id]);
  assert.deepEqual(search(items, "UrlKeyword").map((item) => item.id), [QUICK_FILTER_BOOKMARKS[12].id]);
  assert.deepEqual(search(items, "type:document important:true info:release -#archive").map((item) => item.id), [QUICK_FILTER_BOOKMARKS[25].id]);
  assert.deepEqual(search(items, "type:article note:true -#archive").map((item) => item.id), [QUICK_FILTER_BOOKMARKS[6].id]);
  assert.deepEqual(languageFilterSuggestions(items).map(({ value }) => value).sort(), ["de", "en", "es", "fr", "ja", "ko", "pt", "zh"]);
});
