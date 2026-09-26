export interface BookmarkItem {
  id: string;
  title: string;
  path: string;
  group?: string | null;
  createdAt: number;
}

export const DEFAULT_BOOKMARK_GROUPS = ["Writing", "Reference"];

function getStorageKey(key: string, vaultId?: string): string {
  return vaultId ? `symtab-bookmarks-${key}:${vaultId}` : `symtab-bookmarks-${key}`;
}

const memoryStore = new Map<string, string>();

function getStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    // fallback
  }
  return {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
  };
}

export function loadBookmarks(vaultId?: string): BookmarkItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(getStorageKey("items", vaultId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(bookmarks: BookmarkItem[], vaultId?: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getStorageKey("items", vaultId), JSON.stringify(bookmarks));
  } catch {
    // ignore storage errors
  }
}

export function loadBookmarkGroups(vaultId?: string): string[] {
  const storage = getStorage();
  if (!storage) return DEFAULT_BOOKMARK_GROUPS;
  try {
    const raw = storage.getItem(getStorageKey("groups", vaultId));
    if (!raw) return DEFAULT_BOOKMARK_GROUPS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BOOKMARK_GROUPS;
  } catch {
    return DEFAULT_BOOKMARK_GROUPS;
  }
}

export function saveBookmarkGroups(groups: string[], vaultId?: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getStorageKey("groups", vaultId), JSON.stringify(groups));
  } catch {
    // ignore storage errors
  }
}
