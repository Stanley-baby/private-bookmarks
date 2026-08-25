import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { runRemoteRecovery } from "../backup/recovery.js";
import { workerClient } from "../../extension/shared/worker-client.js";
import "./styles.css";

type Backup = { id: string; name?: string; createdAt?: string; size?: number };
type Provider = { provider: string; configured: boolean; connected: boolean; accountEmail?: string };

const labels: Record<string, string> = { dropbox: "Dropbox", google: "Google Drive", onedrive: "OneDrive" };

function download(value: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(value);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function CloudBackups() {
  const [providers, setProviders] = useState<Provider[]>([]), [r2Backups, setR2Backups] = useState<Backup[]>([]), [cloudBackups, setCloudBackups] = useState<Record<string, Backup[]>>({});
  const [r2Available, setR2Available] = useState(false), [includeMedia, setIncludeMedia] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [ready, setReady] = useState(false);

  const refreshR2 = async () => setR2Backups(await workerClient.request("/v1/backups"));
  const refreshProvider = async (provider: string) => {
    const result = await workerClient.request(`/v1/cloud/${provider}/backups`);
    setCloudBackups((value) => ({ ...value, [provider]: result.backups || [] }));
  };
  const load = async () => {
    setBusy(true); setError("");
    try {
      if (!await workerClient.connection()) throw new TypeError("请先在设置中连接 Cloudflare Worker");
      const bootstrap = await workerClient.request("/v1/bootstrap");
      const nextProviders = Array.isArray(bootstrap.cloudConnections) ? bootstrap.cloudConnections : [];
      setProviders(nextProviders); setR2Available(Boolean(bootstrap.capabilities?.cloudBackup));
      if (bootstrap.capabilities?.cloudBackup) await refreshR2(); else setR2Backups([]);
      await Promise.all(nextProviders.filter((item: Provider) => item.connected).map((item: Provider) => refreshProvider(item.provider)));
      setReady(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载云端备份"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); }
  };
  const backupActions = (scope: "r2" | string, backup: Backup) => {
    const restore = (mode: "replace" | "merge") => run(async () => {
      if (!window.confirm(`${mode === "replace" ? "覆盖" : "合并"}恢复会先创建安全快照。继续？`)) return;
      const path = scope === "r2" ? `/v1/backups/${backup.id}/restore` : `/v1/cloud/${scope}/backups/${encodeURIComponent(backup.id)}/restore`;
      const recovery = await runRemoteRecovery(() => workerClient.request(path, { method: "POST", body: JSON.stringify({ confirm: true, mode }) }));
      download(new Blob([JSON.stringify(recovery.safety, null, 2)], { type: "application/json" }), "pre-remote-restore-safety.json"); await load();
    });
    return <div className="backup-row" key={backup.id}><span>{backup.name || backup.id}{backup.createdAt ? ` · ${new Date(backup.createdAt).toLocaleString()}` : ""}</span><button disabled={busy} onClick={() => run(async () => {
      const path = scope === "r2" ? `/v1/backups/${backup.id}/download` : `/v1/cloud/${scope}/backups/${encodeURIComponent(backup.id)}/download`;
      const response = await workerClient.download(path); download(await response.blob(), backup.name?.replace(/\.pbk$/i, ".zip") || `private-bookmarks-${backup.id}.zip`);
    })}>下载</button><button disabled={busy} onClick={() => restore("merge")}>合并恢复</button><button disabled={busy} onClick={() => restore("replace")}>覆盖恢复</button><button className="danger" disabled={busy} onClick={() => run(async () => {
      if (!window.confirm("删除此备份？")) return;
      const path = scope === "r2" ? `/v1/backups/${backup.id}` : `/v1/cloud/${scope}/backups/${encodeURIComponent(backup.id)}`;
      await workerClient.request(path, { method: "DELETE" });
      if (scope === "r2") await refreshR2(); else await refreshProvider(scope);
    })}>删除</button></div>;
  };

  return <main className="app"><header className="app-header"><div><h1>云端备份</h1><p className="muted">备份与恢复始终在覆盖前创建安全快照。</p></div><button disabled={busy} onClick={load}>刷新</button></header>{error && <p className="error" role="alert">{error}</p>}{ready && <><section className="advanced-section"><h2>Cloudflare R2</h2><p className="muted">{r2Available ? "已配置" : "未配置；本地资料库保持可用。"}</p>{r2Available && <><label className="check-row"><input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} />包含媒体</label><button className="primary" disabled={busy} onClick={() => run(async () => { await workerClient.request("/v1/backups", { method: "POST", body: JSON.stringify({ includeMedia }) }); await refreshR2(); })}>创建备份</button>{r2Backups.map((backup) => backupActions("r2", backup))}</>}</section><section className="advanced-section"><h2>第三方云盘</h2>{providers.map((provider) => <article className="cloud-provider" key={provider.provider}><h3>{labels[provider.provider] || provider.provider}</h3><p className="muted">{provider.connected ? `已连接${provider.accountEmail ? `：${provider.accountEmail}` : ""}` : provider.configured ? "未连接" : "未配置；本地及其他 provider 不受影响。"}</p>{provider.configured && !provider.connected && <button disabled={busy} onClick={() => run(async () => { const result = await workerClient.request(`/v1/cloud/${provider.provider}/authorize`); window.open(result.authorizationUrl, "_blank", "noopener"); })}>连接</button>}{provider.connected && <><div className="advanced-actions"><button disabled={busy} onClick={() => run(() => refreshProvider(provider.provider))}>刷新备份</button><button className="primary" disabled={busy} onClick={() => run(async () => { await workerClient.request(`/v1/cloud/${provider.provider}/backups`, { method: "POST", body: JSON.stringify({ includeMedia }) }); await refreshProvider(provider.provider); })}>创建备份</button><button disabled={busy} onClick={() => run(async () => { await workerClient.request(`/v1/cloud/${provider.provider}/disconnect`, { method: "POST", body: "{}" }); await load(); })}>断开</button></div>{(cloudBackups[provider.provider] || []).map((backup) => backupActions(provider.provider, backup))}</>}</article>)}</section></>}</main>;
}

const root = document.querySelector("#root");
if (root) createRoot(root).render(<CloudBackups />);
