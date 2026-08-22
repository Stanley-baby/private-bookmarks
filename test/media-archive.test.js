import assert from "node:assert/strict";
import test from "node:test";
import { collectUploadReferences, contentDispositionFilename, mediaArchiveEntries, parseDataUrl } from "../extension/shared/media-archive.js";

const mediaId = "123e4567-e89b-12d3-a456-426614174000";

test("parses base64 and percent-encoded data URLs", () => {
  assert.deepEqual([...parseDataUrl("data:image/png;base64,AQID").bytes], [1, 2, 3]);
  assert.equal(parseDataUrl("data:image/png;base64,AQID").contentType, "image/png");
  assert.deepEqual([...parseDataUrl("data:text/plain,hello%20world").bytes], [...new TextEncoder().encode("hello world")]);
});

test("collects upload URLs once and ignores external links and screenshots", () => {
  const backup = {
    bookmarks: [
      { cover: `https://private.example/v1/media/${mediaId}?token=one`, media: [`/v1/media/${mediaId}?token=two`, "https://example.com/photo.png", "<screenshot>"] },
      { cover: "<screenshot>", media: [{ link: "<screenshot>" }, `https://private.example/v1/media/${mediaId}`] },
    ],
  };
  assert.deepEqual(collectUploadReferences(backup).map(({ id }) => id), [mediaId]);
});

test("creates media entries, uses content-disposition names, MIME fallbacks, and uploads metadata", async () => {
  const data = "data:image/png;base64,AQID";
  const secondId = "223e4567-e89b-12d3-a456-426614174000";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const headers = { "content-type": "image/jpeg" };
    if (calls.length === 1) headers["content-disposition"] = "attachment; filename*=UTF-8''%E8%AF%B4%E6%98%8E.jpg";
    return new Response(new Uint8Array([4, 5]), { headers });
  };
  const backup = { bookmarks: [
    { id: "one", cover: data, media: [`https://private.example/v1/media/${mediaId}`] },
    { id: "two", media: [`https://private.example/v1/media/${secondId}`] },
  ] };
  const entries = await mediaArchiveEntries(backup, { fetchImpl });
  assert.deepEqual(calls, [`https://private.example/v1/media/${mediaId}`, `https://private.example/v1/media/${secondId}`]);
  assert.deepEqual([...entries[0].bytes], [1, 2, 3]);
  assert.equal(entries[1].name, "uploads/说明.jpg");
  assert.equal(entries[2].name, `uploads/${secondId}.jpg`);
  const metadata = JSON.parse(new TextDecoder().decode(entries.at(-1).bytes));
  assert.equal(entries.at(-1).name, "uploads.json");
  assert.equal(metadata.uploads.length, 3);
  assert.equal(metadata.uploads[1].contentType, "image/jpeg");
});

test("prefers extended content-disposition filenames and safely falls back", () => {
  assert.equal(contentDispositionFilename("attachment; filename=plain.txt"), "plain.txt");
  assert.equal(contentDispositionFilename("attachment; filename*=UTF-8''%E8%AF%B4%E6%98%8E.txt"), "说明.txt");
  assert.equal(contentDispositionFilename("attachment; filename=../secret.txt"), "secret.txt");
});
