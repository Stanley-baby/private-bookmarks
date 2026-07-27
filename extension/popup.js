import { api, connection, requestPagePermission } from "./api.js";
import { collectionOptions, connectionView, escapeHtml } from "./ui.js";

const root = document.querySelector("#app");

async function render() {
  if (!await connection()) return connectionView(root, render);
  const [{ collections, preferences }, [tab]] = await Promise.all([api("/v1/bootstrap"), chrome.tabs.query({ active: true, currentWindow: true })]);
  root.innerHTML = `<header class="app-header"><img src="icons/bookmark.svg" width="22" height="22" alt=""><h1>Private Bookmarks</h1><button title="Open library" id="library">↗</button></header><main><div class="page-title"><strong>${escapeHtml(tab.title || "Untitled page")}</strong><span class="muted">${escapeHtml(tab.url || "")}</span></div><label>Collection<select id="collection">${collectionOptions(collections, preferences.defaultCollectionId)}</select></label><div class="popup-actions"><button class="primary" id="save">Save page</button><button id="highlight">Add highlight</button></div><p class="error hidden" id="error"></p></main>`;
  root.querySelector("#library").onclick = () => chrome.runtime.sendMessage({ type: "private-bookmarks-open-library" });
  root.querySelector("#save").onclick = async () => {
    if (await requestPagePermission(tab.url)) invoke("private-bookmarks-save-current", { collectionId: root.querySelector("#collection").value });
  };
  root.querySelector("#highlight").onclick = async () => {
    if (await requestPagePermission(tab.url)) chrome.runtime.sendMessage({ type: "private-bookmarks-save-selection" });
  };
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

render().catch((error) => connectionView(root, () => render()));
