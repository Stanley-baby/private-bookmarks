import { connect } from "./api.js";

export function connectionView(root, onConnected) {
  root.innerHTML = `<section class="connection"><img class="logo" src="icons/bookmark.svg" alt=""><h1>Connect Private Bookmarks</h1><p class="muted">Enter the HTTPS Worker URL and the access key configured in Cloudflare. They stay only in this browser.</p><form><label>Private Instance URL<input name="endpoint" type="url" placeholder="https://bookmarks.example.workers.dev" required></label><label>Access key<input name="key" type="password" autocomplete="off" required></label><button class="primary">Connect</button><p class="error hidden"></p></form></section>`;
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
