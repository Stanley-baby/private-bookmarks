import { workerClient } from "../../extension/shared/worker-client.js";
import { applyRemoteRecord, listConflicts, outboxItems, removeOutbox, saveConflict, setSyncSettings, syncSettings, type Bookmark } from "../../extension/shared/local-db.js";
import { bytesToCover, coverBytes, filterSyncableOutbox } from "../../extension/shared/local-model.js";

declare const chrome: any;

export async function syncOnce() {
  const settingsBefore = await syncSettings();
  if (!settingsBefore.enabled) return { skipped: true, reason: "disabled" };
  if (!await workerClient.connection()) return { skipped: true, reason: "offline" };
  const pending = await outboxItems();
  let pushedCount = 0;
  if (pending.length) {
    const existingConflicts = await listConflicts();
    const pendingForPush = filterSyncableOutbox(pending, existingConflicts);
    pushedCount = groupedSize(pendingForPush);
    const grouped = new Map<string, any[]>();
    for (const item of pendingForPush) {
      const key = `${item.entity}:${item.id}`;
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    const prepared = await Promise.all([...grouped.entries()].map(async ([key, items]) => {
      const latest = items.at(-1);
      const record = await remoteBookmark(latest.record);
      return { key, change: record ? { ...latest, baseRevision: items[0].baseRevision, record } : null };
    }));
    const pausedKeys = new Set([...existingConflicts.map((item: any) => `${item.entity}:${item.id}`), ...prepared.filter((item) => !item.change).map((item) => item.key)]);
    const changes = prepared.flatMap((item) => item.change ? [item.change] : []);
    const pushed = changes.length ? await workerClient.request("/v1/sync/push", { method: "POST", body: JSON.stringify({ changes: changes.map(({ id: _queueId, ...item }) => item) }) }) : { applied: [], conflicts: [] };
    const conflictKeys = new Set((pushed.conflicts || []).map((item: any) => `${item.entity}:${item.id}`));
    for (const item of pending) {
      const key = `${item.entity}:${item.id}`;
      if (pausedKeys.has(key)) continue;
      if (conflictKeys.has(key)) {
        const conflict = pushed.conflicts.find((value: any) => `${value.entity}:${value.id}` === key);
        await saveConflict(conflict);
      } else await removeOutbox(item.id);
    }
    for (const change of pushed.applied || []) {
      const local = pending.find((item) => item.entity === change.entity && item.id === change.record.id)?.record;
      await applyRemoteRecord(change.entity, local?.cover?.startsWith("data:") ? { ...change.record, cover: local.cover, coverRef: { id: local.coverRef?.id || crypto.randomUUID(), url: change.record.cover } } : change.record);
    }
  }
  let settings = await syncSettings();
  let pulledCount = 0;
  while (true) {
    const pulled = await workerClient.request(`/v1/sync/pull?cursor=${encodeURIComponent(settings.cursor || "")}&limit=200`);
    const currentOutbox = await outboxItems();
    for (const change of pulled.changes || []) {
      const pendingRecord = currentOutbox.find((item) => item.entity === change.entity && item.id === change.record.id);
      if (pendingRecord) await saveConflict({ entity: change.entity, id: change.record.id, local: pendingRecord.record, remote: change.record });
      else await applyRemoteRecord(change.entity, await localBookmark(change.record));
      pulledCount += 1;
    }
    settings = await setSyncSettings({ cursor: pulled.cursor || settings.cursor });
    if (!pulled.hasMore) break;
  }
  return { pushed: pushedCount, pulled: pulledCount, conflicts: (await listConflicts()).length };
}

async function remoteBookmark(record: any) {
  if (record?.entity === "collection" || !record?.cover?.startsWith?.("data:")) return record;
  const value = coverBytes(record.cover);
  if (!value) return record;
  try {
    const uploaded = await workerClient.media.upload(value.bytes, value.contentType, record.coverRef?.id);
    return { ...record, cover: uploaded.url, coverRef: { id: uploaded.id, url: uploaded.url, contentType: uploaded.contentType, size: uploaded.size } };
  } catch {
    // Pause only this record until R2 is available; other outbox records still sync.
    return null;
  }
}

async function localBookmark(record: any): Promise<Bookmark | any> {
  if (!record || record.entity === "collection" || typeof record.cover !== "string" || record.cover.startsWith("data:")) return record;
  let url;
  try { url = new URL(record.cover); } catch { return record; }
  if (!/^\/v1\/media\/[0-9a-f-]{36}$/i.test(url.pathname)) return record;
  try {
    const response = await fetch(url);
    if (!response.ok) return record;
    const contentType = ((response.headers.get("content-type") || "").split(";", 1)[0] || "").toLocaleLowerCase();
    const cover = bytesToCover(new Uint8Array(await response.arrayBuffer()), contentType);
    const id = url.pathname.split("/").at(-1) || "";
    return { ...record, cover, coverRef: { id, url: record.cover, contentType, size: coverBytes(cover)?.bytes.byteLength } };
  } catch { return record; }
}

function groupedSize(items: any[]) { return new Set(items.map((item) => `${item.entity}:${item.id}`)).size; }

export async function scheduleSync() {
  const settings = await syncSettings();
  if (typeof chrome !== "undefined" && chrome.alarms) {
    await chrome.alarms.clear("private-bookmarks-sync");
    if (settings.enabled) chrome.alarms.create("private-bookmarks-sync", { periodInMinutes: settings.intervalMinutes });
  }
  return settings;
}

export async function stopSync() { if (typeof chrome !== "undefined" && chrome.alarms) await chrome.alarms.clear("private-bookmarks-sync"); }
