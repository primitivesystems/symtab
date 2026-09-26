import { create } from "zustand";

import type { MarkdownMode } from "../editor/markdown-editor";
import type { BookmarkItem } from "../bookmarks/store";
import type { WorkspaceNode } from "../workspace/tree";
import type { LeftPane, RightPane } from "../workspace/sidebars";
import type { SymtabLayoutState } from "@symtab/shared-ui/hooks/use-symtab-layout";

export type VaultLifecycleState =
  "initializing" | "read_only_ready" | "writable" | "indexing" | "active" | "degraded";

export interface IndexingProgress {
  phase: string;
  processed: number;
  total: number;
  failed: number;
}

export interface PersistedWorkspaceTab {
  id: number;
  path?: string;
  kind?: "graph";
  graphRootPath?: string;
  mode: MarkdownMode;
  pinned: boolean;
}

export interface PersistedWorkspaceSession {
  version: 1;
  vaultId: string;
  tabs: PersistedWorkspaceTab[];
  activePath?: string;
  activeTabId?: number;
  workspaceRoot: WorkspaceNode;
  activeLeafId: number;
  leftSidebarPane: LeftPane;
  rightSidebarPane: RightPane;
  layout?: SymtabLayoutState;
  expandedFolders?: string[];
}

export interface AppBootstrapState {
  lastVaultPath: string | null;
}

export interface RememberedVault {
  id: string;
  name: string;
  path: string;
}

export interface SymtabStatePersistence {
  loadBootstrap(windowId: string): Promise<AppBootstrapState>;
  loadWorkspaceSession(
    windowId: string,
    vaultId?: string
  ): Promise<PersistedWorkspaceSession | null>;
  saveWorkspaceSession(windowId: string, session: PersistedWorkspaceSession): Promise<void>;
  loadAppSettings(): Promise<Record<string, unknown>>;
  saveAppSetting(key: string, value: unknown): Promise<void>;
  rememberVault(vault: RememberedVault): Promise<void>;
  forgetLastVault(): Promise<void>;
}

interface AppState {
  hydrated: boolean;
  vaultId: string | null;
  vaultName: string | null;
  lifecycle: VaultLifecycleState;
  indexing: IndexingProgress | null;
  workspace: PersistedWorkspaceSession | null;
  settings: Record<string, unknown>;
  bookmarksByVault: Record<string, BookmarkItem[]>;
  bookmarkGroupsByVault: Record<string, string[]>;
  hydrate(settings: Record<string, unknown>): void;
  setVault(
    vault: { id: string; name: string } | null,
    lifecycle?: VaultLifecycleState,
    indexing?: IndexingProgress | null
  ): void;
  setLifecycle(lifecycle: VaultLifecycleState, indexing?: IndexingProgress | null): void;
  setWorkspace(workspace: PersistedWorkspaceSession | null): void;
  setSetting(key: string, value: unknown): void;
  setBookmarks(vaultId: string, bookmarks: BookmarkItem[]): void;
  setBookmarkGroups(vaultId: string, groups: string[]): void;
}

export const useAppStore = create<AppState>((set) => ({
  hydrated: false,
  vaultId: null,
  vaultName: null,
  lifecycle: "initializing",
  indexing: null,
  workspace: null,
  settings: {},
  bookmarksByVault: {},
  bookmarkGroupsByVault: {},
  hydrate: (settings) =>
    set((current) => ({
      settings: { ...settings, ...current.settings },
      hydrated: true,
    })),
  setVault: (vault, lifecycle = vault ? "active" : "initializing", indexing = null) =>
    set((current) => ({
      vaultId: vault?.id ?? null,
      vaultName: vault?.name ?? null,
      lifecycle,
      indexing,
      workspace: vault && current.vaultId === vault.id ? current.workspace : null,
    })),
  setLifecycle: (lifecycle, indexing) =>
    set((current) => ({
      lifecycle,
      indexing: indexing === undefined ? current.indexing : indexing,
    })),
  setWorkspace: (workspace) => set({ workspace }),
  setSetting: (key, value) =>
    set((current) => ({ settings: { ...current.settings, [key]: value } })),
  setBookmarks: (vaultId, bookmarks) =>
    set((current) => ({
      bookmarksByVault: { ...current.bookmarksByVault, [vaultId]: bookmarks },
    })),
  setBookmarkGroups: (vaultId, groups) =>
    set((current) => ({
      bookmarkGroupsByVault: { ...current.bookmarkGroupsByVault, [vaultId]: groups },
    })),
}));

let volatileLastVaultPath: string | null = null;
const volatileWorkspaces = new Map<string, Map<string, PersistedWorkspaceSession>>();
const volatileSettings: Record<string, unknown> = {};

/** In-memory fallback used only when a shell has no backend persistence adapter. */
export const browserStatePersistence: SymtabStatePersistence = {
  async loadBootstrap() {
    return { lastVaultPath: volatileLastVaultPath };
  },
  async loadWorkspaceSession(windowId, vaultId) {
    const sessions = volatileWorkspaces.get(windowId);
    if (!sessions) return null;
    if (vaultId) return sessions.get(vaultId) ?? null;
    return [...sessions.values()].at(-1) ?? null;
  },
  async saveWorkspaceSession(windowId, session) {
    const sessions = volatileWorkspaces.get(windowId) ?? new Map();
    sessions.set(session.vaultId, session);
    volatileWorkspaces.set(windowId, sessions);
  },
  async loadAppSettings() {
    return { ...volatileSettings };
  },
  async saveAppSetting(key, value) {
    volatileSettings[key] = value;
  },
  async rememberVault(vault) {
    volatileLastVaultPath = vault.path;
  },
  async forgetLastVault() {
    volatileLastVaultPath = null;
  },
};
