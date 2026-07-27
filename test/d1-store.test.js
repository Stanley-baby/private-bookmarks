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
    for (const file of ["0001_initial.sql", "0002_trash_source.sql", "0003_collection_trash_source.sql"]) this.database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
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

test("D1 updates reject stale bookmark revisions", async () => {
  const store = new D1Store(new D1TestDatabase());
  const bookmark = await store.createBookmark({ link: "https://example.com/conflict", title: "Conflict", description: "", note: "", cover: "", media: [], collectionId: "unsorted", tags: [], highlights: [], favorite: false });
  assert.ok((await store.updateBookmark(bookmark.id, bookmark.revision, { note: "new" })).bookmark);
  assert.ok((await store.updateBookmark(bookmark.id, bookmark.revision, { note: "stale" })).conflict);
});
