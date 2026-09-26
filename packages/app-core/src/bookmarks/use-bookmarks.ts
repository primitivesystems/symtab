import { useEffect, useState } from "react";
import {
  DEFAULT_BOOKMARK_GROUPS,
  loadBookmarkGroups,
  loadBookmarks,
  saveBookmarkGroups,
  saveBookmarks,
  type BookmarkItem,
} from "./store";
import { bookmarkGroupsKey, bookmarkItemsKey } from "../app/helpers";
import { useAppStore, type SymtabStatePersistence } from "../app/state";

const EMPTY_BOOKMARKS: BookmarkItem[] = [];

export interface BookmarkTarget {
  title: string;
  path?: string;
}

export interface BookmarkSave {
  id?: string;
  title: string;
  path: string;
  group?: string | null;
}

export function useBookmarks({
  vaultId,
  persistence,
  defaultTarget,
  onStatus,
}: {
  vaultId?: string;
  persistence?: SymtabStatePersistence;
  defaultTarget: BookmarkTarget | null;
  onStatus: (status: string) => void;
}) {
  const storeKey = vaultId ?? "default";
  const appSettings = useAppStore((state) => state.settings);
  const bookmarks = useAppStore((state) => state.bookmarksByVault[storeKey]) ?? EMPTY_BOOKMARKS;
  const groups =
    useAppStore((state) => state.bookmarkGroupsByVault[storeKey]) ?? DEFAULT_BOOKMARK_GROUPS;
  const setStoredBookmarks = useAppStore((state) => state.setBookmarks);
  const setStoredGroups = useAppStore((state) => state.setBookmarkGroups);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<BookmarkTarget | null>(null);

  useEffect(() => {
    const remoteItems = appSettings[bookmarkItemsKey(vaultId)];
    const remoteGroups = appSettings[bookmarkGroupsKey(vaultId)];
    setStoredBookmarks(
      storeKey,
      persistence && Array.isArray(remoteItems)
        ? (remoteItems as BookmarkItem[])
        : loadBookmarks(vaultId)
    );
    setStoredGroups(
      storeKey,
      persistence && Array.isArray(remoteGroups)
        ? (remoteGroups as string[])
        : loadBookmarkGroups(vaultId)
    );
  }, [appSettings, persistence, setStoredBookmarks, setStoredGroups, storeKey, vaultId]);

  const updateBookmarks = (updater: (current: BookmarkItem[]) => BookmarkItem[]) => {
    const current = useAppStore.getState().bookmarksByVault[storeKey] ?? EMPTY_BOOKMARKS;
    const next = updater(current);
    setStoredBookmarks(storeKey, next);
    if (persistence) {
      void persistence.saveAppSetting(bookmarkItemsKey(vaultId), next).catch(() => undefined);
    } else {
      saveBookmarks(next, vaultId);
    }
  };

  const updateGroups = (updater: (current: string[]) => string[]) => {
    const current =
      useAppStore.getState().bookmarkGroupsByVault[storeKey] ?? DEFAULT_BOOKMARK_GROUPS;
    const next = updater(current);
    setStoredGroups(storeKey, next);
    if (persistence) {
      void persistence.saveAppSetting(bookmarkGroupsKey(vaultId), next).catch(() => undefined);
    } else {
      saveBookmarkGroups(next, vaultId);
    }
  };

  const openDialog = (nextTarget?: BookmarkTarget | null) => {
    const selected = nextTarget || defaultTarget;
    if (!selected) return;
    setTarget(selected);
    setDialogOpen(true);
  };

  const save = (data: BookmarkSave) => {
    if (data.id) {
      updateBookmarks((current) =>
        current.map((item) =>
          item.id === data.id ? { ...item, title: data.title, group: data.group } : item
        )
      );
      onStatus(`Updated bookmark ${data.title}`);
      return;
    }
    updateBookmarks((current) => [
      ...current,
      {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: data.title,
        path: data.path,
        group: data.group,
        createdAt: Date.now(),
      },
    ]);
    onStatus(`Bookmarked ${data.title}`);
  };

  const remove = (id: string) => {
    updateBookmarks((current) => current.filter((item) => item.id !== id));
  };

  const createGroup = (name: string) => {
    if (name && !groups.includes(name)) updateGroups((current) => [...current, name]);
  };

  const includes = (candidate: BookmarkTarget) => {
    const path = candidate.path || candidate.title;
    return bookmarks.some(
      (bookmark) =>
        bookmark.path.toLowerCase() === path.toLowerCase() ||
        bookmark.title.toLowerCase() === candidate.title.toLowerCase()
    );
  };

  return {
    bookmarks,
    groups,
    dialogOpen,
    setDialogOpen,
    target,
    openDialog,
    save,
    remove,
    createGroup,
    includes,
  };
}
