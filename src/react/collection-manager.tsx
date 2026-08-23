import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { fileToCover } from "../../extension/shared/local-model.js";
import { COLLECTION_ICON_DEFAULT_CATALOG, fetchCollectionIconCatalog, readCollectionIconCache, writeCollectionIconCache } from "../../extension/collection-icon-catalog.js";
import { cleanEmptyCollections, mergeCollections, moveCollection, previewCollectionMerge, restoreCollection, saveCollection, shareCollection, sortCollections, trashCollection, updatePreferences, type Collection } from "../../extension/shared/local-db.js";
import { collectionGroupAssignments, collectionGroups } from "../../extension/shared/collection-model.js";
import { collectionPath } from "./collection-navigation.js";
import "./styles.css";

type IconGroup = { category: string; icons: Array<{ name: string; url: string }> };

type Props = {
  collections: Collection[];
 trashedCollections: Collection[];
  preferences: any;
  onChanged: () => Promise<void>;
  onPreferences: (value: any) => void;
  onError: (value: string) => void;
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "收藏夹操作失败";
}

export function CollectionIcon({ value }: { value?: string }) {
  const icon = String(value || "").trim();
  if (/^(?:https?:|data:image\/)/i.test(icon)) return <img className="collection-icon-image" src={icon} alt="" />;
  return <span className="collection-icon-value">{icon || "▱"}</span>;
}

export function CollectionManager(props: Props) {
  const { collections, trashedCollections, preferences, onChanged, onPreferences, onError } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const managerOpen = props.open ?? internalOpen;
  const setManagerOpen = (value: boolean) => { setInternalOpen(value); props.onOpenChange?.(value); };
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [shareText, setShareText] = useState("");
  const [iconTarget, setIconTarget] = useState<Collection | null>(null);
  const [iconQuery, setIconQuery] = useState("");
  const [catalog, setCatalog] = useState<IconGroup[]>(() => (readCollectionIconCache() || COLLECTION_ICON_DEFAULT_CATALOG) as IconGroup[]);
  const groups = collectionGroups(preferences) as Array<{ id: string; title: string; hidden: boolean }>;
  const assignments = collectionGroupAssignments(preferences) as Record<string, string>;
  const roots = useMemo(() => collections.filter((item) => item.id !== "unsorted" && !item.parentId), [collections]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    onError("");
    try { await action(); await onChanged(); }
    catch (reason) { onError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const saveGroupPreferences = async (changes: Record<string, unknown>) => {
    const result = await updatePreferences(Number(preferences?.revision) || 0, changes);
    if (result?.conflict) throw new Error("分组设置已被其他操作修改，请刷新后重试");
    onPreferences(result.preferences || result);
  };
  const createRoot = () => {
    const name = window.prompt("收藏夹名称", "新收藏夹")?.trim();
    if (name) run(() => saveCollection({ name, parentId: null }));
  };
  const createChild = (parent: Collection) => {
    const name = window.prompt("子收藏夹名称", "新收藏夹")?.trim();
    if (name) run(() => saveCollection({ name, parentId: parent.id }));
  };
  const rename = (item: Collection) => {
    const name = window.prompt("收藏夹名称", item.name)?.trim();
    if (name && name !== item.name) run(() => saveCollection({ ...item, name }, { expectedRevision: item.revision }));
  };
  const remove = (item: Collection) => {
    if (window.confirm("删除该收藏夹及其子树？书签会进入回收站，可恢复。")) run(() => trashCollection(item.id, item.revision));
  };
  const restore = (item: Collection) => run(() => restoreCollection(item.id, item.revision));
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const merge = async () => {
    if (selected.length < 2) return onError("至少选择两个收藏夹");
   const target = targetId || selected[0];
    if (!target) return onError("请选择合并目标");
    try {
      const preview = await previewCollectionMerge(selected, target);
      if (!window.confirm("将 " + preview.movedBookmarks + " 个书签和 " + preview.movedCollections + " 个子收藏夹合并到“" + (preview.target?.name || target) + "”？")) return;
      await run(() => mergeCollections(selected, target));
      setSelected([]);
      setTargetId("");
    } catch (reason) { onError(errorMessage(reason)); }
  };
  const drop = (target: Collection, event?: DragEvent<HTMLDivElement>) => {
    const id = draggedId;
    setDraggedId(null);
    if (!id || id === target.id) return;
    run(() => event?.shiftKey ? moveCollection(id, { targetId: target.id, before: true }) : moveCollection(id, { parentId: target.id }));
  };
  const share = async (item: Collection) => {
    try {
      const text = await shareCollection(item.id);
      if (!text) throw new Error("收藏夹不存在");
      setShareText(text);
      const shareApi = (navigator as any).share;
      if (typeof shareApi === "function") await shareApi.call(navigator, { title: item.name, text });
    } catch (reason) {
      if ((reason as any)?.name !== "AbortError") onError(errorMessage(reason));
    }
  };
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      onError("");
    } catch (reason) { onError(errorMessage(reason)); }
  };
  const chooseIcon = (item: Collection, value: string) => run(async () => {
    await saveCollection({ ...item, icon: value }, { expectedRevision: item.revision });
    setIconTarget(null);
  });
  const uploadIcon = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !iconTarget) return;
    run(async () => {
      await saveCollection({ ...iconTarget, icon: await fileToCover(file as any) }, { expectedRevision: iconTarget.revision });
      setIconTarget(null);
      event.currentTarget.value = "";
    });
  };
  const refreshIcons = () => run(async () => {
    const next = await fetchCollectionIconCatalog();
    writeCollectionIconCache(localStorage, next);
    setCatalog(next);
  });
  const addGroup = () => {
    const title = window.prompt("分组名称", "新分组")?.trim();
    if (!title) return;
    saveGroupPreferences({ collectionGroups: [...groups, { id: crypto.randomUUID(), title, hidden: false }] }).catch((reason) => onError(errorMessage(reason)));
  };
  const renameGroup = (group: { id: string; title: string; hidden: boolean }) => {
    const title = window.prompt("分组名称", group.title)?.trim();
    if (!title || title === group.title) return;
    saveGroupPreferences({ collectionGroups: groups.map((item) => item.id === group.id ? { ...item, title } : item) }).catch((reason) => onError(errorMessage(reason)));
  };
  const deleteGroup = (group: { id: string }) => {
    if (group.id === "default") return;
    if (!window.confirm("删除分组？收藏夹会移到默认分组。")) return;
    const nextGroups = groups.filter((item) => item.id !== group.id);
    const nextAssignments = Object.fromEntries(Object.entries(assignments).map(([id, value]) => [id, value === group.id ? "default" : value]));
    saveGroupPreferences({ collectionGroups: nextGroups.length ? nextGroups : [{ id: "default", title: "收藏", hidden: false }], collectionGroupByCollectionId: nextAssignments }).catch((reason) => onError(errorMessage(reason)));
  };
  const assignGroup = (id: string, groupId: string) => {
    saveGroupPreferences({ collectionGroupByCollectionId: { ...assignments, [id]: groupId } }).catch((reason) => onError(errorMessage(reason)));
  };
  const cleanup = () => {
    if (window.confirm("删除所有没有书签和子级内容的收藏夹？可在回收站恢复。")) run(cleanEmptyCollections);
  };
  const sort = () => {
    if (window.confirm("按名称排序所有收藏夹？")) run(sortCollections);
  };
  const filteredCatalog = catalog.map((group) => ({ ...group, icons: group.icons.filter((icon) => !iconQuery.trim() || (group.category + " " + icon.name).toLocaleLowerCase().includes(iconQuery.trim().toLocaleLowerCase())) })).filter((group) => group.icons.length);

  return <>
    <button type="button" onClick={() => setManagerOpen(true)}>整理收藏夹</button>
    {managerOpen && <dialog open className="collection-manager" aria-labelledby="collection-manager-title">
      <form onSubmit={(event) => event.preventDefault()}>
        <header><h2 id="collection-manager-title">整理收藏夹</h2><button type="button" onClick={() => setManagerOpen(false)} aria-label="关闭整理收藏夹">×</button></header>
        <div className="collection-manager-actions"><button type="button" className="primary" onClick={createRoot}>新建收藏夹</button><button type="button" onClick={addGroup}>新建分组</button><button type="button" onClick={sort} disabled={busy}>按名称排序</button><button type="button" onClick={cleanup} disabled={busy}>清理空收藏夹</button></div>
        <p className="muted">拖到另一个收藏夹上可调整层级；勾选两个或更多收藏夹后可合并。</p>
        <section className="collection-manager-list" aria-label="收藏夹列表">
          {collections.filter((item) => item.id !== "unsorted").map((item) => <div className="collection-manager-row" key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(item, event)}>
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} aria-label={"选择 " + collectionPath(collections, item.id)} />
            <CollectionIcon value={item.icon} /><strong style={{ paddingLeft: (item.parentId ? 16 : 0) }}>{collectionPath(collections, item.id)}</strong>
            <button type="button" onClick={() => createChild(item)}>新建子级</button><button type="button" onClick={() => rename(item)}>改名</button><button type="button" onClick={() => setIconTarget(item)}>图标</button><button type="button" onClick={() => share(item)}>分享</button><button type="button" className="danger" onClick={() => remove(item)}>删除</button>
          </div>)}
          {!collections.filter((item) => item.id !== "unsorted").length && <p className="empty">还没有收藏夹</p>}
        </section>
        {selected.length > 1 && <section className="collection-merge-controls"><strong>已选 {selected.length} 个</strong><select aria-label="合并目标" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">选择合并目标</option>{selected.map((id) => <option key={id} value={id}>{collections.find((item) => item.id === id)?.name}</option>)}</select><button type="button" className="primary" onClick={merge} disabled={busy}>预览并合并</button></section>}
        <section className="collection-group-manager" aria-label="收藏夹分组"><h3>分组</h3>{groups.map((group) => <div className="collection-group-row" key={group.id}><strong>{group.title}</strong><button type="button" onClick={() => renameGroup(group)}>改名</button>{group.id !== "default" && <button type="button" className="danger" onClick={() => deleteGroup(group)}>删除</button>}<div>{roots.filter((item) => (assignments[item.id] || "default") === group.id).map((item) => <span key={item.id}>{item.name}</span>)}</div></div>)}{roots.length > 0 && <div className="collection-group-assignments">{roots.map((item) => <label key={item.id}>{item.name}<select aria-label={item.name + "分组"} value={assignments[item.id] || "default"} onChange={(event) => assignGroup(item.id, event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>)}</div>}</section>
        {trashedCollections.length > 0 && <section className="collection-trash-manager" aria-label="已删除收藏夹"><h3>回收站中的收藏夹</h3>{trashedCollections.map((item) => <div key={item.id}><span>{item.name}</span><button type="button" onClick={() => restore(item)}>恢复</button></div>)}</section>}
      </form>
    </dialog>}
    {iconTarget && <dialog open className="collection-icon-dialog" aria-labelledby="collection-icon-title"><form onSubmit={(event) => event.preventDefault()}><header><h2 id="collection-icon-title">选择收藏夹图标</h2><button type="button" onClick={() => setIconTarget(null)} aria-label="关闭图标选择">×</button></header><div className="collection-icon-actions"><input placeholder="搜索图标…" value={iconQuery} onChange={(event) => setIconQuery(event.target.value)} aria-label="搜索图标" /><button type="button" onClick={refreshIcons} disabled={busy}>刷新图标目录</button><label className="file-button">上传图标<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml" onChange={uploadIcon} /></label><button type="button" onClick={() => chooseIcon(iconTarget, "")}>删除图标</button></div><div className="collection-icon-grid">{filteredCatalog.map((group) => <section key={group.category}><h3>{group.category}</h3><div>{group.icons.map((icon) => <button type="button" key={icon.url} title={icon.name} aria-label={group.category + " " + icon.name} onClick={() => chooseIcon(iconTarget, icon.url)}><img src={icon.url} alt="" /></button>)}</div></section>)}</div></form></dialog>}
    {shareText && <dialog open className="collection-share-dialog" aria-labelledby="collection-share-title"><form onSubmit={(event) => event.preventDefault()}><header><h2 id="collection-share-title">分享收藏夹</h2><button type="button" onClick={() => setShareText("")} aria-label="关闭分享">×</button></header><textarea readOnly value={shareText} aria-label="收藏夹分享内容" /><button type="button" className="primary" onClick={copyShare}>复制分享内容</button></form></dialog>}
  </>;
}
