import { api, connection, requestPagePermission } from "./shared/api.js";
import { lockState, prepareLock } from "./shared/lock.js";
import { collectionOptions, connectionView, escapeHtml, lockView } from "./ui.js?v=20260808-pin2";

const root = document.querySelector("#app");

async function render() {
  await prepareLock();
  const lock = await lockState();
  if (lock.enabled && lock.locked) return lockView(root, render);
  if (!await connection()) return connectionView(root, render);
  const [{ collections, preferences }, [tab]] = await Promise.all([api("/v1/bootstrap"), chrome.tabs.query({ active: true, currentWindow: true })]);
  root.innerHTML = `<header class="app-header"><img src="icons/bookmark.svg" width="22" height="22" alt=""><h1>私有书签</h1><button title="打开资料库" aria-label="打开资料库" id="library">↗</button></header><main><div class="page-title"><strong>${escapeHtml(tab.title || "未命名页面")}</strong><span class="muted">${escapeHtml(tab.url || "")}</span></div><label>收藏夹<select id="collection">${collectionOptions(collections, preferences.defaultCollectionId)}</select></label><div class="popup-actions"><button class="primary" id="save">保存页面</button><button id="highlight">添加高亮</button></div><p class="error hidden" id="error" role="alert"></p></main>`;
  root.querySelector("#library").onclick = () => chrome.runtime.sendMessage({ type: "private-bookmarks-open-library" });
  const withPagePermission = async (action) => {
    try {
      if (await requestPagePermission(tab.url)) await action();
    } catch (error) {
      const message = root.querySelector("#error");
      message.textContent = error.message || "请求失败";
      message.classList.remove("hidden");
    }
  };
  root.querySelector("#save").onclick = () => withPagePermission(() => invoke("private-bookmarks-save-current", { collectionId: root.querySelector("#collection").value }));
  root.querySelector("#highlight").onclick = () => withPagePermission(() => chrome.runtime.sendMessage({ type: "private-bookmarks-save-selection" }));
}

async function invoke(type, message) {
  const response = await chrome.runtime.sendMessage({ type, ...message });
  const error = root.querySelector("#error");
  if (response?.error) {
    error.textContent = response.error;
    error.classList.remove("hidden");
    return;
  }
  window.close();
}

render().catch((error) => error?.code === "locked" ? lockView(root, render) : connectionView(root, () => render()));
