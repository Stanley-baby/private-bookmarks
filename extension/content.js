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

  function render(highlights) {
    for (const [name] of styles) CSS.highlights?.delete(name);
    styles.clear();
    for (const item of highlights) {
      const range = rangesFor(item.text)[item.position || 0];
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
    return { id: crypto.randomUUID(), text, position: Math.max(0, matches.findIndex((item) => item.compareBoundaryPoints(Range.START_TO_START, range) === 0)) };
  }

  function compose(base) {
    const dialog = document.createElement("form");
    const colors = ["#ffe920", "#0064ff", "#00c564", "#ff4646"];
    let color = colors[0];
    dialog.style.cssText = "position:fixed;z-index:2147483647;right:16px;top:16px;display:grid;gap:8px;min-width:240px;padding:12px;border:1px solid #999;border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 8px 32px #0005";
    dialog.innerHTML = `<strong>Add highlight</strong><span>${colors.map((value) => `<button type="button" data-color="${value}" style="width:24px;height:24px;padding:0;margin-right:6px;background:${value};border-radius:50%" aria-label="Highlight color"></button>`).join("")}</span><textarea rows="3" placeholder="Note (optional)" style="resize:vertical"></textarea><span data-bookmark-target>Checking saved bookmarks…</span><span><button type="button" data-cancel>Cancel</button><button type="submit" disabled>Save</button></span>`;
    dialog.querySelectorAll("[data-color]").forEach((button) => button.onclick = () => { color = button.dataset.color; });
    dialog.querySelector("[data-cancel]").onclick = () => dialog.remove();
    const save = (force = false) => {
      chrome.runtime.sendMessage({ type: "private-bookmarks-highlight", force, bookmarkId: dialog.querySelector("[data-bookmark-id]")?.value, highlight: { ...base, color, note: dialog.querySelector("textarea").value.trim() } }, (response) => {
        if (response?.conflict) {
          if (window.confirm("This bookmark changed on another device. Press OK to add the highlight to its latest version, or Cancel to leave it unchanged.")) save(true);
          return;
        }
        if (chrome.runtime.lastError || response?.error) return window.alert(response?.error || "Could not save highlight");
        dialog.remove();
        window.getSelection()?.removeAllRanges();
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
      if (chrome.runtime.lastError || response?.error) return target.textContent = "Could not check saved bookmarks";
      const bookmarks = response?.bookmarks || [];
      if (bookmarks.length > 1) {
        const label = document.createElement("label");
        const select = document.createElement("select");
        select.dataset.bookmarkId = "";
        for (const item of bookmarks) select.add(new Option(item.title || item.link, item.id));
        label.append("Save to ", select);
        target.replaceChildren(label);
      } else target.remove();
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
