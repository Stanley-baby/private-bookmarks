import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api, connect, connection, disconnect } from "../../extension/api.js";
import { changePin, disablePin, enablePin, forgetPin, lockNow, lockState, prepareLock, setAutoLock, startLockMonitor, unlock } from "../../extension/lock.js";
import { configureWebdav, createWebdavBackup, listBackups, restoreWebdavBackup } from "../backup/webdav";
import { applyMigrationPackage, batchBookmarks, exportLibrary, exportMigrationPackage, getActionMode, importLibrary, importMigrationPackage, initialize, initialized, listBookmarks, listCollections, listConflicts, previewMigrationPackage, resolveConflict, restoreBookmark, saveBookmark, saveBookmarkWithCollection, saveCollection, setSyncSettings, syncSettings, trashBookmark, webdavSettings, type ActionMode, type Bookmark, type BookmarkBatchAction, type BookmarkConflictChoices, type Collection } from "../local/db";
import { syncOnce } from "../local/sync";
import { BOOKMARK_CONFLICT_FIELDS, fileToCover, mergeBookmarkConflict } from "../local/model.js";
import { recommendBookmark } from "../../extension/recommendations.js";
import "./styles.css";

declare const chrome: any;
type Surface = "popup" | "sidepanel" | "library" | "welcome";
const surface = (): Surface => ["popup", "sidepanel", "welcome"].includes(document.body.dataset.surface || "") ? document.body.dataset.surface as Surface : "library";
type LockStatus = Awaited<ReturnType<typeof lockState>>;
type Connection = { endpoint: string; key: string };
type AiSuggestion = {
  collectionId?: string | null;
  newCollection?: { name: string; parentId: string | null } | null;
  tags?: string[];
  note?: string;
};
const AUTO_LOCK_OPTIONS = [["open", "每次打开"], ["1", "1 分钟"], ["5", "5 分钟"], ["15", "15 分钟"], ["30", "30 分钟"], ["60", "1 小时"], ["never", "从不"]] as const;

async function updateActionMode(mode: ActionMode) {
  const response = await chrome.runtime.sendMessage({ type: "private-bookmarks-set-action-mode", mode });
  if (response?.error) throw new Error(response.error);
  return mode;
}

function download(value: unknown, name = `private-bookmarks-${new Date().toISOString().slice(0, 10)}.json`) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

function Setup({ done }: { done: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); done(); } catch (reason) { setError(reason instanceof Error ? reason.message : "初始化失败"); } finally { setBusy(false); } };
  const cloud = () => run(async () => { if (!await connection()) throw new TypeError("尚未配置 Cloudflare 实例"); const [backup, boot] = await Promise.all([api("/v1/export"), api("/v1/bootstrap")]); await importLibrary({ ...backup, collections: backup.collections || boot.collections || [] }); });
  return <main className="setup"><div className="brand"><span className="brand-mark">◆</span><strong>私有书签</strong></div><h1>建立本地资料库</h1><p className="muted">无需后端也能使用。</p><div className="setup-actions"><button className="primary" disabled={busy} onClick={() => run(initialize)}>创建空资料库</button><label className="file-button">从备份恢复<input type="file" accept="application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) run(async () => importLibrary(JSON.parse(await file.text()))); }} /></label><label className="file-button">导入迁移包<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) run(async () => importMigrationPackage(await file.text())); }} /></label><button disabled={busy} onClick={cloud}>从 Cloudflare 导入</button></div>{error && <p className="error">{error}</p>}</main>;
}

function MigrationTransfer({ onApplied }: { onApplied: () => Promise<void> }) {
  const [value, setValue] = useState(""), [preview, setPreview] = useState<any>(null), [result, setResult] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const prepare = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const text = await file.text();
      setValue(text);
      setPreview(await previewMigrationPackage(text, { includeCurrent: true }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法解析迁移包"); }
    finally { setBusy(false); }
  };
  const apply = async (mode: "import" | "replace" | "merge" | "cancel") => {
    if (!value || busy) return;
    if (mode === "replace" && !window.confirm("替换会覆盖当前资料库，执行前会创建安全快照。继续吗？")) return;
    setBusy(true); setError("");
    try {
      const next = await applyMigrationPackage(value, mode);
      setResult(next);
      if (next.status === "applied") await onApplied();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "迁移失败"); }
    finally { setBusy(false); }
  };
  const counts = preview?.recordCounts || {}, currentCounts = preview?.current?.recordCounts || {};
  return <section className="migration-transfer" aria-label="迁移资料库"><div className="migration-transfer-actions"><button onClick={async () => download(await exportMigrationPackage(), "private-bookmarks-migration.json")}>导出迁移包</button><label className="file-button">选择迁移包<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => prepare(event.target.files?.[0])} /></label></div>{preview && <div className="migration-preview"><strong>迁移预览</strong><span>来源：{preview.source?.extensionId || "未知"} · {preview.source?.extensionVersion || "未知"} · 格式 v{preview.version}</span><code>{preview.checksum}</code><span>来源：书签 {counts.bookmarks || 0} · 收藏夹 {counts.collections || 0} · 设置类别 {counts.settings || 0} · 待同步 {preview.outboxCount || 0} · 冲突 {preview.conflictsCount || 0} · tombstone {counts.tombstones || 0}</span><span>当前：书签 {currentCounts.bookmarks || 0} · 收藏夹 {currentCounts.collections || 0} · 待同步 {preview.current?.outboxCount || 0} · 冲突 {preview.current?.conflictsCount || 0}</span><span>设置：{(preview.settingsCategories || []).join("、") || "无"}</span><div className="migration-transfer-actions"><button disabled={busy} onClick={() => apply("import")}>导入</button><button disabled={busy} onClick={() => apply("replace")}>替换</button><button disabled={busy} onClick={() => apply("merge")}>合并</button><button disabled={busy} onClick={() => apply("cancel")}>取消</button></div></div>}{result && <p className="migration-result" role="status">结果：{result.status === "applied" ? `已${result.mode === "merge" ? "合并" : result.mode === "import" ? "导入" : "替换"}` : result.status === "cancelled" ? "已取消" : result.status === "rolled_back" ? "失败，已回滚" : `已拒绝${result.reason === "library_not_empty" ? "（当前资料库非空）" : ""}`}{result.safetySnapshot && <button type="button" onClick={() => download(result.safetySnapshot, "private-bookmarks-pre-replace-safety.json")}>下载安全快照</button>}</p>}{error && <p className="error" role="alert">{error}</p>}</section>;
}

function Welcome() {
  const [selected, setSelected] = useState<ActionMode>("popup"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { getActionMode().then((mode) => mode && setSelected(mode)).catch(() => {}); }, []);
  const continueToLibrary = async () => {
    setBusy(true); setError("");
    try { await updateActionMode(selected); window.location.href = chrome.runtime.getURL("library.html"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); setBusy(false); }
  };
  const preview = (mode: ActionMode) => <div className={`welcome-preview welcome-preview-${mode}`} aria-hidden="true"><div className="welcome-preview-bar"><span /><span /><span /></div><div className="welcome-preview-content"><strong>{mode === "popup" ? "快速保存" : "完整浏览"}</strong><i /><i /><i /></div></div>;
  return <main className="welcome"><div className="brand"><span className="brand-mark">◆</span><strong>私有书签</strong></div><h1>选择打开方式</h1><p className="muted">点击扩展图标时，选择最适合你的工作区。</p><div className="welcome-choices"><button className={`welcome-choice ${selected === "popup" ? "selected" : ""}`} aria-pressed={selected === "popup"} onClick={() => setSelected("popup")}>{preview("popup")}<strong>弹出窗口</strong><span>适合快速保存当前页面。</span></button><button className={`welcome-choice ${selected === "sidepanel" ? "selected" : ""}`} aria-pressed={selected === "sidepanel"} onClick={() => setSelected("sidepanel")}>{preview("sidepanel")}<strong>侧边栏</strong><span>固定在浏览器旁，方便整理书签。</span></button></div><button className="primary welcome-continue" disabled={busy} onClick={continueToLibrary}>{busy ? "正在保存…" : "开始使用"}</button>{error && <p className="error">{error}</p>}<p className="welcome-library">资料库始终可以通过 <a href={chrome.runtime.getURL("library.html")}>library.html</a> 打开。</p></main>;
}

function LockScreen({ onUnlocked }: { onUnlocked: (status: LockStatus) => void }) {
  const [pin, setPin] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await unlock(pin); onUnlocked(await lockState()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "解锁失败"); setPin(""); }
    finally { setBusy(false); }
  };
  const forgot = async () => {
    if (!window.confirm("忘记 PIN 将仅清除应用锁，书签和 Cloudflare 连接会保留。继续吗？")) return;
    await forgetPin(); onUnlocked(await lockState());
  };
  return <main className="lock-screen"><section className="lock-card" aria-labelledby="lock-title"><div className="brand"><span className="brand-mark">◆</span><strong>私有书签</strong></div><h1 id="lock-title">应用已锁定</h1><p className="muted">输入 6–12 位数字 PIN 以查看书签。</p><form onSubmit={submit}><label>PIN 码<input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" autoComplete="current-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required autoFocus /></label><button className="primary" disabled={busy}>{busy ? "验证中…" : "解锁"}</button>{error && <p className="error" role="alert">{error}</p>}</form><button type="button" className="text-button" onClick={forgot}>忘记 PIN？</button></section></main>;
}

function LockSettings({ status, onChange }: { status: LockStatus; onChange: (status: LockStatus) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pin, setPin] = useState(""), [nextPin, setNextPin] = useState(""), [confirm, setConfirm] = useState("");
  const [autoLock, setAutoLockState] = useState(status.autoLock || "15");
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); onChange(await lockState()); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); } };
  const select = <select value={autoLock} aria-label="自动锁定" onChange={(event) => { const value = event.target.value; setAutoLockState(value); if (status.enabled) run(() => setAutoLock(value)); }}>{AUTO_LOCK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  if (!status.enabled) return <section className="lock-settings"><h2>应用锁</h2><p className="muted">保护此扩展的界面，不会暂停后台同步。</p><form onSubmit={(event) => { event.preventDefault(); if (pin !== confirm) return setError("两次输入的 PIN 不一致"); run(() => enablePin(pin, autoLock)); }}><label>设置 PIN（6–12 位数字）<input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required /></label><label>再次输入 PIN<input value={confirm} onChange={(event) => setConfirm(event.target.value)} type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required /></label><label>自动锁定{select}</label><button className="primary" disabled={busy}>启用应用锁</button></form>{error && <p className="error" role="alert">{error}</p>}</section>;
  return <section className="lock-settings"><h2>应用锁</h2><p className="muted">PIN 仅保护界面，后台 Cloudflare 同步和 WebDAV 定时任务会继续运行。</p><label>自动锁定{select}</label><div className="lock-settings-actions"><button type="button" onClick={() => run(lockNow)}>立即锁定</button><button type="button" onClick={() => { setPin(""); setNextPin(""); setConfirm(""); setError(""); }}>更改或关闭 PIN</button></div><form onSubmit={(event) => { event.preventDefault(); if (nextPin !== confirm) return setError("两次输入的新 PIN 不一致"); run(() => changePin(pin, nextPin)); }}><h3>更改 PIN</h3><label>当前 PIN<input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" autoComplete="current-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required /></label><label>新 PIN<input value={nextPin} onChange={(event) => setNextPin(event.target.value)} type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required /></label><label>再次输入新 PIN<input value={confirm} onChange={(event) => setConfirm(event.target.value)} type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" required /></label><div className="lock-settings-actions"><button className="primary" disabled={busy}>更改 PIN</button><button type="button" className="danger" disabled={busy} onClick={() => run(() => disablePin(pin))}>关闭应用锁</button></div></form>{error && <p className="error" role="alert">{error}</p>}</section>;
}

function AdvancedSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [endpoint, setEndpoint] = useState(""), [key, setKey] = useState(""), [connected, setConnected] = useState<Connection | null>(null);
  const [bootstrap, setBootstrap] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [provider, setProvider] = useState("cloudflare"), [model, setModel] = useState(""), [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1"), [externalModel, setExternalModel] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState(""), [clearApiKey, setClearApiKey] = useState(false), [prompt, setPrompt] = useState(""), [maxTokens, setMaxTokens] = useState(300), [thinkingEnabled, setThinkingEnabled] = useState(false);

  const syncAiFields = (boot: any) => {
    const ai = boot?.ai || {};
    setProvider(ai.provider || "cloudflare"); setModel(ai.model || ""); setBaseUrl(ai.baseUrl || "https://api.openai.com/v1"); setExternalModel(ai.externalModel || "gpt-4o-mini");
    setPrompt(ai.prompt || ""); setMaxTokens(Number(ai.maxTokens) || 300); setThinkingEnabled(Boolean(ai.thinkingEnabled)); setApiKey(""); setClearApiKey(false);
  };
  const notify = (nextConnection: Connection | null, nextBootstrap: any, nextError = "") => {
    setConnected(nextConnection); setBootstrap(nextBootstrap); setError(nextError);
  };
  const load = async () => {
    setBusy(true); setError("");
    try {
      const current = await connection();
      if (!current) { notify(null, null); return; }
      setEndpoint(current.endpoint); setKey(current.key);
      const boot = await api("/v1/bootstrap"); syncAiFields(boot); notify(current, boot);
    } catch (reason) {
      notify(await connection().catch(() => null), null, reason instanceof Error ? reason.message : "无法加载 Cloudflare 设置");
    } finally { setBusy(false); }
  };
  useEffect(() => { if (open) load(); }, [open]);
  if (!open) return null;
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); } };
  const saveConnection = () => run(async () => { const value = await connect(endpoint, key); const boot = await api("/v1/bootstrap"); syncAiFields(boot); notify(value, boot); });
  const removeConnection = () => run(async () => { await disconnect(); setEndpoint(""); setKey(""); notify(null, null); });
  const saveAi = () => run(async () => {
    if (!bootstrap?.preferences || !connected) throw new TypeError("请先连接私有实例");
    const response = await api("/v1/ai/settings", {
      method: "PATCH",
      body: JSON.stringify({ revision: bootstrap.preferences.revision, settings: { provider, model, baseUrl, externalModel, thinkingEnabled, maxTokens: Number(maxTokens), prompt }, apiKey: apiKey.trim() || null, clearApiKey: provider === "openai" && clearApiKey }),
    });
    const next = { ...bootstrap, preferences: response.preferences, ai: response.ai, capabilities: { ...bootstrap.capabilities, aiRecommendations: Boolean(response.ai?.available) } };
    syncAiFields(next); notify(connected, next);
  });
  const ai = bootstrap?.ai || {};
  const models = Array.isArray(ai.models) ? ai.models : [];
  return <dialog open className="advanced-dialog" aria-labelledby="advanced-title"><form onSubmit={(event) => event.preventDefault()}><header><h2 id="advanced-title">AI / 高级设置</h2><button type="button" onClick={onClose} aria-label="关闭">×</button></header><section className="advanced-section"><h3>Cloudflare 连接</h3><label>实例地址<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.workers.dev" /></label><label>访问密钥<input value={key} onChange={(event) => setKey(event.target.value)} type="password" autoComplete="off" placeholder="访问密钥" /></label><div className="advanced-actions"><button type="button" className="primary" disabled={busy || !endpoint || !key} onClick={saveConnection}>{connected ? "重新连接" : "连接"}</button>{connected && <button type="button" disabled={busy} onClick={removeConnection}>断开</button>}</div>{connected && <p className="muted">已连接：{connected.endpoint}</p>}</section><section className="advanced-section"><h3>AI 推荐（可选）</h3>{!connected && <p className="muted">连接私有实例后可加载和编辑 AI 设置；本地书签始终可以离线使用。</p>}{connected && !bootstrap && <p className="muted">正在加载 AI 能力…</p>}{connected && bootstrap && <><label>提供商<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="cloudflare">Cloudflare Workers AI</option><option value="openai">外部 OpenAI 兼容 API</option></select></label>{provider === "cloudflare" && <><label>模型<select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item: any) => <option key={item.id} value={item.id}>{item.free ? "免费额度 · " : ""}{item.label || item.id}</option>)}{!models.length && <option value={model}>{model || "Worker 默认模型"}</option>}</select></label><label className="check-row"><input type="checkbox" checked={thinkingEnabled} onChange={(event) => setThinkingEnabled(event.target.checked)} />启用思考模式</label></>}{provider === "openai" && <><label>API 地址<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label>模型<input value={externalModel} onChange={(event) => setExternalModel(event.target.value)} /></label><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={ai.apiKeyConfigured ? "已配置，留空保持不变" : "输入 API Key"} /></label>{ai.apiKeyConfigured && <label className="check-row"><input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />清除已保存的 API Key</label>}</>}<label>最大输出 tokens<input type="number" min="128" max="4096" step="1" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label><label>Prompt<textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><p className="muted">{ai.available ? "AI 推荐可用。" : "AI 推荐当前不可用；这是可选功能，不会阻止本地使用。"}</p><button type="button" className="primary" disabled={busy} onClick={saveAi}>保存 AI 设置</button></>}</section>{error && <p className="error" role="alert">{error}</p>}</form></dialog>;
}

function recommendationCollectionName(id: string | null | undefined, collections: Collection[]) {
  if (!id || id === "unsorted") return "未分类";
  const item = collections.find((value) => value.id === id);
  return item?.name || "未分类";
}

function Editor({ item, collections, contextItems, close }: { item?: Bookmark; collections: Collection[]; contextItems: Bookmark[]; close: (saved: boolean) => void }) {
  const [cover, setCover] = useState(item?.cover || "");
  const [coverError, setCoverError] = useState("");
  const [link, setLink] = useState(item?.link || ""), [title, setTitle] = useState(item?.title || ""), [description, setDescription] = useState(item?.description || ""), [note, setNote] = useState(item?.note || "");
  const [collectionId, setCollectionId] = useState(item?.collectionId || "unsorted"), [tags, setTags] = useState((item?.tags || []).join(", "));
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null), [suggestionMode, setSuggestionMode] = useState<"local" | "ai">("local"), [suggestionBusy, setSuggestionBusy] = useState(false), [suggestionNotice, setSuggestionNotice] = useState("");
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const tagValues = () => tags.split(",").map((value) => value.trim()).filter(Boolean);
  const input = () => ({ link, title, description, note, collectionId, tags: tagValues() });
  useEffect(() => {
    let active = true;
    connection().then(async (value) => { if (!value) return; const boot = await api("/v1/bootstrap"); if (active) setAiAvailable(Boolean(boot.capabilities?.aiRecommendations)); }).catch(() => { if (active) setAiAvailable(false); });
    return () => { active = false; };
  }, []);
  const local = () => recommendBookmark(input(), contextItems, collections, item?.id || "");
  const requestSuggestion = async (mode: "local" | "ai") => {
    setSuggestionBusy(true); setSuggestionNotice("");
    try {
      const localResult = local();
      if (mode === "local") { setSuggestion(localResult); setSuggestionMode("local"); return; }
      if (aiAvailable === false) throw new TypeError("AI 推荐不可用（可选），请在完整页面的 AI / 高级设置中配置");
      const config = await connection();
      if (!config) throw new TypeError("AI 推荐不可用（可选），请先连接私有实例");
      const boot = await api("/v1/bootstrap");
      if (!boot.capabilities?.aiRecommendations) throw new TypeError("AI 推荐不可用（可选），请在完整页面的 AI / 高级设置中配置");
      const context = contextItems.filter((value) => value.id !== item?.id).slice(0, 24).map((value) => ({ title: value.title, link: value.link, description: value.description, note: value.note, tags: value.tags.slice(0, 12), collectionId: value.collectionId || "unsorted" }));
      const remote = await api("/v1/ai/recommendations", { method: "POST", body: JSON.stringify({ ...input(), collections: collections.map(({ id, name, parentId }) => ({ id, name, parentId })), context }) });
      setSuggestion(remote); setSuggestionMode("ai"); setAiAvailable(true);
    } catch (reason) {
      setSuggestionNotice(reason instanceof Error ? reason.message : "AI 推荐不可用（可选）");
    } finally { setSuggestionBusy(false); }
  };
  const applySuggestion = async () => {
    if (!suggestion) return;
    if (!window.confirm("确认应用此建议？这会更新当前书签并同步到 Cloudflare（如已连接）。")) return;
    setSuggestionBusy(true); setCoverError("");
    try {
      let targetCollection = suggestion.collectionId || collectionId || "unsorted";
      let newCollection: (Partial<Collection> & { name: string }) | undefined;
      if (suggestion.newCollection?.name) {
        const parentId = suggestion.newCollection.parentId || null;
        const existing = collections.find((value) => value.parentId === parentId && value.name.trim().toLocaleLowerCase() === suggestion.newCollection!.name.trim().toLocaleLowerCase());
        targetCollection = existing?.id || crypto.randomUUID();
        if (!existing) newCollection = { id: targetCollection, name: suggestion.newCollection.name.trim(), parentId };
      }
      const nextTags = [...tagValues(), ...(suggestion.tags || [])].filter((value, index, all) => all.findIndex((entry) => entry.toLocaleLowerCase() === value.toLocaleLowerCase()) === index);
      await saveBookmarkWithCollection({ id: item?.id, link, title, description, note: suggestion.note || note, collectionId: targetCollection, tags: nextTags, cover }, newCollection);
      close(true);
    } catch (reason) {
      setCoverError(reason instanceof Error ? reason.message : "应用建议失败");
    } finally { setSuggestionBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setCoverError("");
    try { await saveBookmark({ id: item?.id, link, title, description, note, collectionId, tags: tagValues(), cover }); close(true); }
    catch (reason) { setCoverError(reason instanceof Error ? reason.message : "保存失败"); }
  };
  return <dialog open className="editor"><form onSubmit={save}><h2>{item ? "编辑书签" : "添加书签"}</h2><label>网址<input name="link" type="url" value={link} onChange={(event) => setLink(event.target.value)} required autoFocus /></label><label>标题<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>描述<textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>备注<textarea name="note" value={note} onChange={(event) => setNote(event.target.value)} /></label><label>收藏夹<select name="collectionId" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="unsorted">未分类</option>{collections.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>标签（逗号分隔）<input name="tags" value={tags} onChange={(event) => setTags(event.target.value)} /></label><label>自定义封面<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setCover(await fileToCover(file)); setCoverError(""); } catch (reason) { setCoverError(reason instanceof Error ? reason.message : "封面读取失败"); } }} />{cover && <><img className="editor-cover-preview" src={cover} alt="当前封面预览" /><button type="button" onClick={() => setCover("")}>移除封面</button></>}{coverError && <small className="error">{coverError}</small>}</label><section className="recommendation-box"><div className="recommendation-actions"><button type="button" disabled={suggestionBusy} onClick={() => requestSuggestion("local")}>本地建议</button><button type="button" disabled={suggestionBusy || aiAvailable === false} onClick={() => requestSuggestion("ai")}>AI 建议</button></div>{aiAvailable === false && <p className="muted">AI 推荐不可用（可选）；本地书签不受影响。</p>}{suggestionNotice && <p className="error">{suggestionNotice}</p>}{suggestion && <div className="recommendation-preview"><strong>{suggestionMode === "ai" ? "AI 建议预览" : "本地建议预览"}</strong>{suggestion.collectionId && <div>收藏夹：{recommendationCollectionName(suggestion.collectionId, collections)}</div>}{suggestion.newCollection?.name && <div>新收藏夹：{suggestion.newCollection.name}{suggestion.newCollection.parentId ? `（位于 ${recommendationCollectionName(suggestion.newCollection.parentId, collections)}）` : ""}</div>}{suggestion.tags?.length ? <div>标签：{suggestion.tags.join(", ")}</div> : null}{suggestion.note && <div>备注：{suggestion.note}</div>}<button type="button" className="primary" disabled={suggestionBusy} onClick={applySuggestion}>确认并应用</button></div>}</section><menu><button type="button" onClick={() => close(false)}>取消</button><button className="primary">保存</button></menu></form></dialog>;
}

function LibrarySidebar({
  collections,
  items,
  trash,
  collectionId,
  tag,
  chooseCollection,
  chooseTag,
  toggleTrash,
  createCollection,
}: {
  collections: Collection[];
  items: Bookmark[];
  trash: boolean;
  collectionId: string;
  tag: string;
  chooseCollection: (id: string) => void;
  chooseTag: (value: string) => void;
  toggleTrash: () => void;
  createCollection: () => void;
}) {
  const tags = [...new Set(items.flatMap((item) => item.tags).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const countFor = (id: string) => items.filter((item) => item.collectionId === id).length;
  const visibleCount = (id: string) => items.filter((item) => item.collectionId === id && !item.deletedAt).length;
  return <aside className="library-sidebar">
    <div className="sidebar-head"><div className="brand"><span className="brand-mark">◆</span><strong>私有书签</strong></div><button className="icon-button" onClick={createCollection} title="新建收藏夹" aria-label="新建收藏夹">＋</button></div>
    <nav className="sidebar-nav" aria-label="书签导航">
      <button className={`sidebar-item ${!trash && !collectionId && !tag ? "active" : ""}`} onClick={() => chooseCollection("")}><span>☁</span><span>所有书签</span><small>{items.length}</small></button>
      <button className={`sidebar-item ${!trash && collectionId === "unsorted" ? "active" : ""}`} onClick={() => chooseCollection("unsorted")}><span>▣</span><span>未分类</span><small>{visibleCount("unsorted")}</small></button>
      <button className={`sidebar-item ${trash ? "active" : ""}`} onClick={toggleTrash}><span>⌫</span><span>回收站</span><small>{trash ? items.length : ""}</small></button>
      <div className="sidebar-section"><div className="sidebar-label"><span>收藏</span><button onClick={createCollection} title="新建收藏夹" aria-label="新建收藏夹">＋</button></div>{collections.length ? collections.map((collection) => <button className={`sidebar-item ${!trash && collectionId === collection.id ? "active" : ""}`} key={collection.id} onClick={() => chooseCollection(collection.id)}><span>▱</span><span>{collection.name}</span><small>{countFor(collection.id)}</small></button>) : <p className="sidebar-empty">还没有收藏夹</p>}</div>
      <div className="sidebar-section"><div className="sidebar-label"><span>快速过滤</span></div><button className={`sidebar-item ${tag === "__notes__" ? "active" : ""}`} onClick={() => chooseTag("__notes__")}><span>▤</span><span>备注</span><small>{items.filter((item) => item.note).length}</small></button><button className={`sidebar-item ${tag === "__untagged__" ? "active" : ""}`} onClick={() => chooseTag("__untagged__")}><span>#</span><span>没有标签</span><small>{items.filter((item) => !item.tags.length).length}</small></button></div>
      {tags.length > 0 && <div className="sidebar-section"><div className="sidebar-label"><span>标签 ({tags.length})</span></div>{tags.map((value) => <button className={`sidebar-item ${tag === value ? "active" : ""}`} key={value} onClick={() => chooseTag(value)}><span>#</span><span>{value}</span><small>{items.filter((item) => item.tags.includes(value)).length}</small></button>)}</div>}
    </nav>
  </aside>;
}

function BatchControls({ selectedCount, visibleCount, allSelected, trash, collections, onSelectAll, onAction }: {
  selectedCount: number;
  visibleCount: number;
  allSelected: boolean;
  trash: boolean;
  collections: Collection[];
  onSelectAll: (checked: boolean) => void;
  onAction: (action: BookmarkBatchAction) => void;
}) {
  if (!visibleCount) return null;
  return <div className="batch-controls">
    <label className="batch-select-all"><input type="checkbox" checked={allSelected} onChange={(event) => onSelectAll(event.target.checked)} />全选当前页</label>
    {selectedCount > 0 && <><span className="batch-count">已选 {selectedCount}</span><select aria-label="批量移动到" value="" onChange={(event) => { if (event.target.value) onAction({ type: "move", collectionId: event.target.value }); }}><option value="">移动到…</option><option value="unsorted">未分类</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => { const value = prompt("添加标签（逗号分隔）"); if (value?.trim()) onAction({ type: "tags", mode: "add", tags: value.split(",") }); }}>添加标签</button><button onClick={() => { const value = prompt("移除标签（逗号分隔）"); if (value?.trim()) onAction({ type: "tags", mode: "remove", tags: value.split(",") }); }}>移除标签</button>{trash ? <><button onClick={() => onAction({ type: "restore" })}>恢复</button><button className="danger" onClick={() => { if (confirm("永久删除所选书签？此操作不可撤销。")) onAction({ type: "permanentDelete" }); }}>永久删除</button></> : <button className="danger" onClick={() => onAction({ type: "trash" })}>移到回收站</button>}</>}
  </div>;
}

const conflictFieldLabels: Record<string, string> = { title: "标题", link: "网址", description: "描述", note: "备注", tags: "标签", collectionId: "收藏夹" };
function conflictValue(value: unknown, field: string) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fieldValue = field === "link" ? record.link ?? record.url : record[field];
  if (field === "tags") return Array.isArray(fieldValue) ? (fieldValue.length ? fieldValue.join(", ") : "（无）") : "（无）";
  return fieldValue === undefined || fieldValue === null || fieldValue === "" ? "（空）" : String(fieldValue);
}

function ConflictMerge({ conflict, resolve }: { conflict: any; resolve: (key: string, choice: "local" | "cloud" | BookmarkConflictChoices) => Promise<void> }) {
  const isBookmark = conflict.entity === "bookmark";
  const fields = (isBookmark ? BOOKMARK_CONFLICT_FIELDS : []) as Array<keyof BookmarkConflictChoices>;
  const [choices, setChoices] = useState<BookmarkConflictChoices>(() => Object.fromEntries(fields.map((field) => [field, "local"])) as BookmarkConflictChoices);
  const [busy, setBusy] = useState(false);
  const local = conflict.local || {}, remote = conflict.remote || {};
  const preview = isBookmark ? mergeBookmarkConflict(local, remote, choices) : null;
  const finish = async (choice: "local" | "cloud" | BookmarkConflictChoices) => { setBusy(true); try { await resolve(conflict.key, choice); } finally { setBusy(false); } };
  if (!isBookmark) return <article className="conflict-card"><strong>{local.name || remote.name || conflict.id}</strong><div className="conflict-sides"><div><small>本地</small><span>{local.name || "（空）"}</span></div><div><small>云端</small><span>{remote.name || "（空）"}</span></div></div><div className="conflict-actions"><button disabled={busy} onClick={() => finish("local")}>保留本地</button><button disabled={busy} onClick={() => finish("cloud")}>采用云端</button></div></article>;
  return <article className="conflict-card"><header><strong>{local.title || remote.title || conflict.id}</strong><div className="conflict-actions"><button type="button" disabled={busy} onClick={() => finish("local")}>全本地</button><button type="button" disabled={busy} onClick={() => finish("cloud")}>全云端</button></div></header><div className="conflict-compare"><div className="conflict-column"><small>本地</small>{fields.map((field) => <div key={field}><b>{conflictFieldLabels[field]}</b><span>{conflictValue(local, field)}</span></div>)}</div><div className="conflict-column"><small>云端</small>{fields.map((field) => <div key={field}><b>{conflictFieldLabels[field]}</b><span>{conflictValue(remote, field)}</span></div>)}</div></div><div className="conflict-field-choices">{fields.map((field) => <label key={field}><span>{conflictFieldLabels[field]}</span><select value={choices[field] || "local"} onChange={(event) => setChoices({ ...choices, [field]: event.target.value as "local" | "cloud" })}><option value="local">本地</option><option value="cloud">云端</option></select></label>)}</div><div className="conflict-preview"><small>合并预览</small>{fields.map((field) => <div key={field}><b>{conflictFieldLabels[field]}</b><span>{conflictValue(preview, field)}</span></div>)}</div><button className="primary conflict-confirm" disabled={busy} onClick={() => finish(choices)}>确认合并</button></article>;
}

function ConflictCenter({ conflicts, kind, reload }: { conflicts: any[]; kind: Surface; reload: () => Promise<void> }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => { if (kind === "library" && new URLSearchParams(location.search).get("conflicts") === "1" && conflicts.length) section.current?.scrollIntoView({ block: "start" }); }, [kind, conflicts.length]);
  if (!conflicts.length) return null;
  const resolve = async (key: string, choice: "local" | "cloud" | BookmarkConflictChoices) => { await resolveConflict(key, choice); await reload(); };
  if (kind !== "library") return <section className="conflicts"><strong>{conflicts.length} 项同步冲突</strong><button className="primary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("library.html?conflicts=1") })}>在完整页面处理冲突</button></section>;
  return <section className="conflicts" ref={section}><strong>{conflicts.length} 项同步冲突</strong><div className="conflict-batch"><button onClick={async () => { for (const item of conflicts) await resolveConflict(item.key, "local"); await reload(); }}>全部保留本地</button><button onClick={async () => { for (const item of conflicts) await resolveConflict(item.key, "cloud"); await reload(); }}>全部采用云端</button></div>{conflicts.map((item) => <ConflictMerge key={item.key} conflict={item} resolve={resolve} />)}</section>;
}

function App({ kind }: { kind: Surface }) {
  const [ready, setReady] = useState<boolean | null>(null), [items, setItems] = useState<Bookmark[]>([]), [collections, setCollections] = useState<Collection[]>([]);
  const [lock, setLock] = useState<LockStatus | null>(null), [showLockSettings, setShowLockSettings] = useState(false);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<Bookmark | null | undefined>(), [selectedIds, setSelectedIds] = useState<string[]>([]), [trash, setTrash] = useState(false), [collectionId, setCollectionId] = useState(""), [tag, setTag] = useState(""), [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<any[]>([]), [syncConfig, setSyncConfig] = useState<any>({ enabled: false, intervalMinutes: 15 }), [syncing, setSyncing] = useState(false), [actionMode, setActionModeState] = useState<ActionMode>("popup");
  const [dav, setDav] = useState<any>({ enabled: false, endpoint: "", username: "", password: "", encryptionPassword: "", retention: 10 }), [davNames, setDavNames] = useState<string[]>([]), [showDav, setShowDav] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(() => new URLSearchParams(location.search).get("settings") === "ai");
  const load = async () => { try { setItems(await listBookmarks({ trash })); setCollections(await listCollections()); setConflicts(await listConflicts()); setSyncConfig(await syncSettings()); setDav(await webdavSettings()); const mode = await getActionMode(); if (mode) setActionModeState(mode); } catch (reason) { setError(reason instanceof Error ? reason.message : "加载失败"); } };
  useEffect(() => { prepareLock().then(() => lockState()).then(setLock).catch(() => setLock({ enabled: false, locked: false, autoLock: "15", cooldownUntil: 0 })); initialized().then(setReady); }, []);
  useEffect(() => { if (lock?.enabled) startLockMonitor(() => lockState().then(setLock)); }, [lock?.enabled]);
  useEffect(() => { if (ready && lock && !lock.locked) { load(); syncOnce().then(load).catch(() => {}); } }, [ready, lock?.locked, trash]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesCollection = !collectionId || item.collectionId === collectionId;
      const matchesTag = !tag || (tag === "__notes__" ? Boolean(item.note) : tag === "__untagged__" ? item.tags.length === 0 : item.tags.includes(tag));
      const haystack = [item.title, item.link, item.description, item.note, item.tags.join(" "), collections.find((c) => c.id === item.collectionId)?.name].join(" ").toLocaleLowerCase();
      return matchesCollection && matchesTag && (!needle || haystack.includes(needle));
    });
  }, [items, collections, query, collectionId, tag]);
  useEffect(() => { const visibleIds = new Set(visible.map((item) => item.id)); setSelectedIds((ids) => { const next = ids.filter((id) => visibleIds.has(id)); return next.length === ids.length ? ids : next; }); }, [visible]);
  const davAction = async (action: () => Promise<any>) => { try { setError(""); await action(); setDavNames((await webdavSettings()).enabled ? await listBackups() : []); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "WebDAV操作失败"); } };
  const chooseCollection = (value: string) => { setCollectionId(value); setTag(""); setTrash(false); setSelectedIds([]); };
  const chooseTag = (value: string) => { setTag(value); setCollectionId(""); setTrash(false); setSelectedIds([]); };
  const toggleTrash = () => { setTrash((value) => !value); setCollectionId(""); setTag(""); setSelectedIds([]); };
  const applyBatch = async (action: BookmarkBatchAction) => { try { setError(""); await batchBookmarks(selectedIds, action); setSelectedIds([]); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "批量操作失败"); } };
  const selectAll = (checked: boolean) => setSelectedIds(checked ? visible.map((item) => item.id) : []);
  const createCollection = async () => { const name = prompt("收藏夹名称"); if (name?.trim()) { await saveCollection({ name: name.trim() }); await load(); } };
  if (lock?.enabled && lock.locked) return <LockScreen onUnlocked={setLock} />;
  if (ready === false) return <Setup done={() => setReady(true)} />;
  if (ready === null) return <p className="empty">正在打开本地资料库…</p>;

  return <main className={`app app-${kind}`}>
    {kind === "library" && <LibrarySidebar collections={collections} items={items} trash={trash} collectionId={collectionId} tag={tag} chooseCollection={chooseCollection} chooseTag={chooseTag} toggleTrash={toggleTrash} createCollection={createCollection} />}
    <section className="app-main">
    <header className="app-header"><div className="app-heading">{kind === "library" ? <><span className="heading-icon">{trash ? "⌫" : "☁"}</span><strong>{trash ? "回收站" : collectionId ? collections.find((item) => item.id === collectionId)?.name || "收藏夹" : tag && !tag.startsWith("__") ? `#${tag}` : tag === "__notes__" ? "备注" : tag === "__untagged__" ? "没有标签" : "所有书签"}</strong></> : <div className="brand"><span className="brand-mark">◆</span><strong>私有书签</strong></div>}</div><div className="header-actions">{kind !== "library" && <button onClick={toggleTrash}>{trash ? "返回书签" : "回收站"}</button>}{kind !== "library" && <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") })}>完整页面</button>}{kind !== "library" && <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("library.html?settings=ai") })}>AI / 高级设置</button>}{kind === "library" && <button onClick={() => setShowAdvanced(true)}>AI / 高级设置</button>}{kind === "popup" && <button onClick={() => chrome.runtime.sendMessage({ type: "private-bookmarks-save-current" }).then(load)}>保存当前页</button>}<button className="primary" onClick={() => setSelected(null)}>＋ 添加</button></div></header>
    <section className="toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label><span className="count">{visible.length} 个书签</span></section>
    <BatchControls selectedCount={selectedIds.length} visibleCount={visible.length} allSelected={visible.length > 0 && selectedIds.length === visible.length} trash={trash} collections={collections} onSelectAll={selectAll} onAction={applyBatch} />
    <div className="local-tools"><button onClick={createCollection}>新建收藏夹</button><button onClick={async () => download(await exportLibrary())}>导出</button><label className="file-button">导入<input type="file" accept="application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { await importLibrary(JSON.parse(await file.text())); load(); } }} /></label><MigrationTransfer onApplied={load} /><label className="action-mode-setting">操作模式<select value={actionMode} onChange={async (event) => { const mode = event.target.value as ActionMode; try { await updateActionMode(mode); setActionModeState(mode); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存操作模式失败"); } }}><option value="popup">弹出窗口</option><option value="sidepanel">侧边栏</option></select></label><label className="sync-toggle"><input type="checkbox" checked={syncConfig.enabled} onChange={async (event) => { const settings = await setSyncSettings({ enabled: event.target.checked }); setSyncConfig(settings); await chrome.runtime.sendMessage({ type: "private-bookmarks-sync-settings", settings }); }} />Cloudflare 同步</label><input className="sync-interval" type="number" min="1" value={syncConfig.intervalMinutes} aria-label="同步间隔（分钟）" onChange={async (event) => setSyncConfig(await setSyncSettings({ intervalMinutes: Math.max(1, Number(event.target.value) || 15) }))} /><button disabled={!syncConfig.enabled || syncing} onClick={async () => { setSyncing(true); try { await syncOnce(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "同步失败"); } finally { setSyncing(false); } }}>{syncing ? "同步中…" : "立即同步"}</button><button onClick={async () => { setShowDav(!showDav); if (!showDav && dav.enabled) setDavNames(await listBackups().catch(() => [])); }}>WebDAV备份</button>{lock && <button onClick={() => setShowLockSettings((value) => !value)}>{lock.enabled ? "应用锁" : "启用应用锁"}</button>}</div>
    {lock && showLockSettings && <LockSettings status={lock} onChange={setLock} />}
    {showDav && <section className="webdav"><label><input type="checkbox" checked={dav.enabled} onChange={(event) => setDav({ ...dav, enabled: event.target.checked })} />启用WebDAV</label><label>地址<input value={dav.endpoint} onChange={(event) => setDav({ ...dav, endpoint: event.target.value })} placeholder="https://dav.example.com/path" /></label><label>用户名<input value={dav.username} onChange={(event) => setDav({ ...dav, username: event.target.value })} /></label><label>密码<input type="password" value={dav.password} onChange={(event) => setDav({ ...dav, password: event.target.value })} /></label><label>备份加密密码（可选）<input type="password" value={dav.encryptionPassword} onChange={(event) => setDav({ ...dav, encryptionPassword: event.target.value })} /></label><label>保留份数<input type="number" min="3" max="50" value={dav.retention} onChange={(event) => setDav({ ...dav, retention: Number(event.target.value) })} /></label><div className="webdav-actions"><button onClick={() => davAction(async () => { const url = new URL(dav.endpoint); if (!await chrome.permissions.request({ origins: [`${url.origin}/*`] })) throw new TypeError("未获得WebDAV站点权限"); setDav(await configureWebdav(dav)); })}>保存设置</button><button className="primary" disabled={!dav.enabled} onClick={() => davAction(() => createWebdavBackup(dav))}>立即备份</button></div>{dav.lastBackupAt && <small>上次备份：{new Date(dav.lastBackupAt).toLocaleString()}</small>}{davNames.map((name) => <div className="backup-row" key={name}><span>{name}</span><button onClick={() => davAction(async () => { const result = await restoreWebdavBackup(name, "merge", dav); download(result.safety, "pre-restore-safety.json"); })}>合并恢复</button><button onClick={() => davAction(async () => { if (!confirm("覆盖本地资料库？当前数据会先下载为安全快照。")) return; const result = await restoreWebdavBackup(name, "replace", dav); download(result.safety, "pre-restore-safety.json"); })}>覆盖恢复</button></div>)}</section>}
    <ConflictCenter conflicts={conflicts} kind={kind} reload={load} />
    {error && <p className="error">{error}</p>}
    <section className="bookmark-list">{visible.map((item, index) => <article className={`bookmark-card ${selectedIds.includes(item.id) ? "selected" : ""}`} key={item.id} style={{ "--stagger": Math.min(index, 12) } as CSSProperties}><label className="bookmark-select"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} aria-label={`选择 ${item.title || item.link}`} /></label><div className="bookmark-cover"><img src={item.cover || "icons/bookmark.svg"} alt="" /></div><div className="bookmark-card-body"><a className="bookmark-title" href={item.link} target="_blank" rel="noreferrer">{item.title || item.link}</a><div className="bookmark-details">{item.note || item.description || ""}</div><div className="bookmark-meta"><span>{collections.find((value) => value.id === item.collectionId)?.name || "未分类"}</span>{item.tags.map((value) => <button type="button" key={value} onClick={() => chooseTag(value)}>#{value}</button>)}</div><small className="bookmark-link">{item.link}</small><div className="card-actions">{trash ? <button onClick={async () => { await restoreBookmark(item.id); load(); }}>恢复</button> : <><button onClick={() => setSelected(item)}>编辑</button><button className="danger" onClick={async () => { await trashBookmark(item.id); load(); }}>删除</button></>}</div></div></article>)}</section>
    {!visible.length && <p className="empty">{trash ? "回收站为空" : "还没有书签"}</p>}{selected !== undefined && <Editor item={selected || undefined} collections={collections} contextItems={items} close={(saved) => { setSelected(undefined); if (saved) load(); }} />}{kind === "library" && <AdvancedSettings open={showAdvanced} onClose={() => setShowAdvanced(false)} />}
    </section>
  </main>;
}

const root = document.querySelector("#root");
if (root) { const kind = surface(); createRoot(root).render(kind === "welcome" ? <Welcome /> : <App kind={kind} />); }
