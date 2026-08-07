const BROKEN_LEVELS = new Set(["basic", "default", "strict", "off"]);
const SLOW_RESPONSE_MS = 5_000;
const MAX_REDIRECTS = 5;

function normalizeBrokenLevel(value) {
  return BROKEN_LEVELS.has(value) ? value : "default";
}

function statusFor(response, level, elapsedMs, redirects) {
  if (response.status === 404 || response.status === 410) return "broken";
  if (level === "strict" && (response.status >= 500 || elapsedMs > SLOW_RESPONSE_MS || redirects > MAX_REDIRECTS)) return "broken";
  return response.ok ? "healthy" : "unknown";
}

function isResolutionFailure(error) {
  const details = [error?.code, error?.cause?.code, error?.message, error?.cause?.message].filter(Boolean).join(" ").toUpperCase();
  return /ENOTFOUND|EAI_AGAIN|EAI_NONAME|NXDOMAIN|NAME_NOT_RESOLVED|DNS_PROBE_FINISHED_NXDOMAIN|DNS/.test(details);
}

function errorStatus(error, level) {
  if (level === "strict" || (level === "default" && isResolutionFailure(error))) return "broken";
  return "unknown";
}

async function checkLink(link, fetcher, level) {
  const request = { method: "HEAD", redirect: level === "strict" ? "manual" : "follow", signal: AbortSignal.timeout(10_000) };
  let target = link;
  let redirects = 0;
  let elapsedMs = 0;

  while (true) {
    const started = Date.now();
    let response = await fetcher(target, request);
    elapsedMs += Date.now() - started;
    if (response.status === 405) {
      const fallbackStarted = Date.now();
      response = await fetcher(target, { ...request, method: "GET", headers: { range: "bytes=0-0" } });
      elapsedMs += Date.now() - fallbackStarted;
    }

    const location = level === "strict" && response.status >= 300 && response.status < 400 ? response.headers?.get("location") : null;
    if (location) {
      redirects += 1;
      if (redirects > MAX_REDIRECTS) return { status: "broken", finalUrl: target };
      target = new URL(location, target).toString();
      continue;
    }
    return { status: statusFor(response, level, elapsedMs, redirects), finalUrl: response.url || target };
  }
}

export async function runHealthChecks(store, fetcher = fetch, collectionId = null) {
  const preferences = typeof store.getPreferences === "function" ? await store.getPreferences() : null;
  const level = normalizeBrokenLevel(preferences?.brokenLevel);
  if (level === "off") return { checked: 0 };

  const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const candidates = await store.healthCandidates(before, collectionId);
  let checked = 0;
  // ponytail: sequential checks, add a bounded pool only if a large library makes the weekly job too slow.
  for (const item of candidates) {
    try {
      await store.updateHealth(item.id, await checkLink(item.link, fetcher, level));
    } catch (error) {
      await store.updateHealth(item.id, { status: errorStatus(error, level), finalUrl: item.link });
    }
    checked += 1;
  }
  return { checked };
}
