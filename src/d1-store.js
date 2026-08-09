const DEFAULT_PREFERENCES = {
  language: "zh-Hans",
  instanceName: "私有书签",
  theme: "auto",
  defaultCollectionId: "unsorted",
  sort: "manual",
  layout: "list",
  defaultView: "list",
  buttonGroup: { select: true, current_tab: false, new_tab: true, preview: false, web: false, copy: false, ask: false, important: false, tags: false, edit: true, remove: true },
  searchRelevance: true,
  recommendCollectionsTags: false,
  aiRecommendations: false,
  aiProvider: "cloudflare",
  aiModel: "",
  aiThinkingEnabled: false,
  aiMaxTokens: 300,
  aiBaseUrl: "https://api.openai.com/v1",
  aiExternalModel: "gpt-4o-mini",
  aiPrompt: "",
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
    language: row.language || "",
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

function cloudBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind || "manual",
    includeMedia: Boolean(row.include_media),
    mediaCopied: Boolean(row.media_copied),
    mediaCount: Number(row.media_count) || 0,
    libraryBytes: Number(row.library_bytes) || 0,
    librarySha256: row.library_sha256 || "",
    manifestSha256: row.manifest_sha256 || "",
    createdAt: row.created_at,
  };
}

function cloudConnection(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    accessToken: row.access_token || "",
    refreshToken: row.refresh_token || "",
    expiresAt: row.expires_at || "",
    scope: row.scope || "",
    accountId: row.account_id || "",
    accountName: row.account_name || "",
    accountEmail: row.account_email || "",
    connectedAt: row.connected_at || "",
    updatedAt: row.updated_at || "",
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

// Cloudflare D1 batches have a finite statement budget; leave headroom for restore metadata.
export const MAX_RESTORE_STATEMENTS = 90;

export function restoreStatementCount(backup) {
  if (!Array.isArray(backup?.collections) || !Array.isArray(backup?.bookmarks)) return Infinity;
  const collections = backup.collections.some((item) => item.id === "unsorted") ? backup.collections : [{ id: "unsorted" }, ...backup.collections];
  const tags = new Set(backup.bookmarks.flatMap((item) => Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim().toLocaleLowerCase()).filter(Boolean) : []));
  return 5 + collections.length + tags.size + backup.bookmarks.length;
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
      (id, link, type, language, title, description, note, reminder, cover, media_json, collection_id, tags_json, highlights_json, favorite, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.link, input.type || "link", input.language || "", input.title, input.description, input.note, input.reminder || null, input.cover, JSON.stringify(input.media), input.collectionId, JSON.stringify(tags), JSON.stringify(input.highlights), input.favorite ? 1 : 0, await this.nextBookmarkPosition(input.collectionId), createdAt, createdAt)
      .run();
    return this.getBookmark(id);
  }

  async importBookmarks(items) {
    if (!Array.isArray(items) || !items.length) throw new TypeError("At least one bookmark is required");
    const stableIds = items.filter((item) => item.id).map((item) => item.id);
    const existingIds = new Set();
    if (stableIds.length) {
      const rows = (await this.db.prepare(`SELECT id FROM bookmarks WHERE id IN (${stableIds.map(() => "?").join(", ")})`).bind(...stableIds).all()).results;
      for (const row of rows) existingIds.add(row.id);
    }
    const pending = items.filter((item) => !item.id || !existingIds.has(item.id));
    if (!pending.length) return { count: 0 };

    const collectionIds = [...new Set(pending.map((item) => item.collectionId))];
    const collections = await Promise.all(collectionIds.map((id) => this.getCollection(id)));
    if (collections.some((item) => !item || item.deletedAt)) throw new TypeError("Collection not found");

    const positions = new Map(collectionIds.map((id) => [id, -1]));
    const positionRows = (await this.db.prepare(`SELECT collection_id, COALESCE(MAX(position), -1) AS position
      FROM bookmarks WHERE deleted_at IS NULL AND collection_id IN (${collectionIds.map(() => "?").join(", ")}) GROUP BY collection_id`).bind(...collectionIds).all()).results;
    for (const row of positionRows) positions.set(row.collection_id, Number(row.position));

    const tagKeys = [...new Set(pending.flatMap((item) => (item.tags || []).map((tag) => tag.toLocaleLowerCase())))];
    const tagNames = new Map();
    if (tagKeys.length) {
      const existing = (await this.db.prepare(`SELECT key, name FROM tag_names WHERE key IN (${tagKeys.map(() => "?").join(", ")})`).bind(...tagKeys).all()).results;
      for (const row of existing) tagNames.set(row.key, row.name);
    }

    const statements = [];
    for (const item of pending) {
      for (const tag of item.tags || []) {
        const key = tag.toLocaleLowerCase();
        if (!tagNames.has(key)) {
          tagNames.set(key, tag);
          statements.push(this.db.prepare("INSERT OR IGNORE INTO tag_names (key, name) VALUES (?, ?)").bind(key, tag));
        }
      }
    }

    const timestamp = now();
    const bookmarkIndexes = [];
    for (const item of pending) {
      const id = item.id || crypto.randomUUID();
      const collectionId = item.collectionId;
      const position = positions.get(collectionId) + 1;
      positions.set(collectionId, position);
      const createdAt = item.createdAt || timestamp;
      const tags = (item.tags || []).map((tag) => tagNames.get(tag.toLocaleLowerCase()) || tag);
      bookmarkIndexes.push(statements.length);
      statements.push(this.db.prepare(`INSERT OR IGNORE INTO bookmarks
        (id, link, type, language, title, description, note, reminder, cover, media_json, collection_id, tags_json, highlights_json, favorite, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, item.link, item.type || "link", item.language || "", item.title || "", item.description || "", item.note || "", item.reminder || null, item.cover || "", JSON.stringify(Array.isArray(item.media) ? item.media : []), collectionId, JSON.stringify(tags), JSON.stringify(Array.isArray(item.highlights) ? item.highlights : []), item.favorite ? 1 : 0, position, createdAt, timestamp));
    }
    const results = await this.db.batch(statements);
    return { count: bookmarkIndexes.reduce((count, index) => count + Number(results[index]?.meta?.changes || 0), 0) };
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
      language: "language",
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

  async createBackup({ id = crypto.randomUUID(), kind = "manual", includeMedia = false, mediaCopied = false, mediaCount = 0, libraryBytes = 0, librarySha256 = "", manifestSha256 = "", createdAt = now() } = {}) {
    await this.db.prepare(`INSERT INTO backups
      (id, kind, include_media, media_copied, media_count, library_bytes, library_sha256, manifest_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      kind,
      includeMedia ? 1 : 0,
      mediaCopied ? 1 : 0,
      Number(mediaCount) || 0,
      Number(libraryBytes) || 0,
      librarySha256,
      manifestSha256,
      createdAt,
    ).run();
    return this.getBackup(id);
  }

  async getBackup(id) {
    return cloudBackup(await this.db.prepare("SELECT * FROM backups WHERE id = ?").bind(id).first());
  }

  async listBackups({ kind = null } = {}) {
    const query = kind ? "SELECT * FROM backups WHERE kind = ? ORDER BY created_at DESC" : "SELECT * FROM backups ORDER BY created_at DESC";
    const rows = (kind ? await this.db.prepare(query).bind(kind).all() : await this.db.prepare(query).all()).results;
    return rows.map(cloudBackup);
  }

  async deleteBackup(id) {
    const result = await this.db.prepare("DELETE FROM backups WHERE id = ?").bind(id).run();
    return Boolean(result.meta.changes);
  }

  async saveCloudConnection({ provider, accessToken, refreshToken = "", expiresAt = "", scope = "", accountId = "", accountName = "", accountEmail = "" } = {}) {
    const timestamp = now();
    await this.db.prepare(`INSERT INTO cloud_connections
      (provider, access_token, refresh_token, expires_at, scope, account_id, account_name, account_email, connected_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at, scope = excluded.scope, account_id = excluded.account_id,
      account_name = excluded.account_name, account_email = excluded.account_email, updated_at = excluded.updated_at`)
      .bind(provider, accessToken, refreshToken, expiresAt, scope, accountId, accountName, accountEmail, timestamp, timestamp).run();
    return this.getCloudConnection(provider);
  }

  async getCloudConnection(provider) {
    return cloudConnection(await this.db.prepare("SELECT * FROM cloud_connections WHERE provider = ?").bind(provider).first());
  }

  async listCloudConnections() {
    const { results } = await this.db.prepare("SELECT * FROM cloud_connections ORDER BY provider").all();
    return results.map(cloudConnection);
  }

  async deleteCloudConnection(provider) {
    const result = await this.db.prepare("DELETE FROM cloud_connections WHERE provider = ?").bind(provider).run();
    return Boolean(result.meta.changes);
  }

  async exportData() {
    const [collectionResult, bookmarkResult, preferenceResult] = await this.db.batch([
      this.db.prepare("SELECT * FROM collections ORDER BY created_at"),
      this.db.prepare("SELECT * FROM bookmarks ORDER BY created_at"),
      this.db.prepare("SELECT * FROM preferences WHERE key = 'ui'"),
    ]);
    const preferenceRow = preferenceResult?.results?.[0] || null;
    const preferences = preferenceRow ? { ...DEFAULT_PREFERENCES, ...parse(preferenceRow.value_json, {}), revision: preferenceRow.revision } : { ...DEFAULT_PREFERENCES, revision: 0 };
    const collections = (collectionResult?.results || []).map(collection);
    const bookmarks = (bookmarkResult?.results || []).map(bookmark);
    return { format: "private-bookmarks/v1", exportedAt: now(), collections, bookmarks, preferences };
  }

  async replaceData(backup) {
    if (!Array.isArray(backup.collections) || !Array.isArray(backup.bookmarks)) throw new TypeError("Backup is incomplete");
    const collections = backup.collections.some((item) => item.id === "unsorted") ? backup.collections : [{ id: "unsorted", name: "Unsorted", parentId: null, position: 0, revision: 1 }, ...backup.collections];
    const ordered = backupCollections(collections);
    if (restoreStatementCount(backup) > MAX_RESTORE_STATEMENTS) {
      const reason = new TypeError(`Backup is too large to restore in one D1 batch (maximum ${MAX_RESTORE_STATEMENTS} statements)`);
      reason.code = "backup_too_large";
      throw reason;
    }
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
        (id, link, type, language, title, description, note, reminder, cover, media_json, collection_id, tags_json, highlights_json, favorite, position, health_status, health_checked_at, health_final_url, revision, created_at, updated_at, deleted_at, deleted_by_collection_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(item.id || crypto.randomUUID(), item.link, ["link", "article", "image", "video", "audio", "document"].includes(item.type) ? item.type : "link", item.language || "", item.title || "", item.description || "", item.note || "", item.reminder || null, item.cover || "", JSON.stringify(Array.isArray(item.media) ? item.media : []), collectionIds.has(item.collectionId) ? item.collectionId : "unsorted", JSON.stringify(tags), JSON.stringify(Array.isArray(item.highlights) ? item.highlights : []), item.favorite ? 1 : 0, Number(item.position) || 0, item.health?.status || "unknown", item.health?.checkedAt || null, item.health?.finalUrl || null, Number(item.revision) || 1, item.createdAt || timestamp, item.updatedAt || timestamp, item.deletedAt || null, item.deletedByCollectionId || null));
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

  async getPreferences({ includeSecrets = false } = {}) {
    const row = await this.db.prepare("SELECT * FROM preferences WHERE key = 'ui'").first();
    const stored = row ? parse(row.value_json, {}) : {};
    const apiKeyConfigured = Boolean(stored.aiApiKeyEncrypted);
    const preferences = { ...DEFAULT_PREFERENCES, ...stored, revision: row?.revision || 0 };
    delete preferences.aiApiKeyConfigured;
    if (!includeSecrets) {
      delete preferences.aiApiKeyEncrypted;
      preferences.aiApiKeyConfigured = apiKeyConfigured;
    }
    return preferences;
  }

  async updatePreferences(expectedRevision, preferences) {
    const current = await this.getPreferences({ includeSecrets: true });
    if (current.revision !== expectedRevision) return { conflict: current };
    const value = { ...DEFAULT_PREFERENCES, ...current, ...preferences };
    delete value.revision;
    delete value.aiApiKeyConfigured;
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
