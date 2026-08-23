import type { Bookmark } from "../../extension/shared/local-db.js";

export function filterBookmarks(items: Bookmark[], options?: { query?: string; tag?: string; scope?: Set<string> | null }): Bookmark[];
export function searchSuggestions(query: string, history?: string[]): string[];
export type BookmarkSort = "manual" | "created" | "-created" | "title" | "-title" | "domain" | "-domain";
export function sortBookmarks(items: Bookmark[], sort?: BookmarkSort, manualOrder?: string[]): Bookmark[];
export function reorderVisibleIds(allIds: string[], visibleIds: string[], id: string, offset: number): string[];
export function visibleSelection(selectedIds: string[], visibleItems: Bookmark[]): string[];
