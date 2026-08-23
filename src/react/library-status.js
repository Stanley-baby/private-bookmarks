export function classifyLibraryError(reason) {
  const value = String(reason?.code || reason?.name || reason?.message || reason || "").toLocaleLowerCase();
  return /permission|denied|notallowed|unauthorized|forbidden/.test(value) ? "permission-denied" : "error";
}

export function loadErrorMessage(reason) {
  return classifyLibraryError(reason) === "permission-denied" ? "未获得必要权限，请允许后重试。" : reason?.message || "加载资料库失败，请重试。";
}
