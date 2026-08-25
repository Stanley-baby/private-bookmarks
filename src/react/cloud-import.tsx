import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { importLibrary } from "../../extension/shared/local-db.js";
import { restoreLocalLibrary } from "../backup/recovery.js";
import { workerClient } from "../../extension/shared/worker-client.js";
import "./styles.css";

function download(value: unknown) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = "pre-restore-safety.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function CloudImport() {
  const [backup, setBackup] = useState<any>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    workerClient.connection().then(async (connection) => {
      if (!connection) throw new TypeError("请先在设置中连接 Cloudflare Worker");
      setBackup(await workerClient.request("/v1/export"));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "无法预览 Cloudflare 资料库")).finally(() => setBusy(false));
  }, []);
  const apply = async (mode: "import" | "replace" | "merge") => {
    if (!backup) return;
    setBusy(true); setError("");
    try {
      if (mode === "import") await importLibrary(backup);
      else download((await restoreLocalLibrary(backup, mode)).safety);
      location.href = "library.html";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); setBusy(false); }
  };
  return <main className="app"><header className="app-header"><div><h1>预览 Cloudflare 资料库</h1><p className="muted">写入前请选择导入方式；取消不会修改本地资料库。</p></div><button onClick={() => { location.href = "library.html"; }}>取消</button></header>{busy && <p role="status">正在加载预览…</p>}{error && <p className="error" role="alert">{error}</p>}{backup && <section className="advanced-section"><h2>导入预览</h2><p>{backup.bookmarks?.length || 0} 条书签 · {backup.collections?.length || 0} 个收藏夹</p><div className="advanced-actions"><button disabled={busy} onClick={() => apply("import")}>导入</button><button disabled={busy} onClick={() => apply("merge")}>合并</button><button className="primary" disabled={busy} onClick={() => apply("replace")}>覆盖</button></div></section>}</main>;
}

const root = document.querySelector("#root");
if (root) createRoot(root).render(<CloudImport />);
