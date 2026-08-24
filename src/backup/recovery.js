import {
  exportLibrary,
  exportMigrationPackage,
  mergeLibrary,
  previewMigrationPackage,
  setRecoveryState,
  replaceLibrary,
  setSyncSettings,
  syncSettings,
} from "../../extension/shared/local-db.js";
import { scheduleSync, stopSync } from "../local/sync.ts";

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function records(value, name) {
  if (!Array.isArray(value?.[name])) throw new TypeError(`恢复数据缺少${name}`);
  return value[name];
}

export function validateRestoredLibrary(restored, backup, mode) {
  for (const name of ["bookmarks", "collections"]) {
    const current = records(restored, name);
    const incoming = records(backup, name);
    for (const item of current) {
      if (!item?.id || !Number.isFinite(Number(item.revision))) throw new TypeError(`恢复后的${name}无效`);
    }
    if (mode !== "replace") continue;
    for (const item of incoming) {
      const saved = current.find((value) => value.id === item.id);
      if (!saved || Number(saved.revision) !== Number(item.revision)) throw new TypeError(`恢复后的${name}未通过修订校验`);
      for (const field of ["deletedAt", "purgedAt", "permanentDeletedAt", "media", "coverRef"]) {
        if (field in item && !same(saved[field], item[field])) throw new TypeError(`恢复后的${name}未通过${field}校验`);
      }
    }
  }
  if (mode === "replace" && backup.preferences && !same(restored.preferences, { ...restored.preferences, ...backup.preferences })) throw new TypeError("恢复后的配置未通过校验");
  return restored;
}

function recoveryOperations(services) {
  return {
    exportLibrary,
    exportSafety: exportMigrationPackage,
    validateSafety: previewMigrationPackage,
    replaceLibrary,
    mergeLibrary,
    syncSettings,
    setSyncSettings,
    setRecoveryState,
    stopSync,
    scheduleSync,
    validateRestored: validateRestoredLibrary,
    ...services,
  };
}

export async function restoreLocalLibrary(backup, mode, services = {}) {
  if (mode !== "replace" && mode !== "merge") throw new TypeError("恢复模式无效");
  records(backup, "bookmarks");
  records(backup, "collections");
  const operations = recoveryOperations(services);
  const before = await operations.exportLibrary();
  const safety = await operations.exportSafety();
  await operations.validateSafety(safety);
  const settings = await operations.syncSettings();
  await operations.setRecoveryState(true);
  await operations.setSyncSettings({ ...settings, enabled: false });
  await operations.stopSync();
  let completed = false;
  let rolledBack = false;
  let resumed = false;
  try {
    if (mode === "replace") await operations.replaceLibrary(backup, { recovery: true });
    else await operations.mergeLibrary(backup, { recovery: true });
    const restored = await operations.exportLibrary();
    await operations.validateRestored(restored, backup, mode);
    await operations.setSyncSettings(settings);
    resumed = true;
    await operations.scheduleSync();
    completed = true;
    return { safety, restored };
  } catch (error) {
    if (resumed) {
      await operations.setSyncSettings({ ...settings, enabled: false });
      await operations.stopSync();
    }
    try { await operations.replaceLibrary(before, { recovery: true }); rolledBack = true; }
    catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    if (completed || rolledBack) await operations.setRecoveryState(false);
  }
}

export async function runRemoteRecovery(action, services = {}) {
  const operations = recoveryOperations(services);
  const safety = await operations.exportSafety();
  await operations.validateSafety(safety);
  const settings = await operations.syncSettings();
  await operations.setRecoveryState(true);
  await operations.setSyncSettings({ ...settings, enabled: false });
  await operations.stopSync();
  let resumed = false;
  try {
    const result = await action();
    await operations.setSyncSettings(settings);
    resumed = true;
    await operations.scheduleSync();
    await operations.setRecoveryState(false);
    return { safety, result };
  } catch (error) {
    if (resumed) {
      await operations.setSyncSettings({ ...settings, enabled: false });
      await operations.stopSync();
    }
    throw error;
  }
}
