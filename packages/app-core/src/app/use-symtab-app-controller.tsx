import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { SymtabLayoutState } from "@symtab/shared-ui/hooks/use-symtab-layout";
import { toast } from "@symtab/shared-ui/components/sonner";
import { Bookmark } from "lucide-react";
import type {
  DocumentReferences,
  FileEntry,
  RecentVault,
  VaultChange,
  VaultInfo,
  VaultLocation,
  VaultGraph,
} from "@symtab/bridge-contract";
import { SymtabEditorPane, type SymtabTabCommands } from "@symtab/shared-ui/components/workspace-tab";
import {
  DEMO_DOCUMENT,
  MarkdownDocumentMenu,
  MarkdownEditor,
  MarkdownViewToggle,
  REFERENCE_DOCUMENTS,
  type DemoDocument,
} from "../editor/markdown-editor";
import { setFrontmatterProperty } from "../editor/frontmatter";
import { isIgnoredPath } from "../editor/link-index";
import type { LeftPane, RightPane } from "../workspace/sidebars";
import { APP_STATE_KEY, useSymtabSettings } from "./settings-store";
import { FilePreview } from "../workspace/file-preview";
import {
  closeOtherWorkspaceTabs,
  closeWorkspaceTabsAfter,
  findWorkspaceLeaf,
  mapWorkspaceLeaves,
  mapWorkspaceLeaf,
  moveWorkspaceTab,
  removeWorkspaceLeaf,
  workspaceEdgeLeafIds,
  workspaceHasTab,
  workspaceLeaves,
  type WorkspaceLeafView,
  type WorkspaceNode,
} from "../workspace/tree";
import {
  createBrowserWorkspaceTab,
  createGraphWorkspaceTab,
  createWorkspaceTab,
  type WorkspaceTab,
} from "../workspace/tabs";
import { BrowserView } from "../workspace/browser-view";
import {
  browserStatePersistence,
  useAppStore,
  type IndexingProgress,
  type PersistedWorkspaceSession,
  type PersistedWorkspaceTab,
} from "./state";
import {
  decodedText,
  documentFromLocation,
  errorMessage,
  fileTitleFromPath,
  getBootstrapStatus,
  lifecycleFromVault,
  mapWithConcurrency,
  markdownPath,
  maxWorkspaceNodeId,
  mimeTypeForPath,
  movedDocumentPath,
  restoreWorkspaceRoot,
  singleTextEdit,
  titleFromPath,
  workspaceTabPath,
  workspaceTabView,
} from "./helpers";
import { localDateKey } from "../daily-notes/config";
import { EditorPathBreadcrumb, type InitializationPhase } from "./chrome";
import { useBookmarks } from "../bookmarks/use-bookmarks";
import { useNavigationHistory } from "../workspace/use-navigation-history";
import { usePlugins } from "../plugins/use-plugins";
import { useTrash } from "../trash/use-trash";
import { useDailyNotes } from "../daily-notes/use-daily-notes";
import { runWithToast, type AsyncFeedback } from "./toast-feedback";
import type { WorkspaceLeafContext } from "../workspace/leaf";

import type { SymtabAppProps, SymtabPerformanceStats } from "../App";

const DOCUMENT_LIBRARY = [DEMO_DOCUMENT, ...REFERENCE_DOCUMENTS];
interface IndexedVaultInfo extends VaultInfo {
  indexing?: IndexingProgress;
}

interface PendingDocumentSave {
  vaultId: string;
  tabId: number;
  document: DemoDocument;
  content: string;
}

const PdfViewer = lazy(() =>
  import("../pdf/viewer").then((module) => ({ default: module.PdfViewer }))
);

export function useSymtabAppController({ runtime }: Pick<SymtabAppProps, "runtime">) {
  const { settings } = useSymtabSettings();
  const { plugins, general } = settings;
  const lifecycle = useAppStore((state) => state.lifecycle);
  const indexing = useAppStore((state) => state.indexing);
  const hydrateAppState = useAppStore((state) => state.hydrate);
  const setAppVault = useAppStore((state) => state.setVault);
  const setLifecycle = useAppStore((state) => state.setLifecycle);
  const setStoredWorkspace = useAppStore((state) => state.setWorkspace);
  const statePersistence = runtime.statePersistence ?? browserStatePersistence;
  const [status, setStatus] = useState("Connecting…");
  const [initializationPhase, setInitializationPhase] = useState<InitializationPhase>("starting");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [performanceStats, setPerformanceStats] = useState<SymtabPerformanceStats | null>(null);

  useEffect(() => {
    if (!settingsHydrated) return;
    void statePersistence.saveAppSetting(APP_STATE_KEY, settings).catch(() => undefined);
  }, [settings, settingsHydrated, statePersistence]);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createWorkspaceTab(1, documentFromLocation(DOCUMENT_LIBRARY, DEMO_DOCUMENT)),
  ]);
  const [activeTabId, setActiveTabId] = useState(1);

  const navigationHistory = useNavigationHistory(tabs, activeTabId);

  const [activeVaultId, setActiveVaultId] = useState("");
  const [sessionVaultId, setSessionVaultId] = useState("");
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [vaultDocuments, setVaultDocuments] = useState<DemoDocument[]>([]);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [availableVaults, setAvailableVaults] = useState<VaultLocation[]>([]);
  const [vaultQuery, setVaultQuery] = useState("");
  const [renameRequest, setRenameRequest] = useState<{ path: string; value: string }>();
  const [pdfExportDocument, setPdfExportDocument] = useState<DemoDocument | null>(null);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarRevealPath, setSidebarRevealPath] = useState<string | undefined>();
  const [sidebarSelectedPath, setSidebarSelectedPath] = useState<string | undefined>();
  const revealPathTimerRef = useRef<number | undefined>(undefined);
  const [leftSidebarPane, setLeftSidebarPane] = useState<LeftPane>("files");
  const [rightSidebarPane, setRightSidebarPane] = useState<RightPane>("backlinks");
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [sidebarIndexRevision, setSidebarIndexRevision] = useState(0);
  const [headingReveal, setHeadingReveal] = useState<{
    path: string;
    heading: string;
    line: number;
    request: number;
    absolute?: boolean;
  }>();
  const effectiveLeftSidebarPane: LeftPane =
    plugins[leftSidebarPane === "files" ? "file-explorer" : leftSidebarPane] !== false
      ? leftSidebarPane
      : plugins["file-explorer"] !== false
        ? "files"
        : plugins.search !== false
          ? "search"
          : "bookmarks";
  const [layoutState, setLayoutState] = useState<SymtabLayoutState>();
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [workspaceFileDrop, setWorkspaceFileDrop] = useState<{
    leafId: number;
    zone: "center" | "left" | "right" | "top" | "bottom";
  }>();
  const nextTabIdRef = useRef(2);
  const [workspaceRoot, setWorkspaceRoot] = useState<WorkspaceNode>({
    kind: "leaf",
    id: 1,
    view: "editor",
    tabIds: [1],
    activeTabId: 1,
  });
  const [activeLeafId, setActiveLeafId] = useState(1);
  const nextLeafIdRef = useRef(2);
  const windowIdRef = useRef("main");
  const sessionSaveTimerRef = useRef<number | undefined>(undefined);
  const sessionSaveChainRef = useRef(Promise.resolve());
  const latestSessionRef = useRef<PersistedWorkspaceSession | undefined>(undefined);
  const savedSessionSignatureRef = useRef("");
  const flushWorkspaceSessionRef = useRef<() => Promise<void>>(async () => undefined);
  const flushPendingSavesRef = useRef<(vaultId?: string) => Promise<void>>(async () => undefined);
  const savedDocumentsRef = useRef(new Map<string, DemoDocument>());
  const tabsRef = useRef(tabs);
  const fileEntriesRef = useRef<FileEntry[]>([]);
  const loadedFoldersRef = useRef(new Set<string>());
  const vaultFileVersionsRef = useRef(new Map<string, string>());
  const vaultLoadRef = useRef(0);
  const vaultOpenIntentRef = useRef(0);
  const activeVaultIdRef = useRef("");
  const graphVisibleRef = useRef(false);
  const referenceRequestsRef = useRef(new Map<string, Promise<DocumentReferences>>());
  const navigationIntentRef = useRef(0);
  const saveTimersRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const saveBasesRef = useRef(new Map<string, DemoDocument>());
  const pendingSavesRef = useRef(new Map<string, PendingDocumentSave>());
  const deferredTabLoadsRef = useRef(new Map<string, Promise<void>>());
  const indexingToastVaultRef = useRef<string | null>(null);
  const lastIndexingProgressRef = useRef<IndexingProgress | null>(null);

  useEffect(() => {
    if (plugins["graph-view"] !== false) return;
    const timer = window.setTimeout(() => {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaves(root, (leaf) =>
          leaf.view === "graph" ? { ...leaf, view: "editor" } : leaf
        )
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [plugins]);

  const activeLeaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
  const graphVisible = workspaceLeaves(workspaceRoot).some((leaf) => leaf.view === "graph");
  const visibleActiveTab = (() => {
    if (activeLeaf?.view !== "editor") return undefined;
    const leafTabs = activeLeaf.tabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t) => t !== undefined);
    return leafTabs.find((tab) => tab.id === activeLeaf.activeTabId) ?? leafTabs[0];
  })();

  const activeFilePath =
    visibleActiveTab?.document?.path ??
    visibleActiveTab?.pdf?.path ??
    visibleActiveTab?.preview?.path;
  const {
    bookmarks,
    groups: bookmarkGroups,
    dialogOpen: addBookmarkDialogOpen,
    setDialogOpen: setAddBookmarkDialogOpen,
    target: bookmarkTarget,
    openDialog: handleOpenAddBookmark,
    save: handleSaveBookmark,
    remove: handleRemoveBookmark,
    createGroup: handleCreateBookmarkGroup,
    includes: includesBookmark,
  } = useBookmarks({
    vaultId: vault?.id,
    persistence: runtime.statePersistence,
    defaultTarget: visibleActiveTab
      ? {
          title: visibleActiveTab.title,
          path: visibleActiveTab.document?.path || visibleActiveTab.pdf?.path,
        }
      : null,
    onStatus: setStatus,
  });
  const isTabBookmarked = (tab: WorkspaceTab) =>
    includesBookmark({
      title: tab.title,
      path: tab.document?.path || tab.pdf?.path,
    });

  const documents = useMemo(() => {
    const library = vault ? vaultDocuments : DOCUMENT_LIBRARY;
    const byPath = new Map(library.map((document) => [document.path ?? document.title, document]));
    for (const tab of tabs)
      if (tab.document) byPath.set(tab.document.path ?? tab.document.title, tab.document);

    // Include all non-ignored markdown files as stubs for autocomplete and linking
    if (vault) {
      for (const entry of fileEntries) {
        if (
          (entry.kind === "markdown" || entry.kind === "text") &&
          !isIgnoredPath(entry.path) &&
          !byPath.has(entry.path)
        ) {
          byPath.set(entry.path, {
            path: entry.path,
            title: titleFromPath(entry.path),
            content: "",
            contentHash: "",
          });
        }
      }
    }

    return [...byPath.values()];
  }, [tabs, vault, vaultDocuments, fileEntries]);
  const selectableVaults = useMemo(() => {
    const byPath = new Map<string, { key: string; name: string; path: string }>();
    for (const location of availableVaults) {
      byPath.set(location.path, {
        key: location.vaultId || location.path,
        name: location.name,
        path: location.path,
      });
    }
    for (const recent of recentVaults) {
      if (!byPath.has(recent.path)) {
        byPath.set(recent.path, {
          key: recent.vaultId,
          name: recent.displayName,
          path: recent.path,
        });
      }
    }
    return [...byPath.values()];
  }, [availableVaults, recentVaults]);
  const filteredSelectableVaults = useMemo(() => {
    const query = vaultQuery.trim().toLocaleLowerCase();
    return query
      ? selectableVaults.filter(({ name, path }) =>
          `${name}\n${path}`.toLocaleLowerCase().includes(query)
        )
      : selectableVaults;
  }, [selectableVaults, vaultQuery]);
  const leftEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "left")),
    [workspaceRoot]
  );
  const rightEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "right")),
    [workspaceRoot]
  );
  const searchVaultIndex = useCallback(
    (query: string, offset = 0, matchCase = false) => {
      void sidebarIndexRevision;
      if (!runtime.client || !vault) return Promise.resolve([]);
      return runtime.client.searchVault(vault.id, query, 100, offset, matchCase);
    },
    [runtime.client, sidebarIndexRevision, vault]
  );
  const loadDocumentReferences = useCallback(
    (path: string, includeUnlinked = false) => {
      void sidebarIndexRevision;
      if (!runtime.client || !vault) {
        return Promise.resolve({ linked: [], unlinked: [], outgoing: [] });
      }
      const key = `${vault.id}:${sidebarIndexRevision}:${path}:${includeUnlinked}`;
      const cached = referenceRequestsRef.current.get(key);
      if (cached) return cached;
      if (referenceRequestsRef.current.size >= 32) referenceRequestsRef.current.clear();
      const request = runtime.client
        .getDocumentReferences(vault.id, path, includeUnlinked)
        .catch((error) => {
          referenceRequestsRef.current.delete(key);
          throw error;
        });
      referenceRequestsRef.current.set(key, request);
      return request;
    },
    [runtime.client, sidebarIndexRevision, vault]
  );
  const loadVaultFacets = useCallback(() => {
    void sidebarIndexRevision;
    if (!runtime.client || !vault) return Promise.resolve({ tags: [], properties: [] });
    return runtime.client.getVaultFacets(vault.id);
  }, [runtime.client, sidebarIndexRevision, vault]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    graphVisibleRef.current = graphVisible;
  }, [graphVisible]);

  useEffect(() => {
    const toastId = "vault-indexing-progress";
    if (!vault) {
      if (indexingToastVaultRef.current) toast.dismiss(toastId);
      indexingToastVaultRef.current = null;
      lastIndexingProgressRef.current = null;
      return;
    }
    if (indexingToastVaultRef.current && indexingToastVaultRef.current !== vault.id) {
      toast.dismiss(toastId);
      indexingToastVaultRef.current = null;
      lastIndexingProgressRef.current = null;
    }
    if (lifecycle === "indexing" && indexing) {
      const total = Math.max(0, indexing.total);
      const processed = total
        ? Math.min(Math.max(0, indexing.processed), total)
        : Math.max(0, indexing.processed);
      const percent = total ? Math.round((processed / total) * 100) : 0;
      const progress = total
        ? `${processed.toLocaleString()} / ${total.toLocaleString()} files · ${percent}%`
        : "Scanning files…";
      const failures = indexing.failed ? ` · ${indexing.failed} failed` : "";
      indexingToastVaultRef.current = vault.id;
      lastIndexingProgressRef.current = indexing;
      toast.loading(`Indexing ${vault.name}`, {
        id: toastId,
        description: `${progress}${failures} · Search and backlinks may be incomplete.`,
        duration: Infinity,
      });
      return;
    }
    if (indexingToastVaultRef.current !== vault.id) return;
    const finalProgress = lastIndexingProgressRef.current;
    indexingToastVaultRef.current = null;
    lastIndexingProgressRef.current = null;
    if (lifecycle === "active") {
      toast.success(`${vault.name} indexed`, {
        id: toastId,
        description: finalProgress?.total
          ? `${finalProgress.total.toLocaleString()} files are ready.`
          : "Search, backlinks, and graph are ready.",
        duration: 4_000,
      });
    } else if (lifecycle === "degraded") {
      toast.error(`Indexing ${vault.name} needs attention`, {
        id: toastId,
        description: "Editing remains available. Rebuild the index from the warning banner.",
        duration: 8_000,
      });
    }
  }, [indexing, lifecycle, vault]);

  useEffect(() => {
    if (!runtime.getPerformanceStats) return;

    let active = true;
    const refreshPerformanceStats = async () => {
      try {
        const nextStats = await runtime.getPerformanceStats?.();
        if (active && nextStats) setPerformanceStats(nextStats);
      } catch {
        if (active) setPerformanceStats(null);
      }
    };

    void refreshPerformanceStats();
    const interval = window.setInterval(() => void refreshPerformanceStats(), 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [runtime]);

  const addTab = () => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const id = nextTabIdRef.current++;
    setTabs((current) => [...current, createWorkspaceTab(id)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
    revealSidebarPath(undefined);
  };

  const closeOtherTabs = (leafId: number, id: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const nextRoot = mapWorkspaceLeaf(
      closeOtherWorkspaceTabs(workspaceRoot, leafId, id),
      leafId,
      (leaf) => ({ ...leaf, view: workspaceTabView(tab) })
    );
    setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
    setActiveTabId(id);
    setActiveLeafId(leafId);
    setWorkspaceRoot(nextRoot);
    revealSidebarPath(tab?.document?.path ?? tab?.pdf?.path ?? tab?.preview?.path);
  };

  const closeTabsAfter = (leafId: number, id: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const closedRoot = closeWorkspaceTabsAfter(workspaceRoot, leafId, id);
    if (closedRoot === workspaceRoot) return;
    const nextLeaf = findWorkspaceLeaf(closedRoot, leafId);
    if (!nextLeaf) return;
    const nextActiveTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
    const nextRoot = mapWorkspaceLeaf(closedRoot, leafId, (leaf) => ({
      ...leaf,
      view: workspaceTabView(nextActiveTab),
    }));
    setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
    setWorkspaceRoot(nextRoot);
    if (activeLeafId === leafId) {
      setActiveTabId(nextLeaf.activeTabId);
      revealSidebarPath(
        nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
      );
    }
  };

  const closeAllTabs = (leafId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    if (!leaf) return;
    if (workspaceLeaves(workspaceRoot).length > 1) {
      const nextRoot = removeWorkspaceLeaf(workspaceRoot, leafId);
      if (!nextRoot) return;
      const nextLeaf = findWorkspaceLeaf(nextRoot, activeLeafId) ?? workspaceLeaves(nextRoot)[0];
      setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
      setWorkspaceRoot(nextRoot);
      setActiveLeafId(nextLeaf.id);
      setActiveTabId(nextLeaf.activeTabId);
      const nextActiveTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
      revealSidebarPath(
        nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
      );
      return;
    }
    const replacement = createWorkspaceTab(nextTabIdRef.current++);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
    setWorkspaceRoot({
      ...leaf,
      view: "editor",
      tabIds: [replacement.id],
      activeTabId: replacement.id,
    });
    revealSidebarPath(undefined);
  };

  const togglePinned = (id: number) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
    );
  };

  const updateTab = (id: number, update: (tab: WorkspaceTab) => WorkspaceTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? update(tab) : tab)));
  };

  const setLeafView = (id: number, view: WorkspaceLeafView) => {
    navigationIntentRef.current += 1;
    setWorkspaceRoot((root) => mapWorkspaceLeaf(root, id, (leaf) => ({ ...leaf, view })));
    setActiveLeafId(id);
  };

  const splitLeaf = (id: number, direction: "horizontal" | "vertical") => {
    navigationIntentRef.current += 1;
    const secondLeafId = nextLeafIdRef.current++;
    const splitId = nextLeafIdRef.current++;
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, id, (leaf) => ({
        kind: "split",
        id: splitId,
        direction,
        children: [leaf, { ...leaf, id: secondLeafId, tabIds: [leaf.activeTabId] }],
      }))
    );
    setActiveLeafId(secondLeafId);
  };

  const closeLeafTab = (leafId: number, tabId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!leaf || !tab) return;

    const leaves = workspaceLeaves(workspaceRoot);
    if (leaves.length === 1 && leaf.tabIds.length === 1) {
      if (!tab.kind && !tab.document && !tab.pdf && !tab.preview) return;
      const replacement = createWorkspaceTab(nextTabIdRef.current++);
      setTabs((current) => [...current.filter((candidate) => candidate.id !== tabId), replacement]);
      setWorkspaceRoot({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      });
      setActiveTabId(replacement.id);
      revealSidebarPath(undefined);
      return;
    }

    if (leaf.tabIds.length === 1) {
      const nextRoot = removeWorkspaceLeaf(workspaceRoot, leafId);
      if (!nextRoot) return;
      const nextLeaf = workspaceLeaves(nextRoot)[0];
      setWorkspaceRoot(nextRoot);
      setActiveLeafId(nextLeaf.id);
      setActiveTabId(nextLeaf.activeTabId);
      if (!workspaceHasTab(nextRoot, tabId)) {
        setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
      }
      const activeTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
      revealSidebarPath(
        activeTab?.document?.path ?? activeTab?.pdf?.path ?? activeTab?.preview?.path
      );
      return;
    }

    const index = leaf.tabIds.indexOf(tabId);
    const tabIds = leaf.tabIds.filter((id) => id !== tabId);
    const nextActiveId =
      leaf.activeTabId === tabId
        ? index > 0
          ? leaf.tabIds[index - 1]
          : tabIds[0]
        : leaf.activeTabId;
    const nextActiveTab = tabs.find((candidate) => candidate.id === nextActiveId);
    const nextRoot = mapWorkspaceLeaf(workspaceRoot, leafId, (current) => ({
      ...current,
      view: workspaceTabView(nextActiveTab),
      tabIds,
      activeTabId: nextActiveId,
    }));
    setWorkspaceRoot(nextRoot);
    setActiveTabId(nextActiveId);
    if (!workspaceHasTab(nextRoot, tabId)) {
      setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
    }
    revealSidebarPath(
      nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
    );
  };

  const replaceWorkspaceDocument = (document: DemoDocument | null) => {
    navigationIntentRef.current += 1;
    const replacement = createWorkspaceTab(1, document);
    setTabs([replacement]);
    setActiveTabId(1);
    nextTabIdRef.current = 2;
    setWorkspaceRoot({ kind: "leaf", id: 1, view: "editor", tabIds: [1], activeTabId: 1 });
    setActiveLeafId(1);
    revealSidebarPath(document?.path);
  };

  const fetchFileChildren = async (vaultId: string, parent: string) => {
    const entries: FileEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await runtime.client!.listFileChildren(vaultId, parent, cursor);
      entries.push(...page.entries);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return entries;
  };

  const refreshFiles = async (
    vaultId = vault?.id,
    isCurrent = () => activeVaultIdRef.current === vaultId
  ) => {
    if (!runtime.client || !vaultId) return [];
    const parents = ["", ...loadedFoldersRef.current];
    const entries = (
      await mapWithConcurrency(parents, 4, (parent) => fetchFileChildren(vaultId, parent))
    ).flat();
    if (!isCurrent()) return entries;
    fileEntriesRef.current = entries;
    setFileEntries(entries);
    return entries;
  };

  const loadFolderChildren = async (parent: string) => {
    if (!runtime.client || !vault || loadedFoldersRef.current.has(parent)) return;
    const vaultId = vault.id;
    const children = await fetchFileChildren(vaultId, parent);
    if (activeVaultIdRef.current !== vaultId) return;
    loadedFoldersRef.current.add(parent);
    const byPath = new Map(fileEntriesRef.current.map((entry) => [entry.path, entry]));
    for (const entry of children) byPath.set(entry.path, entry);
    const entries = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    fileEntriesRef.current = entries;
    setFileEntries(entries);
  };

  const {
    open: trashOpen,
    setOpen: setTrashOpen,
    entries: trashEntries,
    filteredEntries: filteredTrashEntries,
    query: trashQuery,
    setQuery: setTrashQuery,
    deleteRequest: permanentDeleteRequest,
    setDeleteRequest: setPermanentDeleteRequest,
    emptyRequest: emptyTrashRequest,
    setEmptyRequest: setEmptyTrashRequest,
    refresh: refreshTrash,
    show: openTrash,
    restore: restoreTrashEntry,
    permanentlyDelete: permanentlyDeleteTrashEntry,
    empty: emptyTrash,
  } = useTrash({
    client: runtime.client,
    vaultId: vault?.id,
    refreshFiles: () => refreshFiles(),
    onStatus: setStatus,
  });

  const refreshVaultGraph = async (vaultId = vault?.id) => {
    if (!runtime.client || !vaultId) return null;
    const graph = await runtime.client.getGraph(vaultId);
    if (activeVaultIdRef.current !== vaultId) return null;
    setVaultGraph(graph);
    return graph;
  };

  const refreshVaultDocuments = async (vaultId: string, entries: FileEntry[]) => {
    if (!runtime.client) return [];
    const previousDocuments = new Map(savedDocumentsRef.current);
    const markdownEntries = entries.filter(
      (entry) =>
        (entry.kind === "markdown" || entry.kind === "text") &&
        savedDocumentsRef.current.has(entry.path)
    );
    const loaded = await Promise.all(
      markdownEntries.map(async (entry) => {
        const version = `${entry.modifiedAt}:${entry.sizeBytes}`;
        const cached = savedDocumentsRef.current.get(entry.path);
        if (cached && vaultFileVersionsRef.current.get(entry.path) === version) return cached;
        const file = await runtime.client!.readFile(vaultId, entry.path);
        return {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        } satisfies DemoDocument;
      })
    );
    if (activeVaultIdRef.current !== vaultId) return [];
    const visiblePaths = new Set(entries.map((entry) => entry.path));
    for (const path of savedDocumentsRef.current.keys()) {
      if (!visiblePaths.has(path)) savedDocumentsRef.current.delete(path);
    }
    for (const path of vaultFileVersionsRef.current.keys()) {
      if (!visiblePaths.has(path)) vaultFileVersionsRef.current.delete(path);
    }
    const resolved = [...loaded];
    const cleanUpdates = new Map<string, DemoDocument>();
    for (let index = 0; index < loaded.length; index += 1) {
      const document = loaded[index];
      const entry = markdownEntries[index];
      if (document?.path && entry) {
        const previous = previousDocuments.get(document.path);
        const locallyEdited = Boolean(
          previous &&
          tabsRef.current.some(
            (tab) =>
              tab.document?.path === document.path && tab.document?.content !== previous.content
          )
        );
        if (locallyEdited && previous && document.contentHash !== previous.contentHash) {
          resolved[index] = previous;
          continue;
        }
        savedDocumentsRef.current.set(document.path, document);
        vaultFileVersionsRef.current.set(entry.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        if (document.contentHash !== previous?.contentHash)
          cleanUpdates.set(document.path, document);
      }
    }
    if (cleanUpdates.size) {
      setTabs((current) =>
        current.map((tab) => {
          const document = tab.document?.path ? cleanUpdates.get(tab.document.path) : undefined;
          return document ? { ...tab, title: document.title, document } : tab;
        })
      );
    }
    setVaultDocuments(resolved);

    return resolved;
  };

  const loadVault = async (info: VaultInfo, openIntent: number) => {
    if (!runtime.client || vaultOpenIntentRef.current !== openIntent) return false;
    navigationIntentRef.current += 1;
    const load = ++vaultLoadRef.current;
    const isCurrent = () =>
      vaultLoadRef.current === load && vaultOpenIntentRef.current === openIntent;
    setInitializationPhase("cache");
    setStatus(`Loading ${info.name} cache…`);
    let entries = await fetchFileChildren(info.id, "");
    if (!isCurrent()) return false;
    const persisted = await statePersistence.loadWorkspaceSession(windowIdRef.current, info.id);
    if (!isCurrent()) return false;
    activeVaultIdRef.current = info.id;
    setAppVault(info, "initializing", null);
    setSessionVaultId("");
    setVault(info);
    setActiveVaultId(info.id);
    setVaultDocuments([]);
    setVaultGraph(null);
    setExpandedFolders([]);
    setLayoutState(undefined);
    savedDocumentsRef.current.clear();
    saveBasesRef.current.clear();
    vaultFileVersionsRef.current.clear();
    loadedFoldersRef.current.clear();
    fileEntriesRef.current = entries;
    setFileEntries(entries);
    void refreshVaultGraph(info.id).catch(() => undefined);
    setInitializationPhase("workspace");
    setStatus(`Restoring ${info.name} workspace…`);
    if (persisted?.expandedFolders?.length) {
      const restoredChildren = (
        await mapWithConcurrency(persisted.expandedFolders, 4, async (parent) => {
          try {
            return await fetchFileChildren(info.id, parent);
          } catch {
            return [];
          }
        })
      ).flat();
      if (!isCurrent()) return false;
      for (const parent of persisted.expandedFolders) loadedFoldersRef.current.add(parent);
      entries = [
        ...new Map([...entries, ...restoredChildren].map((entry) => [entry.path, entry])).values(),
      ];
      fileEntriesRef.current = entries;
      setFileEntries(entries);
    }
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const requestedTabs = persisted?.tabs ?? [];
    const eagerTabIds = new Set<number>();
    if (persisted?.activeTabId) eagerTabIds.add(persisted.activeTabId);
    if (persisted?.workspaceRoot) {
      for (const leaf of workspaceLeaves(persisted.workspaceRoot))
        eagerTabIds.add(leaf.activeTabId);
    }
    const restored = await Promise.all(
      requestedTabs.map(async ({ id, path, kind, graphRootPath, mode, pinned }, index) => {
        try {
          if (kind === "graph") {
            return {
              ...createGraphWorkspaceTab(id || index + 1, graphRootPath),
              mode,
              pinned,
            };
          }
          if (!path) return null;
          if (!eagerTabIds.has(id)) {
            return {
              ...createWorkspaceTab(id || index + 1),
              title: fileTitleFromPath(path),
              deferred: { path },
              mode,
              pinned,
            };
          }
          let entry = entryByPath.get(path);
          if (!entry) entry = (await runtime.client!.getFileMetadata(info.id, path)) ?? undefined;
          // Workspace state may outlive a format-policy change or an external delete.
          // Only restore files that are still part of the Obsidian-compatible vault view.
          if (!entry || entry.kind === "directory") return null;
          if (entry?.kind === "binary") {
            const data = await runtime.client!.readBinaryFile(info.id, path);
            if (/\.pdf$/i.test(path)) {
              return {
                ...createWorkspaceTab(id || index + 1),
                title: fileTitleFromPath(path),
                pdf: { path, data },
                mode,
                pinned,
              };
            }
            const mimeType = mimeTypeForPath(path);
            if (/^(image|audio|video)\//.test(mimeType) || decodedText(data) === null) {
              return {
                ...createWorkspaceTab(id || index + 1),
                title: fileTitleFromPath(path),
                preview: { path, data, mimeType },
                mode,
                pinned,
              };
            }
          }
          const file = await runtime.client!.readFile(info.id, path);
          if (!isCurrent()) return null;
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(path, document);
          if (entry)
            vaultFileVersionsRef.current.set(path, `${entry.modifiedAt}:${entry.sizeBytes}`);
          return { ...createWorkspaceTab(id || index + 1, document), mode, pinned };
        } catch {
          return null;
        }
      })
    );
    if (!isCurrent()) return false;
    const loaded = restored.flatMap((tab) => (tab ? [tab] : []));
    setVaultDocuments(loaded.flatMap((tab) => (tab.document ? [tab.document] : [])));
    if (!loaded.length) {
      replaceWorkspaceDocument(null);
    } else {
      const active =
        loaded.find((tab) => tab.id === persisted?.activeTabId) ??
        loaded.find((tab) => workspaceTabPath(tab) === persisted?.activePath) ??
        loaded[0];
      const tabIds = loaded.map((tab) => tab.id);
      const restoredRoot = restoreWorkspaceRoot(persisted?.workspaceRoot, new Set(tabIds));
      const baseRoot: WorkspaceNode = restoredRoot ?? {
        kind: "leaf",
        id: 1,
        view: workspaceTabView(active),
        tabIds,
        activeTabId: active.id,
      };
      const tabById = new Map(loaded.map((tab) => [tab.id, tab]));
      const nextRoot = mapWorkspaceLeaves(baseRoot, (leaf) => {
        const tab = tabById.get(leaf.activeTabId);
        return {
          ...leaf,
          view: tab?.kind === "graph" ? "graph" : leaf.view === "graph" ? "editor" : leaf.view,
        };
      });
      setTabs(loaded);
      nextTabIdRef.current = Math.max(...tabIds) + 1;
      setWorkspaceRoot(nextRoot);
      const restoredActiveLeaf = persisted?.activeLeafId
        ? findWorkspaceLeaf(nextRoot, persisted.activeLeafId)
        : null;
      const nextActiveLeaf = restoredActiveLeaf ?? workspaceLeaves(nextRoot)[0];
      setActiveLeafId(nextActiveLeaf.id);
      setActiveTabId(nextActiveLeaf.activeTabId);
      nextLeafIdRef.current = maxWorkspaceNodeId(nextRoot) + 1;
    }
    if (persisted?.leftSidebarPane) setLeftSidebarPane(persisted.leftSidebarPane);
    if (persisted?.rightSidebarPane) {
      setRightSidebarPane(
        persisted.rightSidebarPane === "outline" || persisted.rightSidebarPane === "source-control"
          ? "backlinks"
          : persisted.rightSidebarPane
      );
    } else {
      setRightSidebarPane("backlinks");
    }
    if (persisted?.layout) setLayoutState(persisted.layout);
    if (persisted?.expandedFolders) setExpandedFolders(persisted.expandedFolders);
    setSessionVaultId(info.id);
    setVaultPickerOpen(false);
    setStatus(`Go backend connected · ${info.name}`);
    const nextIndexing = (info as IndexedVaultInfo).indexing ?? null;
    setLifecycle(nextIndexing ? "indexing" : lifecycleFromVault(info), nextIndexing);
    return true;
  };

  useEffect(() => {
    if (!vault || sessionVaultId !== vault.id) return;
    const persisted: PersistedWorkspaceSession = {
      version: 1,
      vaultId: vault.id,
      tabs: tabs.flatMap((tab): PersistedWorkspaceTab[] =>
        tab.kind === "graph"
          ? [
              {
                id: tab.id,
                kind: tab.kind,
                graphRootPath: tab.graphRootPath,
                mode: tab.mode,
                pinned: Boolean(tab.pinned),
              },
            ]
          : workspaceTabPath(tab)
            ? [
                {
                  id: tab.id,
                  path: workspaceTabPath(tab),
                  mode: tab.mode,
                  pinned: Boolean(tab.pinned),
                },
              ]
            : []
      ),
      activePath: (() => {
        const tab = tabs.find((candidate) => candidate.id === activeTabId);
        return tab ? workspaceTabPath(tab) : undefined;
      })(),
      activeTabId,
      workspaceRoot,
      activeLeafId,
      leftSidebarPane: effectiveLeftSidebarPane,
      rightSidebarPane,
      layout: layoutState,
      expandedFolders,
    };
    latestSessionRef.current = persisted;
    setStoredWorkspace(persisted);
    window.clearTimeout(sessionSaveTimerRef.current);
    const signature = JSON.stringify(persisted);
    if (signature === savedSessionSignatureRef.current) return;
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .then(() => {
          savedSessionSignatureRef.current = signature;
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(sessionSaveTimerRef.current);
  }, [
    activeLeafId,
    activeTabId,
    effectiveLeftSidebarPane,
    layoutState,
    expandedFolders,
    rightSidebarPane,
    sessionVaultId,
    setStoredWorkspace,
    statePersistence,
    tabs,
    vault,
    workspaceRoot,
  ]);

  const flushWorkspaceSession = async () => {
    const persisted = latestSessionRef.current;
    window.clearTimeout(sessionSaveTimerRef.current);
    if (persisted && JSON.stringify(persisted) !== savedSessionSignatureRef.current) {
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .then(() => {
          savedSessionSignatureRef.current = JSON.stringify(persisted);
        });
    }
    await sessionSaveChainRef.current;
  };
  useEffect(() => {
    flushWorkspaceSessionRef.current = flushWorkspaceSession;
  });

  useEffect(() => {
    const flushSession = () => void flushWorkspaceSessionRef.current().catch(() => undefined);
    window.addEventListener("pagehide", flushSession);
    return () => window.removeEventListener("pagehide", flushSession);
  }, []);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let applying = Promise.resolve();
    const reconcile = async () => {
      const parents = ["", ...loadedFoldersRef.current];
      const entries = (
        await mapWithConcurrency(parents, 4, (parent) => fetchFileChildren(vault.id, parent))
      ).flat();
      if (!active) return;
      fileEntriesRef.current = entries;
      setFileEntries(entries);
      await refreshVaultDocuments(vault.id, entries);
      if (graphVisibleRef.current) await refreshVaultGraph(vault.id);
    };

    const applyChange = async (change: VaultChange) => {
      const nextProgress = change.vault.indexing ?? null;
      setLifecycle(nextProgress ? "indexing" : lifecycleFromVault(change.vault), nextProgress);
      const events = change.events ?? [];
      if (change.reconcile || events.some((event) => event.op === "reconcile")) {
        await reconcile();
        return;
      }
      if (!events.length) return;

      const byPath = new Map(fileEntriesRef.current.map((entry) => [entry.path, entry]));
      for (const event of events) {
        if (!event.path) continue;
        if (event.op === "remove") {
          for (const path of byPath.keys()) {
            if (path === event.path || path.startsWith(`${event.path}/`)) byPath.delete(path);
          }
          continue;
        }
        const entry = await runtime.client!.getFileMetadata(vault.id, event.path);
        if (entry?.kind === "directory" && event.op === "create") {
          await reconcile();
          return;
        }
        if (entry) byPath.set(entry.path, entry);
        else byPath.delete(event.path);
      }
      if (!active) return;
      const entries = [...byPath.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      );
      fileEntriesRef.current = entries;
      setFileEntries(entries);
      await refreshVaultDocuments(vault.id, entries);
      if (graphVisibleRef.current) await refreshVaultGraph(vault.id);
    };

    const stop = runtime.client.watchVaultChanges(
      vault.id,
      (change) => {
        if (!active) return;
        setSidebarIndexRevision(change.revision);
        applying = applying.then(() => applyChange(change)).catch(() => reconcile());
      },
      () => {
        // Browser EventSource and the desktop bridge reconnect automatically.
      }
    );
    return () => {
      active = false;
      stop();
    };
    // runtime client is shell-owned; vault id selects watcher stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.client, vault?.id]);

  useEffect(() => {
    if (!graphVisible || !runtime.client || !vault) return;
    void refreshVaultGraph(vault.id).catch(() => undefined);
    // Graph data stays unloaded until a graph pane exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphVisible, runtime.client, vault?.id]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let timer: number | undefined;

    const refreshLifecycle = async () => {
      try {
        const info = (await runtime.client!.getVaultInfo(vault.id)) as IndexedVaultInfo;
        if (!active) return;
        const nextLifecycle = info.indexing ? "indexing" : lifecycleFromVault(info);
        setLifecycle(nextLifecycle, info.indexing ?? null);
        if (
          nextLifecycle === "initializing" ||
          nextLifecycle === "read_only_ready" ||
          nextLifecycle === "writable" ||
          nextLifecycle === "indexing"
        ) {
          timer = window.setTimeout(() => void refreshLifecycle(), 500);
        }
      } catch {
        if (active) timer = window.setTimeout(() => void refreshLifecycle(), 1_500);
      }
    };

    if (lifecycle !== "active" && lifecycle !== "degraded") void refreshLifecycle();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [lifecycle, runtime.client, setLifecycle, vault]);

  const chooseVault = async (mode: "open" | "create") => {
    if (!runtime.client || !runtime.selectVaultDirectory) return;
    const path = await runtime.selectVaultDirectory(mode);
    if (!path) return;
    const openIntent = ++vaultOpenIntentRef.current;
    try {
      if (vault) await flushPendingSaves(vault.id);
    } catch (error) {
      toast.error("Could not switch vault", {
        description: `Save the current note first. ${errorMessage(error)}`,
      });
      return;
    }
    if (vaultOpenIntentRef.current !== openIntent) return;
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setInitializationPhase("vault");
    setStatus(mode === "create" ? "Creating vault…" : "Initializing vault…");
    try {
      await runWithToast(
        (async () => {
          const info =
            mode === "create"
              ? await runtime.client!.createVault({ path })
              : await runtime.client!.openVault({ path });
          if (!(await loadVault(info, openIntent))) return;
          if (runtime.vaultAccess !== "registry") {
            await statePersistence.rememberVault({ id: info.id, name: info.name, path });
          }
          const [recent, available] = await Promise.all([
            runtime.client!.listRecentVaults(),
            runtime.client!.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
        })(),
        {
          loading: mode === "create" ? "Creating vault…" : "Opening vault…",
          success: mode === "create" ? "Vault created" : "Vault opened",
          error: mode === "create" ? "Could not create vault" : "Could not open vault",
        }
      );
    } catch (error) {
      if (vaultOpenIntentRef.current !== openIntent) return;
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const openRegisteredVault = async (registered: { name: string; path: string }) => {
    if (!runtime.client) return;
    const openIntent = ++vaultOpenIntentRef.current;
    try {
      if (vault) await flushPendingSaves(vault.id);
    } catch (error) {
      toast.error("Could not switch vault", {
        description: `Save the current note first. ${errorMessage(error)}`,
      });
      return;
    }
    if (vaultOpenIntentRef.current !== openIntent) return;
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setInitializationPhase("vault");
    setStatus(`Initializing ${registered.name}…`);
    try {
      await runWithToast(
        (async () => {
          const info = await runtime.client!.openVault({ path: registered.path });
          if (!(await loadVault(info, openIntent))) return;
          if (runtime.vaultAccess !== "registry") {
            await statePersistence.rememberVault({
              id: info.id,
              name: info.name,
              path: registered.path,
            });
          }
          const [recent, available] = await Promise.all([
            runtime.client!.listRecentVaults(),
            runtime.client!.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
        })(),
        {
          loading: `Opening ${registered.name}…`,
          success: "Vault opened",
          error: "Could not open vault",
        }
      );
    } catch (error) {
      if (vaultOpenIntentRef.current !== openIntent) return;
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const forgetRegisteredVault = async (vaultId: string) => {
    if (!runtime.client) return;
    try {
      await runtime.client.forgetVault(vaultId);
      setRecentVaults((current) => current.filter((item) => item.vaultId !== vaultId));
      toast.success("Vault removed from recent list");
    } catch (error) {
      toast.error("Could not forget vault", { description: errorMessage(error) });
    }
  };

  const rebuildIndex = async () => {
    if (!runtime.client || !vault) return;
    try {
      await runtime.client.rebuildIndex(vault.id);
      setLifecycle("indexing", { phase: "scanning", processed: 0, total: 0, failed: 0 });
      toast.success("Index rebuild started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rebuild index");
    }
  };

  const documentSaveKey = (vaultId: string, path: string) => `${vaultId}:${path}`;

  const persistDocument = async (request: PendingDocumentSave) => {
    const path = request.document.path;
    if (!runtime.client || !path) return;
    const { vaultId, tabId, document, content } = request;
    const key = documentSaveKey(vaultId, path);
    const saved = saveBasesRef.current.get(key) ?? document;
    if (!saved.contentHash || saved.content === content) return;
    const result = await runtime.client.patchFile({
      vaultId,
      path,
      expectedHash: saved.contentHash,
      edits: [singleTextEdit(saved.content, content)],
    });
    const next = { ...saved, content, contentHash: result.contentHash };
    saveBasesRef.current.set(key, next);
    if (activeVaultIdRef.current !== vaultId) return;
    savedDocumentsRef.current.set(path, next);
    setVaultDocuments((current) =>
      current.map((item) =>
        item.path === path ? { ...item, content, contentHash: result.contentHash } : item
      )
    );
    updateTab(tabId, (tab) => {
      const tabDocument = tab.document;
      return tabDocument?.path === path && tabDocument.content === content
        ? { ...tab, document: { ...tabDocument, contentHash: result.contentHash } }
        : tab;
    });
  };

  const enqueueSave = (request: PendingDocumentSave) => {
    if (!request.document.path) return Promise.resolve();
    const key = documentSaveKey(request.vaultId, request.document.path);
    const previous = saveChainsRef.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => persistDocument(request));
    saveChainsRef.current.set(key, next);
    void next
      .finally(() => {
        if (saveChainsRef.current.get(key) === next) saveChainsRef.current.delete(key);
      })
      .catch(() => undefined);
    return next;
  };

  const scheduleSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!vault || !document.path || !document.contentHash) return;
    const request = { vaultId: vault.id, tabId, document, content };
    const key = documentSaveKey(vault.id, document.path);
    if (!saveBasesRef.current.has(key)) {
      saveBasesRef.current.set(key, savedDocumentsRef.current.get(document.path) ?? document);
    }
    pendingSavesRef.current.set(key, request);
    const existing = saveTimersRef.current.get(key);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(key);
      pendingSavesRef.current.delete(key);
      void enqueueSave(request).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown save error";
        setStatus(`Save failed · ${message}`);
        toast.error(`Could not save ${titleFromPath(document.path!)}`, { description: message });
      });
    }, 500);
    saveTimersRef.current.set(key, timer);
  };

  const flushPendingSaves = async (vaultId?: string) => {
    const saves = new Set<Promise<void>>();
    for (const [key, request] of pendingSavesRef.current) {
      if (vaultId && request.vaultId !== vaultId) continue;
      const timer = saveTimersRef.current.get(key);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.delete(key);
      pendingSavesRef.current.delete(key);
      saves.add(enqueueSave(request));
    }
    for (const [key, save] of saveChainsRef.current) {
      if (!vaultId || key.startsWith(`${vaultId}:`)) saves.add(save);
    }
    await Promise.all(saves);
  };
  useEffect(() => {
    flushPendingSavesRef.current = flushPendingSaves;
  });

  const {
    managerOpen: pluginManagerOpen,
    setManagerOpen: setPluginManagerOpen,
    catalog: pluginCatalog,
    marketplace: marketplacePlugins,
    marketplaceError,
    section: pluginSection,
    setSection: setPluginSection,
    settings: pluginSettings,
    vaultPlugins,
    busy: pluginBusy,
    revision: pluginRuntimeRevision,
    view: pluginView,
    setView: setPluginView,
    query: pluginQuery,
    setQuery: setPluginQuery,
    hostRef: pluginHostRef,
    openManager: openPluginManager,
    openView: openPluginSurface,
    ribbonItems: pluginRibbonItems,
    location: pluginViewLocation,
    installFile: installPlugin,
    installMarketplace: installMarketplacePlugin,
    saveSetting: savePluginSetting,
    update: updatePlugin,
    invokeCapability: invokePluginViewCapability,
  } = usePlugins({
    client: runtime.client,
    vault,
    openWindow: runtime.openWindow,
    flushPendingSaves,
  });

  useEffect(() => {
    const flushCurrentVault = () => {
      if (vault) void flushPendingSavesRef.current(vault.id);
    };
    const flushAll = () => void flushPendingSavesRef.current();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushCurrentVault();
    };
    window.addEventListener("blur", flushCurrentVault);
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("blur", flushCurrentVault);
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [vault]);

  useEffect(() => {
    if (!runtime.onBeforeShutdown) return;
    return runtime.onBeforeShutdown(async () => {
      await Promise.allSettled([
        flushWorkspaceSessionRef.current(),
        flushPendingSavesRef.current(),
      ]);
    });
  }, [runtime]);

  const movePath = async (
    sourcePath: string,
    destinationPath: string,
    feedback: AsyncFeedback | null = {
      loading: `Moving ${sourcePath}…`,
      success: `Moved to ${destinationPath}`,
      error: `Could not move ${sourcePath}`,
    }
  ) => {
    if (!runtime.client || !vault || sourcePath === destinationPath) return false;
    try {
      const operation = (async () => {
        await flushPendingSaves(vault.id);
        const movedEntry = await runtime.client!.moveFile({
          vaultId: vault.id,
          sourcePath,
          destinationPath,
        });
        setTabs((current) =>
          current.map((tab) => {
            if (tab.deferred) {
              const path = movedDocumentPath(tab.deferred.path, sourcePath, destinationPath);
              return path === tab.deferred.path
                ? tab
                : { ...tab, title: fileTitleFromPath(path), deferred: { path } };
            }
            if (tab.pdf) {
              const path = movedDocumentPath(tab.pdf.path, sourcePath, destinationPath);
              return path === tab.pdf.path
                ? tab
                : { ...tab, title: fileTitleFromPath(path), pdf: { ...tab.pdf, path } };
            }
            if (tab.preview) {
              const path = movedDocumentPath(tab.preview.path, sourcePath, destinationPath);
              return path === tab.preview.path
                ? tab
                : {
                    ...tab,
                    title: fileTitleFromPath(path),
                    preview: { ...tab.preview, path, mimeType: mimeTypeForPath(path) },
                  };
            }
            if (!tab.document?.path) return tab;
            const path = movedDocumentPath(tab.document.path, sourcePath, destinationPath);
            return path === tab.document.path
              ? tab
              : {
                  ...tab,
                  title: titleFromPath(path),
                  document: { ...tab.document, path, title: titleFromPath(path) },
                };
          })
        );
        setVaultDocuments((current) =>
          current.map((document) => {
            if (!document.path) return document;
            const path = movedDocumentPath(document.path, sourcePath, destinationPath);
            return path === document.path
              ? document
              : { ...document, path, title: titleFromPath(path) };
          })
        );
        for (const [path, document] of savedDocumentsRef.current) {
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            savedDocumentsRef.current.delete(path);
            savedDocumentsRef.current.set(nextPath, {
              ...document,
              path: nextPath,
              title: titleFromPath(nextPath),
            });
          }
        }
        for (const [key, document] of saveBasesRef.current) {
          const prefix = `${vault.id}:`;
          if (!key.startsWith(prefix)) continue;
          const path = key.slice(prefix.length);
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            saveBasesRef.current.delete(key);
            saveBasesRef.current.set(documentSaveKey(vault.id, nextPath), {
              ...document,
              path: nextPath,
              title: titleFromPath(nextPath),
            });
          }
        }
        for (const [path, version] of vaultFileVersionsRef.current) {
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            vaultFileVersionsRef.current.delete(path);
            vaultFileVersionsRef.current.set(nextPath, version);
          }
        }
        setFileEntries((current) => {
          const next = current.map((item) => {
            const path = movedDocumentPath(item.path, sourcePath, destinationPath);
            if (path === item.path) return item;
            return item.path === sourcePath
              ? movedEntry
              : { ...item, path, name: path.split("/").at(-1) ?? item.name };
          });
          fileEntriesRef.current = next;
          return next;
        });
        setExpandedFolders((current) =>
          current.map((path) => movedDocumentPath(path, sourcePath, destinationPath))
        );
        loadedFoldersRef.current = new Set(
          [...loadedFoldersRef.current].map((path) =>
            movedDocumentPath(path, sourcePath, destinationPath)
          )
        );
        setStatus(`Moved · ${destinationPath}`);
      })();
      if (feedback) await runWithToast(operation, feedback);
      else await operation;
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Move failed");
      return false;
    }
  };

  const renamePath = (sourcePath: string, requestedName?: string) => {
    const name = requestedName?.trim();
    if (!name) return;
    const parent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const sourceEntry = fileEntries.find((entry) => entry.path === sourcePath);
    const extension =
      sourceEntry?.kind === "directory" ? "" : (sourcePath.match(/\.[^./]+$/)?.[0] ?? "");
    const finalName =
      extension && !name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
        ? `${name}${extension}`
        : name;
    const destinationPath = parent ? `${parent}/${finalName}` : finalName;
    void movePath(sourcePath, destinationPath, {
      loading: `Renaming ${sourcePath}…`,
      success: `Renamed to ${finalName}`,
      error: `Could not rename ${sourcePath}`,
    });
  };

  const deletePath = async (path: string) => {
    if (!runtime.client || !vault) return;
    if (general.confirmDeleteNote && !window.confirm(`Are you sure you want to delete "${path}"?`))
      return;
    try {
      await runWithToast(
        (async () => {
          for (const document of tabs.map((tab) => tab.document)) {
            if (
              !document?.path ||
              (document.path !== path && !document.path.startsWith(`${path}/`))
            )
              continue;
            const key = documentSaveKey(vault.id, document.path);
            const timer = saveTimersRef.current.get(key);
            if (timer) window.clearTimeout(timer);
            saveTimersRef.current.delete(key);
            pendingSavesRef.current.delete(key);
            const inFlight = saveChainsRef.current.get(key);
            if (inFlight) await inFlight;
            saveBasesRef.current.delete(key);
            savedDocumentsRef.current.delete(document.path);
          }
          await runtime.client!.deleteFile(vault.id, path);
          let nextTabs = tabs.filter((tab) => {
            const candidate = workspaceTabPath(tab);
            return !candidate || (candidate !== path && !candidate.startsWith(`${path}/`));
          });
          let nextRoot = restoreWorkspaceRoot(
            workspaceRoot,
            new Set(nextTabs.map((tab) => tab.id))
          );
          if (!nextRoot) {
            const replacement = createWorkspaceTab(nextTabIdRef.current++);
            nextTabs = [...nextTabs, replacement];
            nextRoot = {
              kind: "leaf",
              id: nextLeafIdRef.current++,
              view: "editor",
              tabIds: [replacement.id],
              activeTabId: replacement.id,
            };
          }
          const nextLeaf =
            findWorkspaceLeaf(nextRoot, activeLeafId) ?? workspaceLeaves(nextRoot)[0];
          setTabs(nextTabs);
          setWorkspaceRoot(nextRoot);
          setActiveLeafId(nextLeaf.id);
          setActiveTabId(nextLeaf.activeTabId);
          setVaultDocuments((current) =>
            current.filter(
              (document) =>
                !document.path || (document.path !== path && !document.path.startsWith(`${path}/`))
            )
          );
          setFileEntries((current) => {
            const next = current.filter(
              (entry) => entry.path !== path && !entry.path.startsWith(`${path}/`)
            );
            fileEntriesRef.current = next;
            return next;
          });
          setExpandedFolders((current) =>
            current.filter((entry) => entry !== path && !entry.startsWith(`${path}/`))
          );
          for (const loaded of [...loadedFoldersRef.current]) {
            if (loaded === path || loaded.startsWith(`${path}/`)) {
              loadedFoldersRef.current.delete(loaded);
            }
          }
          if (trashOpen) await refreshTrash();
          setStatus(`Moved to trash · ${path}`);
        })(),
        {
          loading: `Moving ${path} to trash…`,
          success: `Moved ${path} to trash`,
          error: `Could not move ${path} to trash`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const archivePath = async (path: string) => {
    if (!runtime.client || !vault || path === "archive" || path.startsWith("archive/")) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const archiveParent = parent ? `archive/${parent}` : "archive";
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, archiveParent);
          if (!(await movePath(path, `archive/${path}`, null))) throw new Error("Move failed");
          setStatus(`Archived · ${path}`);
        })(),
        {
          loading: `Archiving ${path}…`,
          success: `Archived ${path}`,
          error: `Could not archive ${path}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Archive failed");
    }
  };

  const createFolder = async (parent: string, requestedName: string) => {
    if (!runtime.client || !vault) return;
    const name = requestedName.trim();
    if (!name) return;
    try {
      const path = parent ? `${parent}/${name}` : name;
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, path);
          await refreshFiles();
          setStatus(`Created folder · ${name}`);
        })(),
        {
          loading: `Creating folder ${name}…`,
          success: `Created folder ${name}`,
          error: `Could not create folder ${name}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create folder failed");
    }
  };

  const editorFor = (tab: WorkspaceTab) => {
    if (!tab.document) return null;

    return (
      <MarkdownEditor
        document={tab.document}
        mode={plugins["live-preview"] === false ? "source" : tab.mode}
        onChange={(content) => {
          if (tab.document) scheduleSave(tab.id, tab.document, content);
          updateTab(tab.id, (current) =>
            current.document ? { ...current, document: { ...current.document, content } } : current
          );
        }}
        onTitleChange={(title) =>
          updateTab(tab.id, (current) =>
            current.document
              ? {
                  ...current,
                  title: title || "Untitled",
                  document: { ...current.document, title },
                }
              : current
          )
        }
        onTitleCommit={(title) => {
          if (tab.document?.path && title.trim() && title !== titleFromPath(tab.document.path)) {
            renamePath(tab.document.path, title.trim());
          }
        }}
        showBacklinks={tab.showBacklinks}
        findRequest={tab.findRequest}
        revealRequest={
          headingReveal && headingReveal.path === tab.document.path ? headingReveal : undefined
        }
        onDropDocument={openDocument}
        onOpenDocument={(identifier, inPlace) =>
          openDocument(identifier, inPlace ? tab.id : undefined)
        }
        documents={documents}
      />
    );
  };

  const renameFile = (id: number) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab?.document) return;
    if (tab.document.path) {
      setRenameRequest({ path: tab.document.path, value: tab.document.title });
      return;
    }
    const title = window.prompt("Rename file", tab.document.title)?.trim();
    if (!title) return;
    updateTab(id, (current) =>
      current.document ? { ...current, title, document: { ...current.document, title } } : current
    );
  };

  const addProperty = (id: number) => {
    const name = window.prompt("Property name")?.trim();
    if (!name) return;
    const value = window.prompt(`Value for ${name}`)?.trim() ?? "";
    updateTab(id, (current) =>
      current.document
        ? {
            ...current,
            document: {
              ...current.document,
              content: setFrontmatterProperty(current.document.content, name, value),
            },
          }
        : current
    );
  };

  const openFind = (id: number) => {
    updateTab(id, (current) => ({
      ...current,
      mode: "live",
      findRequest: current.findRequest + 1,
    }));
  };

  const isProtectedNewTab = (tab: WorkspaceTab, leafId: number) => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    return (
      !tab.document &&
      !tab.pdf &&
      !tab.preview &&
      !tab.deferred &&
      !tab.kind &&
      workspaceLeaves(workspaceRoot).length === 1 &&
      leaf?.tabIds.length === 1
    );
  };

  const revealEditorPath = (path: string, file: boolean) => {
    const folder = file && path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
    const parts = folder.split("/").filter(Boolean);
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (let index = 0; index < parts.length; index++) {
        next.add(parts.slice(0, index + 1).join("/"));
      }
      return [...next].sort();
    });
    setLeftSidebarPane("files");
    setSidebarRevealPath(folder);
    setSidebarSelectedPath(folder);
    if (revealPathTimerRef.current) window.clearTimeout(revealPathTimerRef.current);
    revealPathTimerRef.current = window.setTimeout(() => {
      setSidebarRevealPath(undefined);
      revealPathTimerRef.current = undefined;
    }, 1800);
  };

  const openBrowserTab = useCallback(
    (url: string) => {
      const id = nextTabIdRef.current++;
      setTabs((current) => [...current, createBrowserWorkspaceTab(id, url)]);
      setActiveTabId(id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
          ...leaf,
          view: "browser",
          tabIds: [...leaf.tabIds, id],
          activeTabId: id,
        }))
      );
    },
    [activeLeafId]
  );

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (link) {
        const hrefAttr = link.getAttribute("href");
        if (hrefAttr && (hrefAttr.startsWith("http://") || hrefAttr.startsWith("https://"))) {
          event.preventDefault();
          event.stopPropagation();
          openBrowserTab(link.href);
        }
      }
    };
    document.addEventListener("click", handleGlobalClick, { capture: true });
    return () => document.removeEventListener("click", handleGlobalClick, { capture: true });
  }, [openBrowserTab]);

  const commandsFor = (tab: WorkspaceTab, leafId = activeLeafId): SymtabTabCommands => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tabIndex = leaf?.tabIds.indexOf(tab.id) ?? -1;
    const protectedNewTab = isProtectedNewTab(tab, leafId);

    return {
      pinned: tab.pinned,
      canCloseOthers: (leaf?.tabIds.length ?? 0) > 1,
      canCloseAfter: tabIndex >= 0 && tabIndex < (leaf?.tabIds.length ?? 0) - 1,
      onClose: protectedNewTab ? undefined : () => closeLeafTab(leafId, tab.id),
      onCloseOthers: () => closeOtherTabs(leafId, tab.id),
      onCloseAfter: () => closeTabsAfter(leafId, tab.id),
      onCloseAll: () => closeAllTabs(leafId),
      onTogglePin: () => togglePinned(tab.id),
      onMoveToNewWindow: () => popOutTab(tab),
      onSplitRight: () => splitLeaf(leafId, "horizontal"),
      onSplitDown: () => splitLeaf(leafId, "vertical"),
    };
  };

  const markDraggedTab = (
    event: DragEvent<HTMLDivElement>,
    title: string,
    tabId: number,
    leafId: number
  ) => {
    event.dataTransfer.setData("text/plain", title);
    event.dataTransfer.setData("application/x-symtab-tab", JSON.stringify({ tabId, leafId }));
    event.dataTransfer.effectAllowed = "move";
  };

  const hydrateDeferredTab = (tab: WorkspaceTab) => {
    if (!runtime.client || !vault || !tab.deferred) return Promise.resolve();
    const vaultId = vault.id;
    const path = tab.deferred.path;
    const key = `${vaultId}:${tab.id}`;
    const existing = deferredTabLoadsRef.current.get(key);
    if (existing) return existing;
    const load = (async () => {
      try {
        const entry = await runtime.client!.getFileMetadata(vaultId, path);
        if (!entry || entry.kind === "directory" || activeVaultIdRef.current !== vaultId) return;
        let replacement: WorkspaceTab;
        if (entry.kind === "binary") {
          const data = await runtime.client!.readBinaryFile(vaultId, path);
          if (activeVaultIdRef.current !== vaultId) return;
          if (/\.pdf$/i.test(path)) {
            replacement = {
              ...tab,
              deferred: undefined,
              title: fileTitleFromPath(path),
              pdf: { path, data },
            };
          } else {
            const mimeType = mimeTypeForPath(path);
            const text = decodedText(data);
            if (/^(image|audio|video)\//.test(mimeType) || text === null) {
              replacement = {
                ...tab,
                deferred: undefined,
                title: fileTitleFromPath(path),
                preview: { path, data, mimeType },
              };
            } else {
              const file = await runtime.client!.readFile(vaultId, path);
              const document = {
                title: titleFromPath(file.path),
                path: file.path,
                content: file.content,
                contentHash: file.contentHash,
              };
              replacement = { ...tab, deferred: undefined, title: document.title, document };
              savedDocumentsRef.current.set(path, document);
              setVaultDocuments((current) => [
                ...current.filter((item) => item.path !== path),
                document,
              ]);
            }
          }
        } else {
          const file = await runtime.client!.readFile(vaultId, path);
          if (activeVaultIdRef.current !== vaultId) return;
          const document = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          replacement = { ...tab, deferred: undefined, title: document.title, document };
          savedDocumentsRef.current.set(path, document);
          setVaultDocuments((current) => [
            ...current.filter((item) => item.path !== path),
            document,
          ]);
        }
        vaultFileVersionsRef.current.set(path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        setTabs((current) =>
          current.map((candidate) =>
            candidate.id === tab.id && candidate.deferred?.path === path ? replacement : candidate
          )
        );
      } catch (error) {
        if (activeVaultIdRef.current === vaultId)
          setStatus(error instanceof Error ? error.message : `Could not restore ${path}`);
      } finally {
        deferredTabLoadsRef.current.delete(key);
      }
    })();
    deferredTabLoadsRef.current.set(key, load);
    return load;
  };

  const revealSidebarPath = (targetPath?: string) => {
    setSidebarRevealPath(undefined);
    setSidebarSelectedPath(undefined);
    if (revealPathTimerRef.current) {
      window.clearTimeout(revealPathTimerRef.current);
      revealPathTimerRef.current = undefined;
    }
    if (!targetPath) return;
    const parts = targetPath.split("/").filter(Boolean).slice(0, -1);
    if (parts.length === 0) return;
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    setExpandedFolders((current) => [...new Set([...current, ...ancestors])].sort());
    for (const path of ancestors) void loadFolderChildren(path);
  };

  const activateLeafTab = (leafId: number, tabId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (leaf) => ({
        ...leaf,
        view: workspaceTabView(tab),
        activeTabId: tabId,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(tabId);
    if (tab?.deferred) void hydrateDeferredTab(tab);
    revealSidebarPath(tab?.document?.path ?? tab?.pdf?.path ?? tab?.preview?.path);
  };

  const openGraphTab = (leafId = activeLeafId, graphRootPath?: string) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    if (!leaf) return;
    const existing = tabs.find(
      (tab) =>
        leaf.tabIds.includes(tab.id) && tab.kind === "graph" && tab.graphRootPath === graphRootPath
    );
    if (existing) {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, leafId, (current) => ({
          ...current,
          view: "graph",
          activeTabId: existing.id,
        }))
      );
      setActiveLeafId(leafId);
      setActiveTabId(existing.id);
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === leaf.activeTabId);
    const replaceable =
      activeTab &&
      !activeTab.pinned &&
      !activeTab.kind &&
      !activeTab.document &&
      !activeTab.pdf &&
      !activeTab.preview
        ? activeTab
        : undefined;
    const id = replaceable?.id ?? nextTabIdRef.current++;
    const graphTab = createGraphWorkspaceTab(id, graphRootPath);
    setTabs((current) =>
      replaceable ? current.map((tab) => (tab.id === id ? graphTab : tab)) : [...current, graphTab]
    );
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (current) => ({
        ...current,
        view: "graph",
        tabIds: replaceable ? current.tabIds : [...current.tabIds, id],
        activeTabId: id,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(id);
  };

  const moveTabToLeaf = (event: DragEvent, targetLeafId: number) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-symtab-tab");
    if (!payload) return;
    let parsed: { tabId: number; leafId: number };
    try {
      parsed = JSON.parse(payload) as { tabId: number; leafId: number };
    } catch {
      return;
    }
    if (!Number.isInteger(parsed.tabId) || !Number.isInteger(parsed.leafId)) return;
    if (parsed.leafId === targetLeafId) return;
    const tab = tabs.find((candidate) => candidate.id === parsed.tabId);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(
        moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId),
        targetLeafId,
        (leaf) => ({ ...leaf, view: workspaceTabView(tab) })
      )
    );
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
  };

  const moveTabBefore = (event: DragEvent, targetLeafId: number, targetTabId: number) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = event.dataTransfer.getData("application/x-symtab-tab");
    if (!payload) return;
    let parsed: { tabId: number; leafId: number };
    try {
      parsed = JSON.parse(payload) as { tabId: number; leafId: number };
    } catch {
      return;
    }
    if (
      !Number.isInteger(parsed.tabId) ||
      !Number.isInteger(parsed.leafId) ||
      parsed.tabId === targetTabId
    )
      return;
    const tab = tabs.find((candidate) => candidate.id === parsed.tabId);
    setWorkspaceRoot((root) => {
      const moved =
        parsed.leafId === targetLeafId
          ? root
          : moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId);
      return mapWorkspaceLeaf(moved, targetLeafId, (leaf) => {
        const tabIds = leaf.tabIds.filter((id) => id !== parsed.tabId);
        const targetIndex = tabIds.indexOf(targetTabId);
        tabIds.splice(targetIndex < 0 ? tabIds.length : targetIndex, 0, parsed.tabId);
        return {
          ...leaf,
          view: workspaceTabView(tab),
          tabIds,
          activeTabId: parsed.tabId,
        };
      });
    });
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
  };

  const workspaceDropZone = (
    event: DragEvent,
    element: HTMLDivElement
  ): "center" | "left" | "right" | "top" | "bottom" => {
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0.22) return "left";
    if (x > 0.78) return "right";
    if (y < 0.22) return "top";
    if (y > 0.78) return "bottom";
    return "center";
  };

  const dropFileIntoWorkspace = (
    event: DragEvent<HTMLDivElement>,
    leaf: Extract<WorkspaceNode, { kind: "leaf" }>
  ) => {
    const path =
      event.dataTransfer.getData("application/x-symtab-path") ||
      event.dataTransfer.getData("application/x-symtab-file") ||
      event.dataTransfer.getData("text/plain");
    if (!path.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    const zone =
      workspaceFileDrop?.leafId === leaf.id
        ? workspaceFileDrop.zone
        : workspaceDropZone(event, event.currentTarget);
    setWorkspaceFileDrop(undefined);
    if (zone === "center") {
      setActiveLeafId(leaf.id);
      void openDocument(path.trim(), undefined, false, leaf.id);
      return;
    }
    const tab = createWorkspaceTab(nextTabIdRef.current++);
    const newLeafId = nextLeafIdRef.current++;
    const splitId = nextLeafIdRef.current++;
    const newLeaf: Extract<WorkspaceNode, { kind: "leaf" }> = {
      kind: "leaf",
      id: newLeafId,
      view: "editor",
      tabIds: [tab.id],
      activeTabId: tab.id,
    };
    setTabs((current) => [...current, tab]);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leaf.id, (current) => ({
        kind: "split",
        id: splitId,
        direction: zone === "left" || zone === "right" ? "horizontal" : "vertical",
        children: zone === "left" || zone === "top" ? [newLeaf, current] : [current, newLeaf],
      }))
    );
    setActiveLeafId(newLeafId);
    setActiveTabId(tab.id);
    void openDocument(path.trim(), tab.id, false, newLeafId);
  };

  const wasDroppedAtWindowEdge = (event: DragEvent<HTMLDivElement>) =>
    event.clientX === 0 && event.clientY === 0;

  const openNewNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: "Untitled",
      document: { title: "Untitled", content: "" },
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const openDemoNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: DEMO_DOCUMENT.title,
      document: DEMO_DOCUMENT,
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const mergeFile = (id: number, leafId: number) => {
    const source = tabs.find((tab) => tab.id === id)?.document;
    if (!source) return;
    const choices = tabs
      .filter((tab) => tab.id !== id && tab.document)
      .map((tab) => tab.document?.title)
      .filter(Boolean)
      .join(", ");
    const targetTitle = window.prompt(`Merge into file${choices ? ` (${choices})` : ""}`)?.trim();
    if (!targetTitle) return;
    const target = tabs.find((tab) => tab.document?.title === targetTitle);
    if (!target) return;
    updateTab(target.id, (tab) =>
      tab.document
        ? {
            ...tab,
            document: {
              ...tab.document,
              content: `${tab.document.content.trimEnd()}\n\n${source.content.trimStart()}`,
            },
          }
        : tab
    );
    closeLeafTab(leafId, id);
    setActiveTabId(target.id);
  };

  const handleGoBack = () => {
    const tabId = navigationHistory.go(-1);
    if (tabId === undefined) return;
    const leaf = workspaceLeaves(workspaceRoot).find((candidate) =>
      candidate.tabIds.includes(tabId)
    );
    activateLeafTab(leaf?.id ?? activeLeafId, tabId);
  };

  const handleGoForward = () => {
    const tabId = navigationHistory.go(1);
    if (tabId === undefined) return;
    const leaf = workspaceLeaves(workspaceRoot).find((candidate) =>
      candidate.tabIds.includes(tabId)
    );
    activateLeafTab(leaf?.id ?? activeLeafId, tabId);
  };

  const paneFor = (tab: WorkspaceTab, leafId = activeLeafId) => (
    <SymtabEditorPane
      title={
        tab.kind === "browser" ? (
          <span className="truncate">{tab.title}</span>
        ) : workspaceTabPath(tab) ? (
          <EditorPathBreadcrumb
            key={workspaceTabPath(tab)!}
            path={workspaceTabPath(tab)!}
            onReveal={revealEditorPath}
            onRename={renamePath}
            onClearReveal={() => {
              setSidebarRevealPath(undefined);
              setSidebarSelectedPath(undefined);
            }}
          />
        ) : (
          tab.title
        )
      }
      canGoBack={navigationHistory.nextIndex(-1) !== -1}
      canGoForward={navigationHistory.nextIndex(1) !== -1}
      onGoBack={handleGoBack}
      onGoForward={handleGoForward}
      headerAction={
        tab.document ? (
          <div className="flex items-center gap-0.5">
            {isTabBookmarked(tab) && (
              <button
                type="button"
                aria-label="Edit bookmark"
                title="Edit bookmark"
                onClick={() =>
                  handleOpenAddBookmark({
                    title: tab.title,
                    path: tab.document?.path,
                  })
                }
                className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
              >
                <Bookmark className="size-4 fill-primary text-primary" />
              </button>
            )}
            <MarkdownViewToggle
              mode={tab.mode}
              onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
            />
          </div>
        ) : null
      }
      menuContent={
        tab.document ? (
          <MarkdownDocumentMenu
            title={tab.document.title}
            mode={tab.mode}
            showBacklinks={tab.showBacklinks}
            bookmarked={isTabBookmarked(tab)}
            onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
            onBacklinksChange={(showBacklinks) => {
              updateTab(tab.id, (current) => ({ ...current, showBacklinks }));
              if (showBacklinks) {
                setRightSidebarPane("backlinks");
              }
            }}
            onBookmarkChange={() =>
              handleOpenAddBookmark({
                title: tab.title,
                path: tab.document?.path,
              })
            }
            onRename={() => renameFile(tab.id)}
            onAddProperty={() => addProperty(tab.id)}
            onFind={() => openFind(tab.id)}
            onDelete={() => {
              if (tab.document?.path) void deletePath(tab.document.path);
              else closeLeafTab(leafId, tab.id);
            }}
            onMerge={() => mergeFile(tab.id, leafId)}
            onVersionHistory={() =>
              window.alert("Version history will appear after this note has saved revisions.")
            }
            onRevealInNavigation={() => setLeftSidebarPane("files")}
            onOpenLinkedView={(view) => {
              if (view === "graph") openGraphTab(leafId, tab.document?.path);
              else setRightSidebarPane(view);
            }}
            onMoveToNewWindow={() => popOutTab(tab)}
            onSplitRight={() => splitLeaf(leafId, "horizontal")}
            onSplitDown={() => splitLeaf(leafId, "vertical")}
            onExportPdf={() => {
              setPdfExportDocument(tab.document ?? null);
              setPdfExportOpen(true);
            }}
          />
        ) : undefined
      }
      {...commandsFor(tab, leafId)}
    >
      {tab.deferred ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading {tab.title}…
        </div>
      ) : tab.pdf ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Loading PDF…
            </div>
          }
        >
          <PdfViewer key={tab.pdf.path} title={tab.title} data={tab.pdf.data} />
        </Suspense>
      ) : tab.preview ? (
        <FilePreview
          key={tab.preview.path}
          title={tab.title}
          path={tab.preview.path}
          data={tab.preview.data}
          mimeType={tab.preview.mimeType}
        />
      ) : tab.kind === "browser" ? (
        <BrowserView tab={tab} onClose={() => closeLeafTab(leafId, tab.id)} />
      ) : tab.document ? (
        editorFor(tab)
      ) : (
        <div className="grid h-full place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openNewNote(tab.id)}
            >
              Create new note (⌘ N)
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openDemoNote(tab.id)}
            >
              Go to file (⌘ O)
            </button>
            {!isProtectedNewTab(tab, leafId) ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => closeLeafTab(leafId, tab.id)}
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      )}
    </SymtabEditorPane>
  );

  const [loadedBacklinksCount, setLoadedBacklinksCount] = useState(0);
  const backlinkPath = visibleActiveTab?.document?.path;
  const backlinksCount = backlinkPath ? loadedBacklinksCount : 0;
  useEffect(() => {
    let active = true;
    if (!backlinkPath) return;
    void loadDocumentReferences(backlinkPath)
      .then((references) => {
        if (active)
          setLoadedBacklinksCount(new Set(references.linked.map((mention) => mention.source)).size);
      })
      .catch(() => {
        if (active) setLoadedBacklinksCount(0);
      });
    return () => {
      active = false;
    };
  }, [backlinkPath, loadDocumentReferences]);

  const openDocument = async (
    identifier: string,
    targetTabId?: number,
    historyNavigation = false,
    targetLeafId = activeLeafId
  ) => {
    const navigationIntent = ++navigationIntentRef.current;
    if (vault) void flushPendingSaves(vault.id);
    const exactEntry = vault ? fileEntries.find((entry) => entry.path === identifier) : undefined;
    const titleMatches = vault
      ? fileEntries.filter(
          (entry) => entry.kind === "markdown" && titleFromPath(entry.path) === identifier
        )
      : [];
    const requestedEntry = exactEntry ?? (titleMatches.length === 1 ? titleMatches[0] : undefined);
    const requestedPath = vault
      ? (requestedEntry?.path ??
        vaultDocuments.find((document) => document.title === identifier)?.path ??
        (/\.(md|markdown)$/i.test(identifier) ? identifier : undefined))
      : undefined;
    const existing =
      targetTabId === undefined
        ? tabs.find((tab) =>
            requestedPath
              ? tab.document?.path === requestedPath ||
                tab.pdf?.path === requestedPath ||
                tab.preview?.path === requestedPath ||
                tab.deferred?.path === requestedPath
              : tab.document?.title === identifier
          )
        : undefined;
    if (existing) {
      setActiveTabId(existing.id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, targetLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: leaf.tabIds.includes(existing.id) ? leaf.tabIds : [...leaf.tabIds, existing.id],
          activeTabId: existing.id,
        }))
      );
      if (existing.deferred) void hydrateDeferredTab(existing);
      revealSidebarPath(existing.document?.path ?? existing.pdf?.path ?? existing.preview?.path);
      return;
    }

    const placeTab = (create: (id: number) => WorkspaceTab) => {
      if (navigationIntentRef.current !== navigationIntent) return;
      if (targetTabId !== undefined) {
        setTabs((current) =>
          current.map((tab) => {
            if (tab.id === targetTabId) {
              const replacement = create(targetTabId);
              let newHistory = tab.history || [];
              let newIndex = tab.historyIndex ?? -1;
              if (!historyNavigation) {
                newHistory = newHistory.slice(0, newIndex + 1);
                const newPath =
                  replacement.document?.path ??
                  replacement.pdf?.path ??
                  replacement.preview?.path ??
                  replacement.title;
                if (newHistory[newHistory.length - 1] !== newPath) {
                  newHistory.push(newPath);
                }
                newIndex = newHistory.length - 1;
              }
              return {
                ...tab,
                title: replacement.title,
                document: replacement.document,
                pdf: replacement.pdf,
                preview: replacement.preview,
                history: historyNavigation ? tab.history : newHistory,
                historyIndex: historyNavigation ? tab.historyIndex : newIndex,
              };
            }
            return tab;
          })
        );
        return;
      }
      const leaf = findWorkspaceLeaf(workspaceRoot, targetLeafId);
      const emptyTab = leaf
        ? tabs.find(
            (tab) =>
              tab.id === leaf.activeTabId &&
              !tab.kind &&
              !tab.document &&
              !tab.pdf &&
              !tab.preview &&
              !tab.deferred &&
              !tab.pinned
          )
        : undefined;
      if (emptyTab) {
        const replacement = create(emptyTab.id);
        setTabs((current) => current.map((tab) => (tab.id === emptyTab.id ? replacement : tab)));
        setActiveTabId(emptyTab.id);
        setWorkspaceRoot((root) =>
          mapWorkspaceLeaf(root, targetLeafId, (current) => ({
            ...current,
            view: "editor",
            activeTabId: emptyTab.id,
          }))
        );
        return;
      }
      const id = nextTabIdRef.current++;
      setTabs((current) => [...current, create(id)]);
      setActiveTabId(id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, targetLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: [...leaf.tabIds, id],
          activeTabId: id,
        }))
      );
    };

    if (requestedEntry?.kind === "binary") {
      if (!runtime.client || !vault) return;
      try {
        const data = await runWithToast(
          runtime.client.readBinaryFile(vault.id, requestedEntry.path),
          {
            loading: `Opening ${requestedEntry.name}…`,
            success: `Opened ${requestedEntry.name}`,
            error: `Could not open ${requestedEntry.name}`,
          }
        );
        if (/\.pdf$/i.test(requestedEntry.path)) {
          placeTab((id) => ({
            ...createWorkspaceTab(id),
            title: fileTitleFromPath(requestedEntry.path),
            pdf: { path: requestedEntry.path, data },
          }));
          return;
        }
        const mimeType = mimeTypeForPath(requestedEntry.path);
        const text = decodedText(data);
        if (!/^(image|audio|video)\//.test(mimeType) && text !== null) {
          const file = await runtime.client.readFile(vault.id, requestedEntry.path);
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(file.path, document);
          setVaultDocuments((current) => [
            ...current.filter((item) => item.path !== file.path),
            document,
          ]);
          placeTab((id) => createWorkspaceTab(id, document));
          revealSidebarPath(document.path);
          return;
        }
        placeTab((id) => ({
          ...createWorkspaceTab(id),
          title: fileTitleFromPath(requestedEntry.path),
          preview: { path: requestedEntry.path, data, mimeType },
        }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open file failed");
      }
      return;
    }

    let document = requestedPath
      ? vaultDocuments.find((candidate) => candidate.path === requestedPath)
      : documents.find((candidate) => candidate.title === identifier);
    if (!document && requestedPath && runtime.client && vault) {
      try {
        const file = await runtime.client.readFile(vault.id, requestedPath);
        document = {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        };
        savedDocumentsRef.current.set(file.path, document);
        const entry = fileEntries.find((candidate) => candidate.path === file.path);
        if (entry)
          vaultFileVersionsRef.current.set(file.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        setVaultDocuments((current) => [
          ...current.filter((item) => item.path !== file.path),
          document!,
        ]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open file failed");
        return;
      }
    }
    if (!document) return;
    placeTab((id) => createWorkspaceTab(id, document));
    revealSidebarPath(document.path);
  };

  const createNote = async (parent = "", requestedName = "Untitled") => {
    if (vault && runtime.client) {
      const navigationIntent = ++navigationIntentRef.current;
      const titles = new Set(fileEntries.map((entry) => entry.path.toLocaleLowerCase()));
      let suffix = 0;
      const base = requestedName.replace(/\.(md|markdown)$/i, "") || "Untitled";
      let path = markdownPath(parent, base);
      while (titles.has(path.toLocaleLowerCase()))
        path = markdownPath(parent, `${base} ${++suffix}`);
      try {
        await runWithToast(
          (async () => {
            const file = await runtime.client!.createFile({
              vaultId: vault.id,
              path,
              content: "---\ntags: []\n---\n\n",
            });
            await refreshFiles();
            if (navigationIntentRef.current === navigationIntent) await openDocument(file.path);
            setStatus(`Created note · ${file.path}`);
          })(),
          {
            loading: `Creating ${titleFromPath(path)}…`,
            success: `Created ${titleFromPath(path)}`,
            error: `Could not create ${titleFromPath(path)}`,
          }
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Create note failed");
      }
      return;
    }
    const base = "Untitled";
    let suffix = 0;
    let title = base;
    const titles = new Set(documents.map((document) => document.title));
    while (titles.has(title)) title = `${base} ${++suffix}`;
    const document = { title, content: "---\ntags: []\n---\n\n" };
    const id = nextTabIdRef.current++;
    setTabs((current) => [...current, createWorkspaceTab(id, document)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
  };

  const {
    open: calendarOpen,
    setOpen: setCalendarOpen,
    date: calendarDate,
    setDate: setCalendarDate,
    config: dailyNoteConfig,
    setConfig: setDailyNoteConfig,
    days: calendarDays,
    monthLabel: calendarMonthLabel,
    openDaily: openDailyNote,
    openWeekly: openWeeklyNote,
  } = useDailyNotes({
    client: runtime.client,
    vault,
    files: fileEntries,
    refreshFiles: () => refreshFiles(),
    openDocument,
    onStatus: setStatus,
  });

  const handleRuntimeCommand = useEffectEvent(
    (command: "search" | "daily-today" | "calendar" | "settings" | "vaults" | "updates") => {
      if (command === "search") setLeftSidebarPane("search");
      if (command === "daily-today") void openDailyNote(localDateKey());
      if (command === "calendar") setCalendarOpen(true);
      if (command === "settings") setSettingsOpen(true);
    }
  );
  useEffect(() => runtime.onCommand?.(handleRuntimeCommand), [runtime]);

  const popOutTab = (tab: WorkspaceTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("popout", tab.title);
    if (runtime.openWindow) void runtime.openWindow(url.toString());
    else window.open(url.toString(), "_blank", "popup,width=960,height=720");
  };

  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        windowIdRef.current = (await runtime.getWindowId?.()) || "main";
        const [appBootstrap, settings] = await Promise.all([
          statePersistence.loadBootstrap(windowIdRef.current),
          statePersistence.loadAppSettings(),
        ]);
        if (!active) return;
        hydrateAppState(settings);
        setSettingsHydrated(true);
        if (runtime.client) {
          const [recent, available] = await Promise.all([
            runtime.client.listRecentVaults(),
            runtime.client.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
          const server = await getBootstrapStatus(runtime.client);
          if (!active) return;
          const lastPath = appBootstrap.lastVaultPath;
          if (lastPath) {
            const openIntent = ++vaultOpenIntentRef.current;
            try {
              setInitializationPhase("vault");
              setStatus("Loading vault…");
              const info = await runtime.client.openVault({ path: lastPath });
              if (!(await loadVault(info, openIntent))) return;
              return;
            } catch {
              if (vaultOpenIntentRef.current === openIntent)
                await statePersistence.forgetLastVault();
            }
          }
          setAppVault(null, "active", null);
          setStatus(`Go backend ${server.version} connected · no vault open`);
          setVaultPickerOpen(true);
        } else {
          const message = await runtime.connect();
          if (active) setStatus(message);
        }
      } catch (error) {
        if (active) {
          setLifecycle("degraded", null);
          setStatus(error instanceof Error ? error.message : "Runtime unavailable");
        }
      }
    };
    void connect();

    return () => {
      active = false;
    };
    // Runtime object is shell-owned and stable; reconnect only when shell changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const workspaceLeafContext: WorkspaceLeafContext = {
    tabs,
    activeLeafId,
    setActiveLeafId,
    setActiveTabId,
    workspaceFileDrop,
    setWorkspaceFileDrop,
    workspaceDropZone,
    moveTabToLeaf,
    dropFileIntoWorkspace,
    leftEdgeLeafIds,
    rightEdgeLeafIds,
    addTab,
    setWorkspaceRoot,
    closeAllTabs,
    activateLeafTab,
    commandsFor,
    markDraggedTab,
    wasDroppedAtWindowEdge,
    popOutTab,
    moveTabBefore,
    closeLeafTab,
    paneFor,
    isProtectedNewTab,
    documents,
    vaultGraph,
    isTabBookmarked,
    handleOpenAddBookmark,
    openDocument,
    splitLeaf,
  };
  return {
    shell: {
      lifecycle,
      status,
      setStatus,
      initializationPhase,
      performanceStats,
      sessionVaultId,
      layoutState,
      setLayoutState,
    },
    workspace: {
      workspaceRoot,
      activeLeafId,
      visibleActiveTab,
      activeFilePath,
      documents,
      setLeafView,
      openGraphTab,
      backlinksCount,
      openDocument,
      createNote,
      workspaceLeafContext,
    },
    vault: {
      activeVaultId,
      vault,
      fileEntries,
      vaultPickerOpen,
      setVaultPickerOpen,
      recentVaults,
      vaultQuery,
      setVaultQuery,
      selectableVaults,
      filteredSelectableVaults,
      searchVaultIndex,
      loadDocumentReferences,
      loadVaultFacets,
      loadFolderChildren,
      chooseVault,
      openRegisteredVault,
      forgetRegisteredVault,
      rebuildIndex,
      movePath,
      renamePath,
      deletePath,
      archivePath,
      createFolder,
    },
    sidebar: {
      sidebarRevealPath,
      setSidebarRevealPath,
      sidebarSelectedPath,
      setSidebarSelectedPath,
      setLeftSidebarPane,
      rightSidebarPane,
      setRightSidebarPane,
      sidebarSearchQuery,
      setSidebarSearchQuery,
      setHeadingReveal,
      effectiveLeftSidebarPane,
      expandedFolders,
      setExpandedFolders,
    },
    bookmarks: {
      bookmarks,
      bookmarkGroups,
      addBookmarkDialogOpen,
      setAddBookmarkDialogOpen,
      bookmarkTarget,
      handleOpenAddBookmark,
      handleSaveBookmark,
      handleRemoveBookmark,
      handleCreateBookmarkGroup,
    },
    plugins: {
      enabled: plugins,
      pluginManagerOpen,
      setPluginManagerOpen,
      pluginCatalog,
      marketplacePlugins,
      marketplaceError,
      pluginSection,
      setPluginSection,
      pluginSettings,
      vaultPlugins,
      pluginBusy,
      pluginRuntimeRevision,
      pluginView,
      setPluginView,
      pluginQuery,
      setPluginQuery,
      pluginHostRef,
      openPluginManager,
      openPluginSurface,
      pluginRibbonItems,
      pluginViewLocation,
      installPlugin,
      installMarketplacePlugin,
      savePluginSetting,
      updatePlugin,
      invokePluginViewCapability,
    },
    dialogs: {
      renameRequest,
      setRenameRequest,
      pdfExportDocument,
      pdfExportOpen,
      setPdfExportOpen,
      settingsOpen,
      setSettingsOpen,
      trashOpen,
      setTrashOpen,
      trashEntries,
      filteredTrashEntries,
      trashQuery,
      setTrashQuery,
      permanentDeleteRequest,
      setPermanentDeleteRequest,
      emptyTrashRequest,
      setEmptyTrashRequest,
      openTrash,
      restoreTrashEntry,
      permanentlyDeleteTrashEntry,
      emptyTrash,
      calendarOpen,
      setCalendarOpen,
      calendarDate,
      setCalendarDate,
      dailyNoteConfig,
      setDailyNoteConfig,
      calendarDays,
      calendarMonthLabel,
      openDailyNote,
      openWeeklyNote,
    },
  };
}
