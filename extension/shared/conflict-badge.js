export function conflictBadgeText(count) {
  const value = Math.max(0, Number(count) || 0);
  return value > 99 ? "99+" : value ? String(value) : "";
}

export async function updateConflictBadge(count) {
  const action = globalThis.chrome?.action;
  if (!action) return;
  await action.setBadgeText({ text: conflictBadgeText(count) });
  if (count) await action.setBadgeBackgroundColor({ color: "#ca4b53" });
}
