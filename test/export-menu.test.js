import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("../extension/library.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/style.css", import.meta.url), "utf8");

test("collection and selection headers expose the four-format export menu", () => {
  assert.match(library, /function exportMenuMarkup\(sectionId\)/);
  assert.match(library, /item\("html"\).*item\("csv"\).*item\("txt"\).*item\("zip"\)/s);
  assert.match(library, /data-export-format/);
  assert.match(library, /如需下载上传的文件，请选择ZIP格式。/);
  assert.match(library, /const headerExportMarkup = !hasItems \? "" : exportMenuTriggerMarkup\(sectionId\)/);
  assert.match(library, /exportMenuTriggerMarkup\(sectionId, true(?:,\s*treeIcon\("download"\))?\)/);
  assert.match(library, /data-export-menu-trigger/);
  assert.match(library, /data-export-selection/);
  assert.match(css, /\.workspace-export-menu \{[^}]*position: fixed;[^}]*z-index: 7;[^}]*width: 252px;/s);
  assert.match(css, /\.workspace-export-menu button \{[^}]*width: 250px;[^}]*height: 28px;[^}]*padding: 0 16px;/s);
  assert.match(css, /\.workspace-export-tip \{[^}]*height: 36\.39px;[^}]*padding: 0 16px;[^}]*font-size: 13px;[^}]*line-height: 18\.2px;/s);
  assert.match(css, /\.workspace-export-menu-wrap, \.selection-export-wrap \{[^}]*flex: 0 0 auto;/);
  assert.match(css, /\.workspace-export-menu-wrap > \.export \{[^}]*width: 36px;[^}]*height: 28px;/);
  assert.match(css, /\.workspace-export-menu-wrap > \.export \{[^}]*grid-template-columns: 20px;/);
});

test("the unfiltered all-bookmarks header exposes the backup menu", () => {
  assert.match(library, /function backupExportMenuMarkup\(sectionId\)/);
  assert.match(library, /data-export-backup-action="\$\{action\}"/);
  assert.match(library, /item\("backup", "获取备份"\).*item\("uploads", "下载上传文件"\)/s);
  assert.match(library, /state\.view === "all" && !state\.collectionId && !state\.query\.trim\(\) && !state\.tag/);
  assert.match(library, /setSettingsRoute\(true, "backups"\)/);
  assert.match(library, /downloadExport\(backup, "zip"\)/);
  assert.match(library, /const headerExportMarkup = !hasItems \? "" : exportMenuTriggerMarkup\(sectionId\)/);
  assert.match(css, /\.workspace-backup-export-description \{[^}]*padding: 8px 16px;[^}]*font-size: 13px;[^}]*line-height: 18\.2px;/);
});

test("local export formats preserve the full-library JSON path", () => {
  assert.match(library, /\["id", "title", "note", "excerpt", "url", "tags", "created", "cover", "highlights", "favorite"\]/);
  assert.match(library, /function exportCsvCell\(value\)[\s\S]*replaceAll/);
  assert.match(library, /Array\.isArray\(item\.highlights\) && item\.highlights\.length \? JSON\.stringify\(item\.highlights\) : ""/);
  assert.match(library, /function exportTxt\(backup\)[\s\S]*item\.link/);
  assert.match(library, /Raindrop\.io Bookmarks[\s\S]*<DT><H3>Export<\/H3>/);
  assert.match(library, /DATA-COVER[\s\S]*DATA-IMPORTANT/);
  assert.match(library, /exportZipArchive\(\[[\s\S]*export\.csv[\s\S]*export\.html[\s\S]*export\.txt/);
  assert.match(library, /import \{ mediaArchiveEntries \} from "\.\/media-archive\.js"/);
  assert.match(library, /const media = await mediaArchiveEntries\(backup\)/);
  assert.match(library, /\.\.\.media/);
  assert.match(library, /function scopedBackup\(backup, collectionId, selectedIds = null\)/);
  assert.match(library, /collectionId === "all"/);
  assert.match(library, /new Blob\(\[JSON\.stringify\(backup, null, 2\)\], \{ type: "application\/json" \}\)/);
});
