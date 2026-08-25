import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalImportLink,
  detectImportFormat,
  parseCsv,
  parseEnex,
  parseHtmlBookmarks,
  parseImportText,
  parseTxt,
} from "../extension/import.js";

test("canonicalImportLink keeps HTTP(S) links stable for duplicate checks", () => {
  assert.equal(
    canonicalImportLink("https://user:pass@example.com/articles///?z=2&utm_source=newsletter&a=1#:~:text=clip"),
    "https://example.com/articles?a=1&z=2",
  );
  assert.throws(() => canonicalImportLink("ftp://example.com/file"));
});

test("CSV import handles quoted commas, aliases, and invalid URLs", () => {
  const result = parseImportText([
    "URL,NAME,TAGS,Description,NOTE,STARRED,FOLDER",
    '"https://example.com/article?utm_campaign=spring&b=2","A, title","one, two",A description,A note,true,"Reading / Work"',
    "not-a-url,Bad,,,,false,",
  ].join("\n"), { name: "bookmarks.csv" });

  assert.equal(result.format, "csv");
  assert.deepEqual(result.items, [{
    link: "https://example.com/article?b=2",
    title: "A, title",
    tags: ["one", "two"],
    note: "A note",
    description: "A description",
    favorite: true,
    collectionPath: ["Reading", "Work"],
  }]);
  assert.deepEqual(result.invalid, [{ index: 2, reason: "invalid-url", value: "not-a-url" }]);
});

test("Netscape HTML import preserves nested folder paths and descriptions", () => {
  const html = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<DL><p>",
    '  <DT><H3>Reading &amp; Work</H3>',
    "  <DL><p>",
    '    <DT><A HREF="https://example.com/one">One &amp; only</A><DD>First description',
    '    <DT><H3>Nested</H3><DL><p>',
    '      <DT><A HREF="https://example.com/two" TAGS="deep, saved">Two</A>',
    "    </DL>",
    "  </DL>",
    "</DL>",
  ].join("\n");

  const result = parseHtmlBookmarks(html);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.items.map(({ link, title, tags, description, collectionPath }) => ({ link, title, tags, description, collectionPath })), [
    {
      link: "https://example.com/one",
      title: "One & only",
      tags: [],
      description: "First description",
      collectionPath: ["Reading & Work"],
    },
    {
      link: "https://example.com/two",
      title: "Two",
      tags: ["deep", "saved"],
      description: "",
      collectionPath: ["Reading & Work", "Nested"],
    },
  ]);
});

test("ENEX import maps source URLs, note text, tags, and creation dates", () => {
  const enex = [
    '<en-export export-date="20260808T100000Z">',
    "<note><title>First &amp; note</title>",
    "<content><![CDATA[<?xml version=\"1.0\"?><en-note>Read <a href=\"https://example.com/fallback\">link</a><br/>body</en-note>]]></content>",
    "<created>20240809T123456Z</created><tag>one</tag><tag>two</tag>",
    "<note-attributes><source-url>https://example.com/source?utm_source=evernote</source-url></note-attributes></note>",
    "<note><title>Fallback</title><content><![CDATA[<en-note>See <a href=\"https://example.com/fallback\">this page</a></en-note>]]></content><created>20240101T000000Z</created></note>",
    "<note><title>No URL</title><content><![CDATA[<en-note>Just a note</en-note>]]></content></note>",
    "</en-export>",
  ].join("");

  const result = parseEnex(enex);
  assert.deepEqual(result.items.map(({ link, title, tags, description, createdAt }) => ({ link, title, tags, description, createdAt })), [
    { link: "https://example.com/source", title: "First & note", tags: ["one", "two"], description: "Read link\nbody", createdAt: "2024-08-09T12:34:56.000Z" },
    { link: "https://example.com/fallback", title: "Fallback", tags: [], description: "See this page", createdAt: "2024-01-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(result.invalid, [{ index: 2, reason: "missing-url", value: "No URL" }]);
  assert.equal(parseImportText(enex, { name: "notes.enex" }).format, "enex");
  assert.equal(detectImportFormat(enex), "enex");
});

test("ENEX import preserves base64 resources and reports broken resources", () => {
  const enex = [
    "<en-export>",
    "<note><title>With files</title><content><![CDATA[<en-note>See it</en-note>]]></content>",
    "<created>20240101T000000Z</created><source-url>https://example.com/files</source-url>",
    '<resource><data encoding="base64">aGVsbG8=</data><mime>text/plain</mime><resource-attributes><file-name>说明.txt</file-name></resource-attributes></resource>',
    "<resource><mime>application/pdf</mime></resource></note>",
    "</en-export>",
  ].join("");

  const result = parseEnex(enex);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].resources, [
    { mime: "text/plain", name: "说明.txt", data: "aGVsbG8=" },
    { mime: "application/pdf", name: "", data: "", error: "附件缺少数据" },
  ]);
});

test("TXT import ignores blank/comment lines and reports invalid URLs", () => {
  const result = parseTxt("\uFEFF# exported\n\nhttps://example.com/one///\n// comment\nmailto:user@example.com\n");
  assert.deepEqual(result.items.map((item) => item.link), ["https://example.com/one"]);
  assert.deepEqual(result.invalid, [{ index: 4, reason: "invalid-url", value: "mailto:user@example.com" }]);
});

test("format detection uses metadata and content, while JSON remains separate", () => {
  assert.equal(detectImportFormat("url,title\nhttps://example.com,Example"), "csv");
  assert.equal(detectImportFormat("<DL><p><A HREF=\"https://example.com\">Example</A>"), "html");
  assert.equal(detectImportFormat("{}", { name: "private-bookmarks.json" }), "json");
  assert.throws(() => parseImportText("{}", { name: "private-bookmarks.json" }), /JSON/);
});
