export type CoverRef = { id?: string; url?: string; contentType?: string; size?: number };
export type Bookmark = {
  id: string;
  link: string;
  title: string;
  description: string;
  note: string;
  collectionId: string;
  tags: string[];
  type?: string;
  language?: string;
  reminder?: string;
  media?: string[];
  highlights?: unknown[];
  favorite?: boolean;
  position?: number;
  health?: { status?: string; checkedAt?: string | null; finalUrl?: string };
  cover?: string;
  coverRef?: CoverRef;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  purgedAt?: string;
  permanentDeletedAt?: string;
  deletedByCollectionId?: string;
  revision?: number;
};
export type Collection = { id: string; name: string; parentId: string | null; position?: number; createdAt: string; updatedAt?: string; deletedAt?: string; deletedByCollectionId?: string; revision?: number };
export type ActionMode = "popup" | "sidepanel";
export type BookmarkBatchAction =
  | { type: "move"; collectionId: string }
  | { type: "tags"; mode: "add" | "remove"; tags: string[] }
  | { type: "trash" }
  | { type: "restore" }
  | { type: "screenshot" }
  | { type: "permanentDelete" };
export type BookmarkConflictChoices = Partial<Record<"title" | "link" | "description" | "note" | "tags" | "collectionId", "local" | "cloud">>;

export declare const DEFAULT_PREFERENCES: Record<string, unknown>;
export declare const applyMigrationPackage: (...args: any[]) => Promise<any>;
export declare const exportMigrationPackage: (...args: any[]) => Promise<any>;
export declare const importMigrationPackage: (...args: any[]) => Promise<any>;
export declare const previewMigrationPackage: (...args: any[]) => Promise<any>;
export declare const applyRemoteRecord: (...args: any[]) => Promise<void>;
export declare const batchBookmark: (id: string, action: BookmarkBatchAction) => Promise<Bookmark | null>;
export declare const batchBookmarks: (ids: string[], action: BookmarkBatchAction) => Promise<Bookmark[]>;
export declare const ensureDefaults: () => Promise<void>;
export declare const exportLibrary: () => Promise<any>;
export declare const getActionMode: () => Promise<ActionMode | null>;
export declare const getPreferences: () => Promise<any>;
export declare const importLibrary: (data: any) => Promise<{ bookmarks: number; collections: number }>;
export declare const initialize: () => Promise<void>;
export declare const initialized: () => Promise<boolean>;
export declare const listBookmarks: (options?: { trash?: boolean }) => Promise<Bookmark[]>;
export declare const listCollections: (options?: { trash?: boolean }) => Promise<Collection[]>;
export declare const listConflicts: () => Promise<any[]>;
export declare const mergeLibrary: (data: any) => Promise<void>;
export declare const outboxFor: (...args: any[]) => Promise<any[]>;
export declare const outboxItems: () => Promise<any[]>;
export declare const removeOutbox: (id: number) => Promise<void>;
export declare const replaceLibrary: (data: any) => Promise<void>;
export declare const resolveConflict: (key: string, choice: "local" | "cloud" | BookmarkConflictChoices) => Promise<any>;
export declare const restoreBookmark: (id: string) => Promise<Bookmark | null>;
export declare const restoreCollection: (id: string, revision?: number) => Promise<Collection | null>;
export declare const saveBookmark: (input: any, options?: { enqueueSync?: boolean }) => Promise<Bookmark>;
export declare const saveBookmarkWithCollection: (input: any, collection?: any) => Promise<{ bookmark: Bookmark; collection: Collection | null }>;
export declare const saveCollection: (input: any, options?: { enqueueSync?: boolean }) => Promise<Collection>;
export declare const saveConflict: (value: any) => Promise<void>;
export declare const setActionMode: (mode: ActionMode) => Promise<ActionMode>;
export declare const setSyncSettings: (input: any) => Promise<any>;
export declare const setWebdavSettings: (input: any) => Promise<any>;
export declare const syncSettings: () => Promise<any>;
export declare const trashBookmark: (id: string) => Promise<Bookmark | null>;
export declare const trashCollection: (id: string) => Promise<Collection | null>;
export declare const updatePreferences: (revision: number, changes: Record<string, unknown>) => Promise<any>;
export declare const webdavSettings: () => Promise<any>;

