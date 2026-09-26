import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VSCodeWorkbench } from "@flux/shared-ui/components/design-system/workbench";
import { ThemeProvider } from "@flux/shared-ui/components/theme-provider";
import type {
  WorkbenchSnapshot,
  WorkbenchTheme,
  WorkbenchUpdate,
  WorkbenchNativeCommand,
} from "@flux/shared-ui/components/design-system/workbench";
import type { FluxClient } from "@flux/bridge-contract";
import { browserStatePersistence, type FluxStatePersistence } from "./app/state";
import { MarkdownEditor, type DemoDocument } from "./editor/markdown-editor";
import { WebViewEditor } from "@flux/shared-ui/components/design-system/workbench/editor/webview-editor";
import { PdfExportDialog } from "./pdf/export";
import { ConfirmDialog, TrashManager, VaultManager } from "./workspace/dialogs";
import { useWorkbenchVault } from "./workbench/use-workbench-vault";
import { workspaceCreationPath } from "./workbench/workspace-setup";
import { dateFromKey, localDateKey } from "./daily-notes/config";
import { useDailyNotes } from "./daily-notes/use-daily-notes";
import {
  SearchPane,
  WorkspaceRightSidebar,
  WorkspaceSidebarHeader,
  type RightPane,
} from "./workspace/sidebars";
import { WorkbenchGraph } from "./workbench/workbench-graph";
import type { EditorTab } from "@flux/shared-ui/components/design-system/workbench/editor/editor-area";
import { OnboardingPage } from "@flux/shared-ui/components/design-system/workbench/chrome/onboarding-page";
import { useTrash } from "./trash/use-trash";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create" | "location") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  checkForUpdates?: () => Promise<WorkbenchUpdate>;
  downloadUpdate?: () => Promise<void>;
  installUpdate?: () => Promise<void>;
  onUpdateStatus?: (handler: (status: UpdateRuntimeStatus) => void) => () => void;
  openWindow?: (url: string) => Promise<void>;
  hideWindow?: () => Promise<void>;
  onCommand?: (handler: (command: WorkbenchNativeCommand) => void) => () => void;
  onBeforeShutdown?: (handler: () => Promise<void>) => () => void;
  exportPdf?: (options: PdfExportOptions) => Promise<string | null>;
  getWindowId?: () => Promise<string>;
  setTheme?: (theme: "system" | "dark" | "light") => Promise<void>;
  setMenuBarIconEnabled?: (enabled: boolean) => Promise<void>;
  statePersistence?: FluxStatePersistence;
  vaultAccess?: "filesystem" | "registry";
}

export type UpdateRuntimeStatus =
  | { state: "checking" }
  | { state: "available"; update: WorkbenchUpdate }
  | { state: "not-available"; update: WorkbenchUpdate }
  | { state: "downloading"; percent: number; transferred: number; total: number }
  | { state: "downloaded"; update: WorkbenchUpdate }
  | { state: "verifying"; update: WorkbenchUpdate }
  | { state: "ready"; update: WorkbenchUpdate }
  | { state: "installing"; update: WorkbenchUpdate }
  | { state: "error"; message: string };

export interface PdfExportOptions {
  title: string;
  pageSize: "A4" | "Letter";
  landscape: boolean;
  marginMillimetres: number;
  scale: number;
}

export interface FluxPerformanceStats {
  cpuPercent: number;
  memoryMB: number;
}

export interface FluxAppProps {
  runtime: FluxRuntime;
  windowControlsInset?: number;
}

const THEME_KEY = "workbench.theme";

function preferredTheme(): WorkbenchTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function snapshotKey(windowId: string) {
  return `workbench.window.${windowId}`;
}

export function FluxApp({ runtime, windowControlsInset = 0 }: FluxAppProps) {
  const persistence = runtime.statePersistence ?? browserStatePersistence;
  const [theme, setTheme] = useState<WorkbenchTheme>(preferredTheme);
  const [windowId, setWindowId] = useState<string>();
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>();
  const [update, setUpdate] = useState<WorkbenchUpdate>();
  const [updateStatus, setUpdateStatus] = useState<UpdateRuntimeStatus>();
  const [hydrated, setHydrated] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [setupVaultPickerOpen, setSetupVaultPickerOpen] = useState(false);
  const [restorePreviousVault, setRestorePreviousVault] = useState(false);
  const snapshotRef = useRef<WorkbenchSnapshot | undefined>(undefined);
  const [vaultQuery, setVaultQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [backlinkResult, setBacklinkResult] = useState<{ path: string; count: number }>();
  const [activeDocument, setActiveDocument] = useState<DemoDocument | null>(null);
  const [rightPane, setRightPane] = useState<RightPane>("backlinks");
  const [findRequest, setFindRequest] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<DemoDocument | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [performanceStats, setPerformanceStats] = useState<FluxPerformanceStats | null>(null);
  const updateCheckStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      runtime.getWindowId?.() ?? Promise.resolve("main"),
      persistence.loadAppSettings(),
    ])
      .then(([id, settings]) => {
        if (cancelled) return;
        const savedTheme = settings[THEME_KEY];
        setOnboardingComplete(settings["onboarding.completed"] === true);
        setRestorePreviousVault(settings["onboarding.completed"] === true);
        setWindowId(id);
        setSnapshot(settings[snapshotKey(id)] as WorkbenchSnapshot | undefined);
        if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setWindowId("main");
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [persistence, runtime]);

  const vault = useWorkbenchVault({
    runtime,
    persistence,
    windowId,
    restore: restorePreviousVault,
  });
  const reportJournalError = useCallback((message: string) => console.error(message), []);
  const journal = useDailyNotes({
    client: runtime.client,
    vault: vault.vault,
    files: vault.files,
    refreshFiles: vault.refreshFiles,
    openDocument: vault.openFile,
    onStatus: reportJournalError,
  });
  const changeVaultDocument = vault.changeDocument;
  const flushVaultSaves = vault.flushSaves;
  const trash = useTrash({
    client: runtime.client,
    vaultId: vault.vault?.id,
    refreshFiles: vault.refreshFiles,
    onStatus: vault.setStatus,
  });
  const handleActiveEditorChange = useCallback((tab?: EditorTab) => {
    const path = tab?.id.startsWith("file:") ? tab.id.slice(5) : undefined;
    setActiveDocument(path && tab ? { path, title: tab.title, content: tab.content ?? "" } : null);
  }, []);
  const vaultId = vault.vault?.id;
  const loadReferences = useCallback(
    async (path: string, includeUnlinked?: boolean) => {
      if (!runtime.client || !vaultId) throw new Error("No vault open");
      return runtime.client.getDocumentReferences(vaultId, path, includeUnlinked);
    },
    [runtime.client, vaultId]
  );
  const loadFacets = useCallback(async () => {
    if (!runtime.client || !vaultId) throw new Error("No vault open");
    return runtime.client.getVaultFacets(vaultId);
  }, [runtime.client, vaultId]);

  const backlinks =
    backlinkResult && backlinkResult.path === activeDocument?.path
      ? backlinkResult.count
      : undefined;

  // Refresh the active count when the vault index changes, not just on tab clicks.
  useEffect(() => {
    const path = activeDocument?.path;
    if (!path) return;
    let current = true;
    void loadReferences(path)
      .then((references) => {
        if (current) setBacklinkResult({ path, count: references.linked.length });
      })
      .catch(() => {
        if (current) setBacklinkResult(undefined);
      });
    return () => {
      current = false;
    };
  }, [activeDocument?.path, loadReferences]);
  const searchVault = useCallback(
    (query: string, offset = 0, matchCase = false) =>
      runtime.client && vault.vault
        ? runtime.client.searchVault(vault.vault.id, query, 100, offset, matchCase)
        : Promise.resolve([]),
    [runtime.client, vault.vault]
  );

  useEffect(
    () =>
      runtime.onUpdateStatus?.((status) => {
        setUpdateStatus(status);
        if ("update" in status) setUpdate(status.update);
      }),
    [runtime]
  );

  useEffect(() => {
    if (!runtime.getPerformanceStats) return;

    let active = true;
    const refresh = async () => {
      try {
        const stats = await runtime.getPerformanceStats?.();
        if (active) setPerformanceStats(stats ?? null);
      } catch {
        if (active) setPerformanceStats(null);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [runtime]);

  useEffect(() => {
    if (!hydrated) return;
    void persistence.saveAppSetting(THEME_KEY, theme).catch(() => undefined);
    void runtime.setTheme?.(theme);
  }, [hydrated, persistence, runtime, theme]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (!hydrated || !windowId || !snapshot) return;
    const timeout = window.setTimeout(() => {
      void persistence.saveAppSetting(snapshotKey(windowId), snapshot).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hydrated, persistence, snapshot, windowId]);

  useEffect(
    () =>
      runtime.onBeforeShutdown?.(async () => {
        await flushVaultSaves();
        if (windowId && snapshotRef.current) {
          await persistence.saveAppSetting(snapshotKey(windowId), snapshotRef.current);
        }
      }),
    [persistence, runtime, windowId, flushVaultSaves]
  );

  const handleStateChange = useCallback((next: WorkbenchSnapshot) => setSnapshot(next), []);

  const handleCheckForUpdates = useCallback(async () => {
    if (!runtime.checkForUpdates) return;
    const result = await runtime.checkForUpdates();
    if (result) setUpdate(result);
  }, [runtime]);

  useEffect(() => {
    if (
      !hydrated ||
      !onboardingComplete ||
      !runtime.checkForUpdates ||
      updateCheckStartedRef.current
    )
      return;
    updateCheckStartedRef.current = true;
    void handleCheckForUpdates().catch(() => undefined);
  }, [handleCheckForUpdates, hydrated, onboardingComplete, runtime.checkForUpdates]);

  const documentLocations = useMemo(
    () =>
      vault.files
        .filter((file) => file.kind !== "directory")
        .map((file) => ({ path: file.path, title: file.name, content: "" })),
    [vault.files]
  );
  const renderEditor = useCallback(
    (
      tab: EditorTab,
      update: (changes: { title?: string; content?: string; dirty?: boolean }) => void,
      onOpenDocument?: (path: string) => void
    ) => {
      if (tab.id.startsWith("url:")) {
        const url = tab.id.slice(4);
        return <WebViewEditor url={url} />;
      }
      if (!tab.title.toLowerCase().endsWith(".md")) return null;
      const path = tab.id.startsWith("file:") ? tab.id.slice(5) : undefined;
      return (
        <MarkdownEditor
          document={{ title: tab.title.replace(/\.md$/i, ""), path, content: tab.content ?? "" }}
          mode={tab.mode ?? "live"}
          onChange={(content) => {
            update({ content, dirty: true });
            if (path) changeVaultDocument(path, content, () => update({ dirty: false }));
          }}
          onTitleChange={() => undefined}
          showBacklinks={false}
          documents={documentLocations}
          onOpenDocument={onOpenDocument}
          onOpenUrl={(url) => {
            window.dispatchEvent(new CustomEvent("flux-open-url", { detail: { url } }));
          }}
          findRequest={findRequest}
        />
      );
    },
    [changeVaultDocument, findRequest, documentLocations]
  );

  if (!hydrated) return <div className="h-dvh bg-background" />;

  async function finishSetup() {
    await persistence.saveAppSetting("onboarding.completed", true);
    setSetupVaultPickerOpen(false);
    setOnboardingComplete(true);
  }

  async function chooseVault(mode: "open" | "create") {
    const opened = await vault.chooseVault(mode);
    if (opened && !onboardingComplete) await finishSetup();
  }

  return (
    <ThemeProvider
      theme={theme}
      onThemeChange={(nextTheme) => nextTheme !== "system" && setTheme(nextTheme)}
    >
      {!onboardingComplete ? (
        <OnboardingPage
          theme={theme}
          onThemeChange={setTheme}
          ready={Boolean(runtime.client)}
          managed={runtime.vaultAccess === "registry"}
          onSelectLocation={
            runtime.vaultAccess !== "registry" && runtime.selectVaultDirectory
              ? () => runtime.selectVaultDirectory!("location")
              : undefined
          }
          onOpenVault={
            runtime.vaultAccess !== "registry" && runtime.selectVaultDirectory
              ? () => chooseVault("open")
              : async () => {
                  setSetupVaultPickerOpen(true);
                }
          }
          onCreateWorkspace={async ({ name, location }) => {
            const path = workspaceCreationPath(name, location, runtime.vaultAccess === "registry");
            await vault.connectVault(path, "create");
            await finishSetup();
          }}
        />
      ) : (
        <VSCodeWorkbench
          key={`${windowId}:${vault.vault?.id ?? "no-vault"}`}
          runtimeLabel={runtime.label}
          theme={theme}
          titleBarInset={windowControlsInset}
          initialState={snapshot}
          update={update}
          updateStatus={
            updateStatus?.state === "checking"
              ? "checking"
              : updateStatus?.state === "available"
                ? "available"
                : updateStatus?.state === "downloading"
                  ? "downloading"
                  : updateStatus?.state === "downloaded"
                    ? "downloaded"
                    : updateStatus?.state === "verifying"
                      ? "verifying"
                      : updateStatus?.state === "ready"
                        ? "ready"
                        : updateStatus?.state === "installing"
                          ? "installing"
                          : updateStatus?.state === "error"
                            ? "error"
                            : undefined
          }
          updateProgress={updateStatus?.state === "downloading" ? updateStatus.percent : undefined}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          onCheckForUpdates={runtime.checkForUpdates ? handleCheckForUpdates : undefined}
          onDownloadUpdate={runtime.downloadUpdate}
          onInstallUpdate={runtime.installUpdate}
          onThemeChange={setTheme}
          onStateChange={handleStateChange}
          onCommand={runtime.onCommand}
          onOpenToday={journal.openToday}
          renderSearch={(onOpenDocument) => (
            <SearchPane
              searchVault={searchVault}
              onOpenDocument={onOpenDocument}
              query={searchQuery}
              onQueryChange={setSearchQuery}
            />
          )}
          renderGraph={
            runtime.client && vault.vault
              ? (onOpenDocument, onSplit, showSearch) => (
                  <WorkbenchGraph
                    client={runtime.client!}
                    vaultId={vault.vault!.id}
                    onOpenDocument={onOpenDocument}
                    onSplit={onSplit}
                    onSearchTag={(tag) => {
                      setSearchQuery(`tag:${JSON.stringify(tag)}`);
                      showSearch();
                    }}
                  />
                )
              : undefined
          }
          renderBacklinks={(onOpenDocument) => (
            <WorkspaceRightSidebar
              pane="backlinks"
              activeDocument={activeDocument}
              documents={[]}
              onOpenDocument={onOpenDocument}
              onOpenReference={(path) => onOpenDocument(path)}
              loadReferences={loadReferences}
            />
          )}
          renderTags={(showSearch) => (
            <WorkspaceRightSidebar
              pane="tags"
              activeDocument={activeDocument}
              documents={[]}
              onOpenDocument={() => undefined}
              loadFacets={loadFacets}
              onSearchTag={(tag) => {
                setSearchQuery(`tag:${JSON.stringify(tag)}`);
                showSearch();
              }}
            />
          )}
          renderSecondary={(onOpenDocument, showSearch) => (
            <div className="flex h-full min-h-0 flex-col">
              <WorkspaceSidebarHeader side="right" active={rightPane} onChange={setRightPane} />
              <div className="min-h-0 flex-1">
                <WorkspaceRightSidebar
                  pane={rightPane}
                  activeDocument={activeDocument}
                  documents={[]}
                  onOpenDocument={onOpenDocument}
                  onOpenReference={(path) => onOpenDocument(path)}
                  loadReferences={loadReferences}
                  loadFacets={loadFacets}
                  onSearchTag={(tag) => {
                    setSearchQuery(`tag:${JSON.stringify(tag)}`);
                    showSearch();
                  }}
                />
              </div>
            </div>
          )}
          onSelectSecondaryPane={setRightPane}
          cpuPercent={performanceStats?.cpuPercent}
          memoryMB={performanceStats?.memoryMB}
          files={vault.files}
          workspaceName={vault.vault?.name ?? "No vault open"}
          workspaceOpen={Boolean(vault.vault)}
          onOpenFile={vault.openFile}
          onCreateFile={vault.createFile}
          onCreateFolder={vault.createFolder}
          onRefreshFiles={vault.refreshFiles}
          onRenameFile={vault.renameFile}
          onArchiveFile={vault.archiveFile}
          onDeleteFile={vault.deleteFile}
          onOpenTrash={() => void trash.show()}
          onManageVaults={() => vault.setManagerOpen(true)}
          onEditorChange={(tab, content, onSaved) => {
            if (tab.id.startsWith("file:")) vault.changeDocument(tab.id.slice(5), content, onSaved);
          }}
          onActiveEditorChange={handleActiveEditorChange}
          backlinks={backlinks}
          onFindInEditor={() => setFindRequest((value) => value + 1)}
          onExportPdf={(tab) => {
            setPdfDocument({
              title: tab.title.replace(/\.md$/i, ""),
              path: tab.id.startsWith("file:") ? tab.id.slice(5) : undefined,
              content: tab.content ?? "",
            });
            setPdfOpen(true);
          }}
          journal={{
            selectedDate: journal.date,
            monthLabel: journal.monthLabel,
            days: journal.days,
            entries: journal.entries,
            onSelectDate: journal.setDate,
            onChangeMonth: (offset) => {
              const date = dateFromKey(journal.date);
              date.setMonth(date.getMonth() + offset, 1);
              journal.setDate(localDateKey(date));
            },
            onOpenEntry: vault.openFile,
            onCreateEntry: journal.createEntry,
            onOpenWeekly: journal.openWeekly,
          }}
          renderEditor={renderEditor}
          onMoveEditorToNewWindow={(tab) => {
            const url = new URL(window.location.href);
            url.searchParams.set(
              "popout",
              tab.id.startsWith("file:") ? tab.id.slice(5) : tab.title
            );
            if (runtime.openWindow) void runtime.openWindow(url.toString());
            else window.open(url.toString(), "_blank", "popup,width=960,height=720");
          }}
        />
      )}
      <VaultManager
        open={onboardingComplete ? vault.managerOpen : setupVaultPickerOpen}
        canClose={!onboardingComplete || Boolean(vault.vault)}
        activeVaultId={vault.vault?.id ?? ""}
        vaults={[
          ...vault.available,
          ...vault.recent.map((item) => ({
            vaultId: item.vaultId,
            name: item.displayName,
            path: item.path,
          })),
        ]
          .filter(
            (item, index, items) =>
              items.findIndex((candidate) => candidate.path === item.path) === index
          )
          .filter((item) =>
            `${item.name} ${item.path}`.toLowerCase().includes(vaultQuery.toLowerCase())
          )
          .map((item) => ({ key: item.vaultId ?? item.path, name: item.name, path: item.path }))}
        recentVaults={vault.recent}
        query={vaultQuery}
        vaultAccess={runtime.vaultAccess}
        canSelectDirectory={onboardingComplete && Boolean(runtime.selectVaultDirectory)}
        onClose={() => {
          vault.setManagerOpen(false);
          setSetupVaultPickerOpen(false);
        }}
        onQueryChange={setVaultQuery}
        onOpenVault={async (item) => {
          await vault.openVault(item);
          if (!onboardingComplete) await finishSetup();
        }}
        onForgetVault={vault.forgetVault}
        onChooseVault={chooseVault}
      />
      <PdfExportDialog
        document={pdfDocument}
        documents={Object.values(vault.documents).map((document) => ({
          title: document.path.split("/").pop()?.replace(/\.md$/i, "") ?? document.path,
          path: document.path,
          content: document.content,
          contentHash: document.contentHash,
        }))}
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        onExport={runtime.exportPdf}
      />
      <TrashManager
        open={trash.open}
        vaultName={vault.vault?.name}
        entries={trash.filteredEntries}
        query={trash.query}
        onQueryChange={trash.setQuery}
        onClose={() => trash.setOpen(false)}
        onEmpty={() => trash.setEmptyRequest(true)}
        onRestore={(entry) => void trash.restore(entry)}
        onDelete={trash.setDeleteRequest}
      />
      <ConfirmDialog
        open={Boolean(trash.deleteRequest)}
        title="Delete permanently?"
        description={trash.deleteRequest?.originalPath}
        action="Delete permanently"
        onCancel={() => trash.setDeleteRequest(undefined)}
        onConfirm={() => trash.deleteRequest && void trash.permanentlyDelete(trash.deleteRequest)}
      />
      <ConfirmDialog
        open={trash.emptyRequest}
        title="Empty trash?"
        description="All trashed items will be permanently deleted."
        action="Empty trash"
        onCancel={() => trash.setEmptyRequest(false)}
        onConfirm={() => void trash.empty()}
      />
    </ThemeProvider>
  );
}
