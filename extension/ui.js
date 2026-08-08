import { connect } from "./api.js?v=20260808-pin2";
import { forgetPin, lockState, unlock } from "./lock.js?v=20260808-pin2";

export function lockView(root, onUnlocked, onForgot = () => connectionView(root, onUnlocked)) {
  root.innerHTML = `<section class="lock-screen"><div class="lock-card"><img class="logo" src="icons/bookmark.svg" alt=""><h1>应用已锁定</h1><p class="muted">输入 PIN 码以查看私有书签。</p><form><label>PIN 码<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="6" maxlength="12" pattern="[0-9]{6,12}" required autofocus></label><button class="primary">解锁</button><p class="error hidden" role="alert"></p></form><button type="button" class="text-button" data-lock-forgot>忘记 PIN？清除本地连接</button></div></section>`;
  const form = root.querySelector("form");
  const error = root.querySelector(".error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    error.classList.add("hidden");
    try {
      await unlock(new FormData(form).get("pin"));
      await onUnlocked();
    } catch (reason) {
      error.textContent = reason.message || "解锁失败";
      error.classList.remove("hidden");
      button.disabled = false;
      form.querySelector("[name=pin]").select();
    }
  });
  root.querySelector("[data-lock-forgot]").onclick = async () => {
    if (!window.confirm("忘记 PIN 将清除本地连接，需要重新输入实例地址和访问密钥。继续吗？")) return;
    await forgetPin();
    onForgot();
  };
  lockState().then((status) => {
    if (status.cooldownUntil > Date.now()) {
      error.textContent = `请在 ${Math.ceil((status.cooldownUntil - Date.now()) / 1000)} 秒后重试`;
      error.classList.remove("hidden");
    }
  });
}

export function connectionView(root, onConnected) {
  root.innerHTML = `<section class="connection"><img class="logo" src="icons/bookmark.svg" alt=""><h1>连接私有书签</h1><p class="muted">输入 Cloudflare Worker 的 HTTPS 地址和访问密钥；它们只保存在此浏览器中。</p><form><label>私有实例地址<input name="endpoint" type="url" placeholder="https://bookmarks.example.workers.dev" required></label><label>访问密钥<input name="key" type="password" autocomplete="off" required></label><button class="primary">连接</button><p class="error hidden"></p></form></section>`;
  root.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = root.querySelector(".error");
    try {
      await connect(form.get("endpoint"), form.get("key"));
      onConnected();
    } catch (reason) {
      error.textContent = reason.message;
      error.classList.remove("hidden");
    }
  });
}

export function collectionOptions(collections, selected = "unsorted") {
  const byParent = new Map();
  for (const item of collections) byParent.set(item.parentId || "", [...(byParent.get(item.parentId || "") || []), item]);
  const options = [];
  const visit = (parentId = "", depth = 0) => {
    for (const item of byParent.get(parentId) || []) {
      options.push(`<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${"  ".repeat(depth)}${escapeHtml(item.name)}</option>`);
      visit(item.id, depth + 1);
    }
  };
  visit();
  return options.join("");
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
