import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../extension/markdown.js";

test("renderMarkdown formats common syntax without allowing raw HTML or unsafe links", () => {
  const html = renderMarkdown("# 标题\n- **粗体**\n- `code`\n> 引用\n[安全](https://example.com)\n[危险](javascript:alert(1))\n<script>");
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<ul><li><strong>粗体<\/strong><\/li><li><code>code<\/code><\/li><\/ul>/);
  assert.match(html, /<blockquote>引用<\/blockquote>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});
