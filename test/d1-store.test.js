import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { D1Store } from "../src/d1-store.js";

class Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values);
  }

  async run() {
    if (/^\s*SELECT\b/i.test(this.sql)) return { results: this.database.prepare(this.sql).all(), meta: { changes: 0 } };
    return { meta: { changes: this.database.prepare(this.sql).run(...this.values).changes } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
}

class D1TestDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const file of ["0001_initial.sql", "0002_trash_source.sql", "0003_collection_trash_source.sql", "0004_reminder.sql", "0005_bookmark_type.sql", "0006_bookmark_language.sql", "0007_backups.sql", "0008_cloud_connections.sql", "0009_sync.sql", "0010_permanent_tombstones.sql"]) this.database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  prepare(sql) {
    return new Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

test("D1 migrations preserve trash sources and restore needed collection paths", async () => {
  const store = new D1Store(new D1TestDatabase());
  const parent = await store.createCollection({ name: "Parent" });
  const child = await store.createCollection({ name: "Child", parentId: parent.id });
  const bookmark = await store.createBookmark({ link: "https://example.com/path", title: "Path", description: "", note: "", cover: "", media: [], collectionId: child.id, tags: [], highlights: [], favorite: false });

  await store.trashCollection(parent.id, parent.revision);
  const trashedBookmark = await store.getBookmark(bookmark.id);
  const restored = await store.restoreBookmark(bookmark.id, trashedBookmark.revision);
  assert.equal(restored.bookmark.deletedAt, null);
  assert.equal((await store.getCollection(parent.id)).deletedAt, null);
  assert.equal((await store.getCollection(child.id)).deletedAt, null);

  const secondParent = await store.createCollection({ name: "Second parent" });
  const secondChild = await store.createCollection({ name: "Second child", parentId: secondParent.id });
  const individuallyDeleted = await store.createBookmark({ link: "https://example.com/keep-trash", title: "Keep trash", description: "", note: "", cover: "", media: [], collectionId: secondChild.id, tags: [], highlights: [], favorite: false });
  const restoredWithCollection = await store.createBookmark({ link: "https://example.com/restore", title: "Restore", description: "", note: "", cover: "", media: [], collectionId: secondChild.id, tags: [], highlights: [], favorite: false });
  await store.trashBookmark(individuallyDeleted.id, individuallyDeleted.revision);
  await store.trashCollection(secondParent.id, secondParent.revision);
  await store.restoreCollection(secondParent.id, (await store.getCollection(secondParent.id)).revision);
  assert.notEqual((await store.getBookmark(individuallyDeleted.id)).deletedAt, null);
  assert.equal((await store.getBookmark(restoredWithCollection.id)).deletedAt, null);
});

test("D1 stores cloud backup metadata and supports retention queries", async () => {
  const store = new D1Store(new D1TestDatabase());
  const created = await store.createBackup({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "automatic",
    includeMedia: true,
    libraryBytes: 42,
    librarySha256: "library",
    manifestSha256: "manifest",
    createdAt: "2026-08-08T03:00:00.000Z",
  });
  assert.equal(created.includeMedia, true);
  assert.equal(created.libraryBytes, 42);
  assert.deepEqual((await store.listBackups({ kind: "automatic" })).map((item) => item.id), [created.id]);
  assert.equal(await store.deleteBackup(created.id), true);
  assert.equal(await store.getBackup(created.id), null);
});

test("D1 stores encrypted cloud connection metadata without exposing plaintext fields", async () => {
  const store = new D1Store(new D1TestDatabase());
  await store.saveCloudConnection({ provider: "dropbox", accessToken: "cipher-access", refreshToken: "cipher-refresh", expiresAt: "2026-08-08T04:00:00.000Z", accountName: "Tester", accountEmail: "tester@example.com" });
  const connection = await store.getCloudConnection("dropbox");
  assert.equal(connection.accessToken, "cipher-access");
  assert.equal(connection.accountEmail, "tester@example.com");
  assert.deepEqual((await store.listCloudConnections()).map((item) => item.provider), ["dropbox"]);
  assert.equal(await store.deleteCloudConnection("dropbox"), true);
  assert.equal(await store.getCloudConnection("dropbox"), null);
});

test("D1 hides the encrypted external AI key from public preferences", async () => {
  const store = new D1Store(new D1TestDatabase());
  await store.updatePreferences(0, { aiProvider: "openai", aiApiKeyEncrypted: "ciphertext" });
  const publicPreferences = await store.getPreferences();
  assert.equal(publicPreferences.aiApiKeyConfigured, true);
  assert.equal(publicPreferences.aiApiKeyEncrypted, undefined);
  assert.equal((await store.getPreferences({ includeSecrets: true })).aiApiKeyEncrypted, "ciphertext");
});

test("D1 export reads the library tables from one batch snapshot", async () => {
  const store = new D1Store(new D1TestDatabase());
  const bookmark = await store.createBookmark({ link: "https://example.com/snapshot", title: "Snapshot", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: [], highlights: [], favorite: false });
  const backup = await store.exportData();
  assert.equal(backup.format, "private-bookmarks/v1");
  assert.equal(backup.bookmarks.some((item) => item.id === bookmark.id), true);
  assert.equal(backup.collections.some((item) => item.id === "unsorted"), true);
  assert.equal(backup.preferences.revision, 0);
});

test("D1 collection scopes include descendants unless legacy view is enabled", async () => {
  const store = new D1Store(new D1TestDatabase());
  const parent = await store.createCollection({ name: "Parent" });
  const child = await store.createCollection({ name: "Child", parentId: parent.id });
  await store.createBookmark({ link: "https://example.com/parent", title: "Parent bookmark", description: "", note: "", cover: "", media: [], collectionId: parent.id, tags: ["parent"], highlights: [], favorite: false });
  await store.createBookmark({ link: "https://example.com/child", title: "Child bookmark", description: "", note: "", cover: "", media: [], collectionId: child.id, tags: ["child"], highlights: [], favorite: false });

  assert.deepEqual((await store.listBookmarks({ collectionId: parent.id })).map((item) => item.title).sort(), ["Child bookmark", "Parent bookmark"]);
  assert.deepEqual((await store.listBookmarks({ collectionId: parent.id, nestedViewLegacy: true })).map((item) => item.title), ["Parent bookmark"]);
  assert.deepEqual(await store.listTags({ collectionId: parent.id }), [{ name: "child", count: 1 }, { name: "parent", count: 1 }]);
});

test("D1 updates reject stale bookmark revisions", async () => {
  const store = new D1Store(new D1TestDatabase());
  const bookmark = await store.createBookmark({ link: "https://example.com/conflict", title: "Conflict", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: [], highlights: [], favorite: false });
  assert.ok((await store.updateBookmark(bookmark.id, bookmark.revision, { note: "new" })).bookmark);
  assert.ok((await store.updateBookmark(bookmark.id, bookmark.revision, { note: "stale" })).conflict);
});

test("D1 incremental sync applies independent records and reports stale revisions", async () => {
  const store = new D1Store(new D1TestDatabase());
  const first = { id: "11111111-1111-4111-8111-111111111111", link: "https://example.com/sync", title: "Sync", description: "", note: "", collectionId: "unsorted", tags: [], createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z", revision: 1 };
  const created = await store.applySyncChanges([{ entity: "bookmark", baseRevision: 0, record: first }]);
  assert.equal(created.applied[0].record.title, "Sync");

  const permanent = await store.applySyncChanges([{ entity: "bookmark", baseRevision: 1, record: { ...first, deletedAt: "2026-08-12T00:00:02.000Z", permanentDeletedAt: "2026-08-12T00:00:02.000Z", revision: 2 } }]);
  assert.equal(permanent.applied[0].record.permanentDeletedAt, "2026-08-12T00:00:02.000Z");

  const result = await store.applySyncChanges([
    { entity: "bookmark", baseRevision: 1, record: { ...first, title: "Stale", revision: 2 } },
    { entity: "collection", baseRevision: 0, record: { id: "22222222-2222-4222-8222-222222222222", name: "Synced", parentId: null, createdAt: "2026-08-12T00:00:01.000Z", updatedAt: "2026-08-12T00:00:01.000Z", revision: 1 } },
  ]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.applied[0].entity, "collection");
  const page = await store.listSyncChanges();
  assert.equal(page.changes.some((change) => change.record.id === first.id), true);
  assert.equal(page.changes.some((change) => change.record.id === "22222222-2222-4222-8222-222222222222"), true);
});

test("D1 stores bookmark metadata and clears reminders", async () => {
  const store = new D1Store(new D1TestDatabase());
  const bookmark = await store.createBookmark({ link: "https://example.com/reminder", type: "article", language: "zh", title: "Reminder", description: "", note: "", reminder: "2026-08-08T09:00:00.000Z", cover: "", media: [], collectionId: "unsorted", tags: [], highlights: [], favorite: false });
  assert.equal(bookmark.reminder, "2026-08-08T09:00:00.000Z");
  assert.equal(bookmark.type, "article");
  assert.equal(bookmark.language, "zh");
  const updated = await store.updateBookmark(bookmark.id, bookmark.revision, { reminder: "" });
  assert.equal(updated.bookmark.reminder, "");
});

test("D1 collection counts include only live bookmarks", async () => {
  const store = new D1Store(new D1TestDatabase());
  const collection = await store.createCollection({ name: "Counted" });
  const live = await store.createBookmark({ link: "https://example.com/live", title: "Live", description: "", note: "", cover: "", media: [], collectionId: collection.id, tags: [], highlights: [], favorite: false });
  const trashed = await store.createBookmark({ link: "https://example.com/trash", title: "Trash", description: "", note: "", cover: "", media: [], collectionId: collection.id, tags: [], highlights: [], favorite: false });
  await store.trashBookmark(trashed.id, trashed.revision);

  assert.equal((await store.listCollectionCounts())[collection.id], 1);
  assert.equal(await store.getTrashCount(), 1);
  assert.equal((await store.getBookmark(live.id)).deletedAt, null);
});

test("D1 screenshot batch stores the screenshot sentinel for every bookmark", async () => {
  const store = new D1Store(new D1TestDatabase());
  const first = await store.createBookmark({ link: "https://example.com/one", title: "One", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: [], highlights: [], favorite: false });
  const second = await store.createBookmark({ link: "https://example.com/two", title: "Two", description: "", note: "", cover: "", media: ["https://example.com/cover"], collectionId: "unsorted", tags: [], highlights: [], favorite: false });

  const result = await store.batchBookmarks([
    { id: first.id, revision: first.revision },
    { id: second.id, revision: second.revision },
  ], { type: "screenshot" });

  assert.equal(result.bookmarks.every((item) => item.cover === "<screenshot>"), true);
  assert.equal(result.bookmarks.every((item) => item.media.includes("<screenshot>")), true);
});

test("D1 bulk import assigns collection positions and canonical tag names", async () => {
  const store = new D1Store(new D1TestDatabase());
  const collection = await store.createCollection({ name: "Imported" });
  const result = await store.importBookmarks([
    { link: "https://example.com/import-one", type: "link", language: "", title: "One", description: "", note: "", reminder: "", cover: "", media: [], collectionId: collection.id, tags: ["Read", "Shared"], highlights: [], favorite: false, createdAt: "2024-01-02T03:04:05.000Z" },
    { link: "https://example.com/import-two", type: "link", language: "", title: "Two", description: "", note: "", reminder: "", cover: "", media: [], collectionId: collection.id, tags: ["read", "Other"], highlights: [], favorite: false },
  ]);

  assert.equal(result.count, 2);
  const imported = await store.listBookmarks({ collectionId: collection.id });
  assert.equal(imported[0].createdAt, "2024-01-02T03:04:05.000Z");
  assert.deepEqual(imported.map((item) => item.position), [0, 1]);
  assert.deepEqual(imported.map((item) => item.tags), [["Read", "Shared"], ["Read", "Other"]]);
  assert.deepEqual((await store.db.prepare("SELECT key, name FROM tag_names ORDER BY key").all()).results.map(({ key, name }) => ({ key, name })), [
    { key: "other", name: "Other" }, { key: "read", name: "Read" }, { key: "shared", name: "Shared" },
  ]);
});

test("D1 bulk import is idempotent for stable import IDs", async () => {
  const store = new D1Store(new D1TestDatabase());
  const items = [{
    id: "11111111-1111-4111-8111-111111111111",
    link: "https://example.com/idempotent",
    type: "link",
    language: "",
    title: "Idempotent",
    description: "",
    note: "",
    reminder: "",
    cover: "",
    media: [],
    collectionId: "unsorted",
    tags: [],
    highlights: [],
    favorite: false,
  }];

  assert.equal((await store.importBookmarks(items)).count, 1);
  assert.equal((await store.importBookmarks(items)).count, 0);
  assert.equal((await store.listBookmarks({ collectionId: "unsorted" })).filter((item) => item.link === items[0].link).length, 1);
});

test("D1 search relevance and tag sorting use server-side order", async () => {
  const store = new D1Store(new D1TestDatabase());
  await store.createBookmark({ link: "https://example.com/one", title: "alpha", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: ["zeta", "shared"], highlights: [], favorite: false });
  await store.createBookmark({ link: "https://example.com/two", title: "Other", description: "", note: "contains alpha", cover: "", media: [], collectionId: "unsorted", tags: ["alpha", "shared"], highlights: [], favorite: false });
  await store.createBookmark({ link: "https://example.com/three", title: "Beta", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: ["alpha", "beta"], highlights: [], favorite: false });

  const ranked = await store.listBookmarks({ search: "alpha", sort: "score" });
  assert.equal(ranked[0].title, "alpha");

  assert.deepEqual(await store.listTags({ sort: "_id" }), [
    { name: "alpha", count: 2 }, { name: "beta", count: 1 }, { name: "shared", count: 2 }, { name: "zeta", count: 1 },
  ]);
  assert.deepEqual(await store.listTags({ sort: "-count" }), [
    { name: "alpha", count: 2 }, { name: "shared", count: 2 }, { name: "beta", count: 1 }, { name: "zeta", count: 1 },
  ]);
});
