const DEFAULT_PREFERENCES = {
  language: "zh-Hans",
  theme: "auto",
  defaultCollectionId: "unsorted",
  sort: "manual",
  layout: "list",
  defaultView: "list",
  buttonGroup: { select: true, current_tab: false, new_tab: true, preview: false, web: false, copy: false, ask: false, important: false, tags: false, edit: true, remove: true },
  searchRelevance: true,
  brokenLevel: "default",
  nestedViewLegacy: false,
  layoutByScope: {},
};

function now() {
  return new Date().toISOString();
}

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function bookmark(row) {
  if (!row) return null;
  return {
    id: row.id,
    link: row.link,
    type: row.type || "link",
    title: row.title,
    description: row.description,
    note: row.note,
    reminder: row.reminder || "",
    cover: row.cover,
    media: parse(row.media_json, []),
    collectionId: row.collection_id,
    tags: parse(row.tags_json, []),
    highlights: parse(row.highlights_json, []),
    favorite: Boolean(row.favorite),
    position: row.position,
    health: {
      status: row.health_status,
      checkedAt: row.health_checked_at,
      finalUrl: row.health_final_url,
    },
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedByCollectionId: row.deleted_by_collection_id,
  };
}

function collection(row) {
  return row && {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedByCollectionId: row.deleted_by_collection_id,
  };
}

function bookmarkFilters({ collectionId, view, search, nestedViewLegacy = false } = {}) {
  const where = [view === "trash" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
  const bindings = [];
  let withClause = "";
  if (view === "favorites") where.push("favorite = 1");
  if (view === "broken") where.push("health_status = 'broken'");
  if (view === "unknown") where.push("health_status = 'unknown'");
  if (collectionId) {
    if (nestedViewLegacy) where.push("collection_id = ?");
    else {
      withClause = `WITH RECURSIVE collection_scope(id) AS (
        SELECT id FROM collections WHERE id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT collections.id FROM collections JOIN collection_scope ON collections.parent_id = collection_scope.id WHERE collections.deleted_at IS NULL
      )`;
      where.push("collection_id IN (SELECT id FROM collection_scope)");
    }
    bindings.push(collectionId);
  }
  if (search) {
    where.push("(title LIKE ? COLLATE NOCASE OR link LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR note LIKE ? COLLATE NOCASE OR tags_json LIKE ? COLLATE NOCASE OR highlights_json LIKE ? COLLATE NOCASE)");
    const term = `%${search.replace(/[%_]/g, "\\$&")}%`;
    bindings.push(term, term, term, term, term, term);
  }
  return { withClause, where, bindings };
}

function searchScore(item, query) {
  const fields = [[item.title, 100], [item.tags.join(" "), 60], [item.description, 40], [item.note, 40], [item.link, 20]];
  return String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).reduce((total, term) => total + fields.reduce((score, [value, weight]) => {
    const text = String(value || "").toLocaleLowerCase();
    if (!text.includes(term)) return score;
    return score + weight * (text === term ? 4 : text.startsWith(term) ? 3 : 1);
  }, 0), 0);
}

function backupCollections(items) {
  const pending = [...items];
  const ordered = [];
  const known = new Set();
  while (pending.length) {
    const index = pending.findIndex((item) => !item.parentId || known.has(item.parentId));
    if (index < 0) throw new TypeError("Backup contains a circular collection tree");
    const item = pending.splice(index, 1)[0];
    ordered.push(item);
    known.add(item.id);
  }
  return ordered;
}

export class D1Store {
  constructor(db) {
    this.db = db;
  }

  async listBookmarks({ collectionId, view, search, sort, nestedViewLegacy = false } = {}) {
    const { withClause, where, bindings } = bookmarkFilters({ collectionId, view, search, nestedViewLegacy });
    const { results } = await this.db.prepare(`${withClause} SELECT * FROM bookmarks WHERE ${where.join(" AND ")} ORDER BY position, created_at DESC`).bind(...bindings).all();
    const items = results.map(bookmark);
    if (sort !== "score" || !search) return items;
    return items.map((item, index) => ({ item, index, score: searchScore(item, search) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ item }) => item);
  }

  async listTags({ collectionId, view, search, sort = "_id", nestedViewLegacy = false } = {}) {
    const { withClause, where, bindings } = bookmarkFilters({ collectionId, view, search, nestedViewLegacy });
    const { results } = await this.db.prepare(`${withClause} SELECT tags_json FROM bookmarks WHERE ${where.join(" AND ")}`).bind(...bindings).all();
    const counts = new Map();
    for (const row of results) for (const tag of parse(row.tags_json, [])) counts.set(tag, (counts.get(tag) || 0) + 1);
    const tags = [...counts].sort(sort === "-count"
      ? ([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB, "zh-CN")
      : ([tagA], [tagB]) => tagA.localeCompare(tagB, "zh-CN"));
    return tags.map(([name, count]) => ({ name, count }));
  }

  async getBookmark(id) {
    return bookmark(await this.db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first());
  }

  async getBookmarksByLink(link) {
    const { results } = await this.db.prepare("SELECT * FROM bookmarks WHERE link = ? AND deleted_at IS NULL ORDER BY created_at").bind(link).all();
    return results.map(bookmark);
  }

  async canonicalTags(tags) {
    const names = [];
    for (const name of tags) {
      const key = name.toLocaleLowerCase();
      await this.db.prepare("INSERT OR IGNORE INTO tag_names (key, name) VALUES (?, ?)").bind(key, name).run();
      names.push((await this.db.prepare("SELECT name FROM tag_names WHERE key = ?").bind(key).first()).name);
    }
    return names;
  }

  async nextBookmarkPosition(collectionId) {
    const row = await this.db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM bookmarks WHERE collection_id = ? AND deleted_at IS NULL").bind(collectionId).first();
    return row.position + 1;
  }

  async createBookmark(input) {
    const parent = await this.getCollection(input.collectionId);
    if (!parent || parent.deletedAt) throw new TypeError("Collection not found");
    const id = crypto.randomUUID();
    const createdAt = now();
    const tags = await this.canonicalTags(input.tags);
    await this.db.prepare(`INSERT INTO bookmarks
      (id, link, type, title, description, note, reminder, cover, media_json, collection_id, tags_json, highlights_json, favorite, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.link, input.type || "link", input.title, input.description, input.note, input.reminder || null, input.cover, JSON.stringify(input.media), input.collectionId, JSON.stringify(tags), JSON.stringify(input.highlights), input.favorite ? 1 : 0, await this.nextBookmarkPosition(input.collectionId), createdAt, createdAt)
      .run();
    return this.getBookmark(id);
  }

  async updateBookmark(id, expectedRevision, changes) {
    const current = await this.getBookmark(id);
    if (!current || current.deletedAt) return { missing: true };
    if (current.revision !== expectedRevision) return { conflict: current };
    if (changes.collectionId) {
      const destination = await this.getCollection(changes.collectionId);
      if (!destination || destination.deletedAt) throw new TypeError("Collection not found");
    }
    if (changes.tags) changes.tags = await this.canonicalTags(changes.tags);

    const columns = {
      link: "link",
      type: "type",
      title: "title",
      description: "description",
      note: "note",
      reminder: "reminder",
      cover: "cover",
      collectionId: "collection_id",
      favorite: "favorite",
      position: "position",
    };
    const assignments = [];
    const bindings = [];
    for (const [field, column] of Object.entries(columns)) {
      if (field in changes) {
        assignments.push(`${column} = ?`);
        bindings.push(field === "favorite" ? Number(changes[field]) : changes[field]);
      }
    }
    if ("tags" in changes) {
      assignments.push("tags_json = ?");
      bindings.push(JSON.stringify(changes.tags));
    }
    if ("highlights" in changes) {
      assignments.push("highlights_json = ?");
      bindings.push(JSON.stringify(changes.highlights));
    }
    if ("media" in changes) {
      assignments.push("media_json = ?");
      bindings.push(JSON.stringify(changes.media));
    }
    if (!assignments.length) return { bookmark: current };
    assignments.push("revision = revision + 1", "updated_at = ?");
    bindings.push(now(), id, expectedRevision);
    const result = await this.db.prepare(`UPDATE bookmarks SET ${assignments.join(", ")} WHERE id = ? AND revision = ? AND deleted_at IS NULL`).bind(...bindings).run();
    return result.meta.changes ? { bookmark: await this.getBookmark(id) } : { conflict: await this.getBookmark(id) };
  }

  async trashBookmark(id, expectedRevision) {
    const current = await this.getBookmark(id);
    if (!current || current.deletedAt) return { missing: true };
    if (current.revision !== expectedRevision) return { conflict: current };
    const result = await this.db.prepare("UPDATE bookmarks SET deleted_at = ?, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL")
      .bind(now(), now(), id, expectedRevision).run();
    return result.meta.changes ? { bookmark: await this.getBookmark(id) } : { conflict: await this.getBookmark(id) };
  }

  async restoreBookmark(id, expectedRevision) {
    const current = await this.getBookmark(id);
    if (!current || !current.deletedAt) return { missing: true };
    if (current.revision !== expectedRevision) return { conflict: current };
    const parents = await this.collectionAncestors([current.collectionId]);
    const updatedAt = now();
    const results = await this.db.batch([
      ...parents.map((collectionId) => this.db.prepare("UPDATE collections SET deleted_at = NULL, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL AND (SELECT revision FROM bookmarks WHERE id = ?) = ?")
        .bind(updatedAt, collectionId, id, expectedRevision)),
      this.db.prepare("UPDATE bookmarks SET deleted_at = NULL, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL")
        .bind(updatedAt, id, expectedRevision),
    ]);
    const result = results[results.length - 1];
    return result.meta.changes ? { bookmark: await this.getBookmark(id) } : { conflict: await this.getBookmark(id) };
  }

  async batchBookmarks(items, action) {
    if (action.type === "move") {
      const destination = await this.getCollection(action.collectionId);
      if (!destination || destination.deletedAt) throw new TypeError("Collection not found");
    }
    const updatedAt = now();
    const ids = items.map((item) => item.id);
    const idPlaceholders = ids.map(() => "?").join(", ");
    const revisions = items.map(() => "(id = ? AND revision = ?)").join(" OR ");
    const revisionBindings = items.flatMap((item) => [item.id, item.revision]);
    const isRestore = action.type === "restore";
    const livePredicate = isRestore ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
    const restoreParents = isRestore ? await this.collectionAncestors((await Promise.all(ids.map((id) => this.getBookmark(id)))).filter(Boolean).map((item) => item.collectionId)) : [];
    let set = action.type === "favorite"
      ? ["favorite = ?", "revision = revision + 1", "updated_at = ?"]
      : action.type === "move"
        ? ["collection_id = ?", "revision = revision + 1", "updated_at = ?"]
        : action.type === "restore"
          ? ["deleted_at = NULL", "deleted_by_collection_id = NULL", "revision = revision + 1", "updated_at = ?"]
          : ["deleted_at = ?", "deleted_by_collection_id = NULL", "revision = revision + 1", "updated_at = ?"];
    let setBindings = action.type === "favorite" ? [action.favorite ? 1 : 0, updatedAt] : action.type === "move" ? [action.collectionId, updatedAt] : action.type === "restore" ? [updatedAt] : [updatedAt, updatedAt];
    if (action.type === "tags") {
      const current = await Promise.all(ids.map((id) => this.getBookmark(id)));
      if (current.some((item) => !item)) return { conflict: true };
      const tags = await this.canonicalTags(action.tags);
      const values = current.map((item) => {
        const keys = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
        const next = action.mode === "add" ? [...item.tags, ...tags].filter((tag, index, all) => all.findIndex((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index) : item.tags.filter((tag) => !keys.has(tag.toLocaleLowerCase()));
        return [item.id, JSON.stringify(next)];
      });
      set = [`tags_json = CASE id ${values.map(() => "WHEN ? THEN ?").join(" ")} END`, "revision = revision + 1", "updated_at = ?"];
      setBindings = [...values.flat(), updatedAt];
    }
    if (action.type === "screenshot") {
      const current = await Promise.all(ids.map((id) => this.getBookmark(id)));
      if (current.some((item) => !item)) return { conflict: true };
      const media = current.map((item) => {
        const values = Array.isArray(item.media) ? [...item.media] : [];
        return values.some((value) => value === "<screenshot>" || value?.link === "<screenshot>") ? values : [...values, "<screenshot>"];
      });
      const coverValues = current.flatMap((item) => [item.id, "<screenshot>"]);
      const mediaValues = current.flatMap((item, index) => [item.id, JSON.stringify(media[index])]);
      set = [
        `cover = CASE id ${current.map(() => "WHEN ? THEN ?").join(" ")} END`,
        `media_json = CASE id ${current.map(() => "WHEN ? THEN ?").join(" ")} END`,
        "revision = revision + 1",
        "updated_at = ?",
      ];
      setBindings = [...coverValues, ...mediaValues, updatedAt];
    }
    const update = this.db.prepare(`UPDATE bookmarks SET ${set.join(", ")}
      WHERE id IN (${idPlaceholders}) AND ${livePredicate}
      AND (SELECT COUNT(*) FROM bookmarks WHERE id IN (${idPlaceholders}) AND ${livePredicate} AND (${revisions})) = ?`)
      .bind(...setBindings, ...ids, ...ids, ...revisionBindings, items.length);
    const result = restoreParents.length
      ? (await this.db.batch([
        ...restoreParents.map((collectionId) => this.db.prepare(`UPDATE collections SET deleted_at = NULL, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL
          AND (SELECT COUNT(*) FROM bookmarks WHERE id IN (${idPlaceholders}) AND deleted_at IS NOT NULL AND (${revisions})) = ?`)
          .bind(updatedAt, collectionId, ...ids, ...revisionBindings, items.length)),
        update,
      ])).at(-1)
      : await update.run();
    if (result.meta.changes !== items.length) return { conflict: true };
    return { bookmarks: await Promise.all(items.map(({ id }) => this.getBookmark(id))) };
  }

  async purgeTrash(before) {
    await this.db.batch([
      this.db.prepare("DELETE FROM bookmarks WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(before),
      this.db.prepare("DELETE FROM collections WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(before),
    ]);
  }

  async exportData() {
    const [collections, bookmarks, preferences] = await Promise.all([
      (await this.db.prepare("SELECT * FROM collections ORDER BY created_at").all()).results.map(collection),
      (await this.db.prepare("SELECT * FROM bookmarks ORDER BY created_at").all()).results.map(bookmark),
      this.getPreferences(),
    ]);
    return { format: "private-bookmarks/v1", exportedAt: now(), collections, bookmarks, preferences };
  }

  async replaceData(backup) {
    if (!Array.isArray(backup.collections) || !Array.isArray(backup.bookmarks)) throw new TypeError("Backup is incomplete");
    const collections = backup.collections.some((item) => item.id === "unsorted") ? backup.collections : [{ id: "unsorted", name: "Unsorted", parentId: null, position: 0, revision: 1 }, ...backup.collections];
    const ordered = backupCollections(collections);
    const timestamp = now();
    const statements = [
      this.db.prepare("DELETE FROM bookmarks"),
      this.db.prepare("DELETE FROM collections"),
      this.db.prepare("DELETE FROM tag_names"),
      this.db.prepare("DELETE FROM preferences"),
      ...ordered.map((item) => this.db.prepare("INSERT INTO collections (id, parent_id, name, position, revision, created_at, updated_at, deleted_at, deleted_by_collection_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.parentId || null, String(item.name || "Untitled").slice(0, 200), Number(item.position) || 0, Number(item.revision) || 1, item.createdAt || timestamp, item.updatedAt || timestamp, item.deletedAt || null, item.deletedByCollectionId || null)),
    ];
    const collectionIds = new Set(ordered.map((item) => item.id));
    for (const item of backup.bookmarks) {
      const tags = Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
      for (const tag of tags) statements.push(this.db.prepare("INSERT OR IGNORE INTO tag_names (key, name) VALUES (?, ?)").bind(tag.toLocaleLowerCase(), tag));
      statements.push(this.db.prepare(`INSERT INTO bookmarks
        (id, link, type, title, description, note, reminder, cover, media_json, collection_id, tags_json, highlights_json, favorite, position, health_status, health_checked_at, health_final_url, revision, created_at, updated_at, deleted_at, deleted_by_collection_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(item.id || crypto.randomUUID(), item.link, ["link", "article", "image", "video", "audio", "document"].includes(item.type) ? item.type : "link", item.title || "", item.description || "", item.note || "", item.reminder || null, item.cover || "", JSON.stringify(Array.isArray(item.media) ? item.media : []), collectionIds.has(item.collectionId) ? item.collectionId : "unsorted", JSON.stringify(tags), JSON.stringify(Array.isArray(item.highlights) ? item.highlights : []), item.favorite ? 1 : 0, Number(item.position) || 0, item.health?.status || "unknown", item.health?.checkedAt || null, item.health?.finalUrl || null, Number(item.revision) || 1, item.createdAt || timestamp, item.updatedAt || timestamp, item.deletedAt || null, item.deletedByCollectionId || null));
    }
    const preferences = { ...DEFAULT_PREFERENCES, ...(backup.preferences || {}) };
    statements.push(this.db.prepare("INSERT INTO preferences (key, value_json, revision, updated_at) VALUES ('ui', ?, ?, ?)")
      .bind(JSON.stringify(preferences), Number(preferences.revision) || 1, timestamp));
    await this.db.batch(statements);
  }

  async listCollections({ trash = false } = {}) {
    const where = trash
      ? "deleted_at IS NOT NULL AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM collections WHERE deleted_at IS NOT NULL))"
      : "deleted_at IS NULL";
    const { results } = await this.db.prepare(`SELECT * FROM collections WHERE ${where} ORDER BY position, name COLLATE NOCASE`).all();
    return results.map(collection);
  }

  async listCollectionCounts() {
    const { results } = await this.db.prepare("SELECT collection_id, COUNT(*) AS count FROM bookmarks WHERE deleted_at IS NULL GROUP BY collection_id").all();
    return Object.fromEntries(results.map((row) => [row.collection_id, row.count]));
  }

  async getTrashCount() {
    return (await this.db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE deleted_at IS NOT NULL").first()).count;
  }

  async getCollection(id) {
    return collection(await this.db.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first());
  }

  async collectionAncestors(collectionIds) {
    const unique = [...new Set(collectionIds)];
    if (!unique.length) return [];
    const { results } = await this.db.prepare(`WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT id, parent_id FROM collections WHERE id IN (${unique.map(() => "?").join(", ")})
      UNION SELECT collections.id, collections.parent_id FROM collections JOIN ancestors ON collections.id = ancestors.parent_id
    ) SELECT id FROM ancestors`).bind(...unique).all();
    return results.map((row) => row.id);
  }

  async createCollection({ name, parentId = null }) {
    const label = String(name || "").trim().slice(0, 200);
    if (!label) throw new TypeError("Collection name is required");
    if (parentId) {
      const parent = await this.getCollection(parentId);
      if (!parent || parent.deletedAt) throw new TypeError("Parent collection not found");
    }
    const id = crypto.randomUUID();
    const createdAt = now();
    const row = await this.db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM collections WHERE parent_id IS ? AND deleted_at IS NULL").bind(parentId).first();
    await this.db.prepare("INSERT INTO collections (id, parent_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, parentId, label, row.position + 1, createdAt, createdAt).run();
    return this.getCollection(id);
  }

  async updateCollection(id, expectedRevision, changes) {
    const current = await this.getCollection(id);
    if (!current || current.deletedAt || id === "unsorted") return { missing: true };
    if (current.revision !== expectedRevision) return { conflict: current };
    const name = "name" in changes ? String(changes.name || "").trim().slice(0, 200) : current.name;
    if (!name) throw new TypeError("Collection name is required");
    const parentId = "parentId" in changes ? changes.parentId || null : current.parentId;
    if (parentId === id) throw new TypeError("A collection cannot contain itself");
    if (parentId) {
      const { results } = await this.db.prepare(`WITH RECURSIVE subtree(id) AS (
        SELECT id FROM collections WHERE id = ?
        UNION ALL SELECT collections.id FROM collections JOIN subtree ON collections.parent_id = subtree.id
      ) SELECT id FROM subtree`).bind(id).all();
      if (results.some((row) => row.id === parentId)) throw new TypeError("A collection cannot move into its descendant");
    }
    const position = Number.isFinite(changes.position) ? changes.position : current.position;
    const result = await this.db.prepare("UPDATE collections SET name = ?, parent_id = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL")
      .bind(name, parentId, position, now(), id, expectedRevision).run();
    return result.meta.changes ? { collection: await this.getCollection(id) } : { conflict: await this.getCollection(id) };
  }

  async trashCollection(id, expectedRevision) {
    const root = await this.getCollection(id);
    if (!root || root.deletedAt || id === "unsorted") return { missing: true };
    if (root.revision !== expectedRevision) return { conflict: root };
    const { results } = await this.db.prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM collections WHERE id = ?
      UNION ALL SELECT collections.id FROM collections JOIN subtree ON collections.parent_id = subtree.id
    ) SELECT id FROM subtree`).bind(id).all();
    const ids = results.map((row) => row.id);
    const deletedAt = now();
    await this.db.batch([
      ...ids.map((collectionId) => this.db.prepare("UPDATE collections SET deleted_at = ?, deleted_by_collection_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(deletedAt, id, deletedAt, collectionId)),
      ...ids.map((collectionId) => this.db.prepare("UPDATE bookmarks SET deleted_at = ?, deleted_by_collection_id = ?, revision = revision + 1, updated_at = ? WHERE collection_id = ? AND deleted_at IS NULL").bind(deletedAt, id, deletedAt, collectionId)),
    ]);
    return { collection: await this.getCollection(id) };
  }

  async restoreCollection(id, expectedRevision) {
    const root = await this.getCollection(id);
    if (!root || !root.deletedAt) return { missing: true };
    if (root.revision !== expectedRevision) return { conflict: root };
    const { results } = await this.db.prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM collections WHERE id = ?
      UNION ALL SELECT collections.id FROM collections JOIN subtree ON collections.parent_id = subtree.id
    ), ancestors(id, parent_id) AS (
      SELECT id, parent_id FROM collections WHERE id = ?
      UNION SELECT collections.id, collections.parent_id FROM collections JOIN ancestors ON collections.id = ancestors.parent_id WHERE collections.deleted_at IS NOT NULL
    ), affected(id) AS (
      SELECT id FROM subtree UNION SELECT id FROM ancestors
    ) SELECT id FROM affected`).bind(id, id).all();
    const ids = results.map((row) => row.id);
    const sourceId = root.deletedByCollectionId;
    const updatedAt = now();
    await this.db.batch([
      ...ids.map((collectionId) => this.db.prepare("UPDATE collections SET deleted_at = NULL, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_by_collection_id = ?").bind(updatedAt, collectionId, sourceId)),
      ...ids.map((collectionId) => this.db.prepare("UPDATE bookmarks SET deleted_at = NULL, deleted_by_collection_id = NULL, revision = revision + 1, updated_at = ? WHERE collection_id = ? AND deleted_by_collection_id = ?").bind(updatedAt, collectionId, sourceId)),
    ]);
    return { collection: await this.getCollection(id) };
  }

  async getPreferences() {
    const row = await this.db.prepare("SELECT * FROM preferences WHERE key = 'ui'").first();
    return row ? { ...DEFAULT_PREFERENCES, ...parse(row.value_json, {}), revision: row.revision } : { ...DEFAULT_PREFERENCES, revision: 0 };
  }

  async updatePreferences(expectedRevision, preferences) {
    const current = await this.getPreferences();
    if (current.revision !== expectedRevision) return { conflict: current };
    const value = { ...DEFAULT_PREFERENCES, ...preferences };
    const updatedAt = now();
    if (current.revision === 0) {
      await this.db.prepare("INSERT INTO preferences (key, value_json, revision, updated_at) VALUES ('ui', ?, 1, ?)").bind(JSON.stringify(value), updatedAt).run();
    } else {
      const result = await this.db.prepare("UPDATE preferences SET value_json = ?, revision = revision + 1, updated_at = ? WHERE key = 'ui' AND revision = ?")
        .bind(JSON.stringify(value), updatedAt, expectedRevision).run();
      if (!result.meta.changes) return { conflict: await this.getPreferences() };
    }
    return { preferences: await this.getPreferences() };
  }

  async healthCandidates(before, collectionId = null) {
    const query = "SELECT * FROM bookmarks WHERE deleted_at IS NULL AND (health_checked_at IS NULL OR health_checked_at < ?)" + (collectionId ? " AND collection_id = ?" : "") + " ORDER BY health_checked_at LIMIT 500";
    const { results } = await this.db.prepare(query).bind(before, ...(collectionId ? [collectionId] : [])).all();
    return results.map(bookmark);
  }

  async updateHealth(id, health) {
    await this.db.prepare("UPDATE bookmarks SET health_status = ?, health_checked_at = ?, health_final_url = ? WHERE id = ?")
      .bind(health.status, now(), health.finalUrl || null, id).run();
  }
}
