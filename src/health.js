function statusFor(response) {
  if (response.status === 404 || response.status === 410) return "broken";
  return response.ok ? "healthy" : "unknown";
}

async function checkLink(link, fetcher) {
  const request = { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) };
  let response = await fetcher(link, request);
  if (response.status === 405) {
    response = await fetcher(link, { ...request, method: "GET", headers: { range: "bytes=0-0" } });
  }
  return { status: statusFor(response), finalUrl: response.url || link };
}

export async function runHealthChecks(store, fetcher = fetch, collectionId = null) {
  const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const candidates = await store.healthCandidates(before, collectionId);
  let checked = 0;
  // ponytail: sequential checks, add a bounded pool only if a large library makes the weekly job too slow.
  for (const item of candidates) {
    try {
      await store.updateHealth(item.id, await checkLink(item.link, fetcher));
    } catch {
      await store.updateHealth(item.id, { status: "unknown", finalUrl: item.link });
    }
    checked += 1;
  }
  return { checked };
}
