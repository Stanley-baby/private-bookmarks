export function currentPageDraft(response) {
  if (response?.error) throw new Error(response.error);
  if (!response?.metadata?.link) throw new TypeError("无法读取当前页面");
  return response.metadata;
}

export function saveFeedback(bookmark, bookmarks, online = true) {
  const duplicate = bookmarks.some((item) => item.id !== bookmark.id && item.link === bookmark.link);
  const message = duplicate ? "已保存；已存在相同链接。" : "已保存。";
  return online ? message : `${message}当前离线，将在联网后同步。`;
}
