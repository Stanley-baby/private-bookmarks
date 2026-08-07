function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function inlineMarkdown(value) {
  const code = [];
  let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, text) => {
    code.push(`<code>${text}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });
  html = html
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)]);
}

export function renderMarkdown(value) {
  const output = [];
  let list = "";
  let code = null;
  const closeList = () => {
    if (!list) return;
    output.push(`</${list}>`);
    list = "";
  };

  for (const line of String(value || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (/^```/.test(line)) {
      closeList();
      if (code) {
        output.push(`<pre><code>${code.join("\n")}</code></pre>`);
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(escapeHtml(line));
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextList = ordered ? "ol" : "ul";
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inlineMarkdown((ordered || unordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      output.push("<hr>");
    } else if (/^>\s?/.test(line)) {
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
    } else {
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  if (code) output.push(`<pre><code>${code.join("\n")}</code></pre>`);
  return output.join("");
}
