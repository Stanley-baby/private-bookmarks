import assert from "node:assert/strict";
import test from "node:test";
import { currentPageDraft, saveFeedback } from "../src/react/surface-workflows.js";

test("popup opens the current page as an editable draft", () => {
  const metadata = { link: "https://example.com/article", title: "Article", tags: ["read"] };
  assert.deepEqual(currentPageDraft({ metadata }), metadata);
  assert.throws(() => currentPageDraft({ error: "只能保存 HTTP(S) 页面" }), /只能保存 HTTP\(S\) 页面/);
  assert.throws(() => currentPageDraft({}), /无法读取当前页面/);
});

test("surface save feedback distinguishes duplicate and offline saves", () => {
  const bookmark = { id: "new", link: "https://example.com/article" };
  assert.equal(saveFeedback(bookmark, []), "已保存。");
  assert.equal(saveFeedback(bookmark, [{ id: "old", link: bookmark.link }]), "已保存；已存在相同链接。");
  assert.equal(saveFeedback(bookmark, [{ id: "old", link: bookmark.link }], false), "已保存；已存在相同链接。当前离线，将在联网后同步。");
});
