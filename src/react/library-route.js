const BASE_URL = "http://localhost/";

function toUrl(value) {
  return value instanceof URL ? new URL(value.href) : new URL(String(value || globalThis.location?.href || BASE_URL), BASE_URL);
}

export function readLibraryRoute(value) {
  const params = toUrl(value).searchParams;
  const view = params.get("view") === "trash" ? "trash" : "all";
  return {
    view,
    collectionId: view === "trash" ? null : params.get("collection") || null,
    query: params.get("search") || "",
    tag: params.get("tag") || "",
  };
}

export function libraryRouteHref(route, value) {
  const url = toUrl(value);
  for (const key of ["view", "collection", "search", "tag"]) url.searchParams.delete(key);
  if (route.view === "trash") url.searchParams.set("view", "trash");
  else if (route.collectionId) url.searchParams.set("collection", route.collectionId);
  if (route.query?.trim()) url.searchParams.set("search", route.query.trim());
  if (route.tag) url.searchParams.set("tag", route.tag);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function navigateLibraryRoute(route, mode = "replace", target = globalThis.history, value) {
  const href = libraryRouteHref(route, value);
  target?.[`${mode}State`]?.({}, "", href);
  return href;
}
