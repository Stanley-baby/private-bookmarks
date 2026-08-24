(() => {
  if (globalThis.__privateBookmarksHighlight) return;
  globalThis.__privateBookmarksHighlight = true;
  const styles = new Map();

  function rangesFor(text) {
    const ranges = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let start = 0;
      while (text && node.data.toLocaleLowerCase().indexOf(text.toLocaleLowerCase(), start) !== -1) {
        const index = node.data.toLocaleLowerCase().indexOf(text.toLocaleLowerCase(), start);
        const range = new Range();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        ranges.push(range);
        start = index + text.length;
      }
    }
    return ranges;
  }

  function rangeAt(location) {
    if (!Number.isInteger(location?.start) || !Number.isInteger(location?.end) || location.start < 0 || location.end <= location.start) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, offset = 0, startNode, endNode, startOffset, endOffset;
    while ((node = walker.nextNode())) {
      const next = offset + node.data.length;
      if (!startNode && location.start >= offset && location.start <= next) { startNode = node; startOffset = location.start - offset; }
      if (location.end >= offset && location.end <= next) { endNode = node; endOffset = location.end - offset; break; }
      offset = next;
    }
    if (!startNode || !endNode) return null;
    const range = new Range();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function rangeFor(item) {
    const located = rangeAt(item.location);
    return located?.toString().trim() === item.text ? located : rangesFor(item.text)[item.position || 0];
  }

  function render(highlights) {
    for (const [name] of styles) CSS.highlights?.delete(name);
    styles.clear();
    for (const item of highlights) {
      const range = rangeFor(item);
      if (!range || !globalThis.Highlight || !CSS.highlights) continue;
      const name = `private-bookmarks-${item.id}`;
      CSS.highlights.set(name, new Highlight(range));
      styles.set(name, item.color || "#ffe920");
    }
    let style = document.getElementById("private-bookmarks-highlights");
    if (!style) {
      style = document.createElement("style");
      style.id = "private-bookmarks-highlights";
      document.documentElement.append(style);
    }
    style.textContent = [...styles].map(([name, color]) => `::highlight(${name}) { background: color-mix(in srgb, ${color}, transparent 45%); }`).join("\n");
  }

  function selection() {
    const range = window.getSelection()?.getRangeAt(0);
    const text = range?.toString().trim();
    if (!text) return null;
    const matches = rangesFor(text);
    const prefix = document.createRange();
    prefix.selectNodeContents(document.body);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    return { id: crypto.randomUUID(), text, position: Math.max(0, matches.findIndex((item) => item.compareBoundaryPoints(Range.START_TO_START, range) === 0)), location: { start, end: start + range.toString().length, quote: text }, revision: 1 };
  }

  function compose(base) {
    const dialog = document.createElement("form");
    const colors = ["#ffe920", "#0064ff", "#00c564", "#ff4646"];
    let color = colors[0];
    dialog.style.cssText = "position:fixed;z-index:2147483647;right:16px;top:16px;display:grid;gap:8px;min-width:240px;padding:12px;border:1px solid #999;border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 8px 32px #0005";
    dialog.innerHTML = `<strong>添加高亮</strong><span>${colors.map((value) => `<button type="button" data-color="${value}" style="width:24px;height:24px;padding:0;margin-right:6px;background:${value};border-radius:50%" aria-label="高亮颜色"></button>`).join("")}</span><textarea rows="3" placeholder="备注（可选）" style="resize:vertical"></textarea><span data-bookmark-target>正在检查已保存书签…</span><span><button type="button" data-cancel>取消</button><button type="submit" disabled>保存</button></span>`;
    dialog.querySelectorAll("[data-color]").forEach((button) => button.onclick = () => { color = button.dataset.color; });
    dialog.querySelector("[data-cancel]").onclick = () => dialog.remove();
    const save = (force = false) => {
      chrome.runtime.sendMessage({ type: "private-bookmarks-highlight", force, bookmarkId: dialog.querySelector("[data-bookmark-id]")?.value, highlight: { ...base, color, note: dialog.querySelector("textarea").value.trim() } }, (response) => {
        if (response?.conflict) {
          if (window.confirm("此书签已在其他设备上更新。点击“确定”将高亮添加到最新版本，或点击“取消”保持不变。")) save(true);
          return;
        }
        if (chrome.runtime.lastError || response?.error) return window.alert(response?.error || "无法保存高亮");
        dialog.remove();
        window.getSelection()?.removeAllRanges();
      });
    };
    const manage = (bookmark) => {
      const highlights = bookmark.highlights || [];
      const choice = window.prompt(`高亮：\n${highlights.map((item, index) => `${index + 1}. ${item.text}${item.note ? ` — ${item.note}` : ""}`).join("\n")}\n\n输入编号编辑，或 d<编号> 删除`, "");
      if (!choice?.trim()) return;
      const remove = choice.trim().match(/^d(\d+)$/i);
      const index = Number(remove?.[1] || choice) - 1;
      const current = highlights[index];
      if (!current) return window.alert("请选择列表中的高亮编号");
      const changes = remove ? { deleted: true } : { color: window.prompt("颜色", current.color || "#ffe920") || current.color, note: window.prompt("备注", current.note || "") ?? current.note };
      chrome.runtime.sendMessage({ type: "private-bookmarks-update-highlight", bookmarkId: bookmark.id, highlightId: current.id, expectedRevision: current.revision, changes }, (response) => {
        if (chrome.runtime.lastError || response?.error) return window.alert(response?.error || "无法更新高亮");
        dialog.remove();
      });
    };
    dialog.onsubmit = (event) => {
      event.preventDefault();
      save();
    };
    document.documentElement.append(dialog);
    chrome.runtime.sendMessage({ type: "private-bookmarks-bookmarks-by-link" }, (response) => {
      if (!dialog.isConnected) return;
      const target = dialog.querySelector("[data-bookmark-target]");
      const saveButton = dialog.querySelector("button[type=submit]");
      if (chrome.runtime.lastError || response?.error) return target.textContent = "无法检查已保存书签";
      const bookmarks = response?.bookmarks || [];
      if (bookmarks.length > 1) {
        const label = document.createElement("label");
        const select = document.createElement("select");
        select.dataset.bookmarkId = "";
        for (const item of bookmarks) select.add(new Option(item.title || item.link, item.id));
        label.append("保存到 ", select);
        target.replaceChildren(label);
      } else target.remove();
      if (bookmarks.length === 1 && bookmarks[0].highlights?.length) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "编辑已有高亮";
        button.onclick = () => manage(bookmarks[0]);
        dialog.insertBefore(button, dialog.lastElementChild);
      }
      saveButton.disabled = false;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "private-bookmarks-ping") return sendResponse({ ok: true });
    if (message.type === "private-bookmarks-apply") {
      render(message.highlights || []);
      return sendResponse({ ok: true });
    }
    if (message.type === "private-bookmarks-save-selection") {
      const highlight = selection();
      if (highlight) compose(highlight);
      return sendResponse({ ok: Boolean(highlight) });
    }
  });
})();
