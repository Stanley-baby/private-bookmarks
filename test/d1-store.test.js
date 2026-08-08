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
    for (const file of ["0001_initial.sql", "0002_trash_source.sql", "0003_collection_trash_source.sql", "0004_reminder.sql", "0005_bookmark_type.sql", "0006_bookmark_language.sql"]) this.database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
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
