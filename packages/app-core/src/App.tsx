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
import { useAgentChat } from "./agent/use-agent-chat";
import { dateFromKey, localDateKey } from "./daily-notes/config";
import { useDailyNotes } from "./daily-notes/use-daily-notes";
import { MarkdownEditor, type DemoDocument } from "./editor/markdown-editor";
import { PdfExportDialog } from "./pdf/export";
import { VaultManager } from "./workspace/dialogs";
import { useWorkbenchVault } from "./workbench/use-workbench-vault";
import { workspaceCreationPath } from "./workbench/workspace-setup";
import { SearchPane, WorkspaceRightSidebar } from "./workspace/sidebars";
import { WorkbenchGraph } from "./workbench/workbench-graph";
import type { EditorTab } from "@flux/shared-ui/components/design-system/workbench/editor/editor-area";
import { OnboardingPage } from "@flux/shared-ui/components/design-system/workbench/chrome/onboarding/onboarding-page";
import { Toaster } from "@flux/shared-ui/components/sonner";
import { runWithToast } from "./app/toast-feedback";

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
  showQuickCapture?: () => Promise<void>;
  getMCPServerCommand?: () => Promise<{ command: string; args: string[] }>;
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
  accountSettings?: import("react").ReactNode;
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

export function FluxApp({ runtime, windowControlsInset = 0, accountSettings }: FluxAppProps) {
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
  const [backlinks, setBacklinks] = useState<number>();
  const [activeDocument, setActiveDocument] = useState<DemoDocument | null>(null);
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
  const changeVaultDocument = vault.changeDocument;
  const chat = useAgentChat(runtime.client, vault.vault?.id, persistence);
  const reportJournalError = useCallback((message: string) => console.error(message), []);
  const journal = useDailyNotes({
    client: runtime.client,
    vault: vault.vault,
    files: vault.files,
    refreshFiles: vault.refreshFiles,
    openDocument: vault.openFile,
    onStatus: reportJournalError,
  });
  const flushVaultSaves = vault.flushSaves;
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

  // Refresh the active count when the vault index changes, not just on tab clicks.
  useEffect(() => {
    const path = activeDocument?.path;
    queueMicrotask(() => setBacklinks(undefined));
    if (!path) return;
    let current = true;
    void loadReferences(path)
      .then((references) => {
        if (current) setBacklinks(references.linked.length);
      })
      .catch(() => {
        if (current) setBacklinks(undefined);
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

  const visibleFiles = useMemo(
    () => vault.files.filter((file) => file.kind === "directory" || file.kind === "markdown"),
    [vault.files]
  );
  const documentLocations = useMemo(
    () =>
      visibleFiles
        .filter((file) => file.kind === "markdown")
        .map((file) => ({ path: file.path, title: file.name, content: "" })),
    [visibleFiles]
  );
  const openDocuments = useMemo(
    () =>
      Object.values(vault.documents).map((document) => ({
        path: document.path,
        title: document.path.split("/").pop() ?? document.path,
        content: document.content,
      })),
    [vault.documents]
  );
  const renderEditor = useCallback(
    (
      tab: EditorTab,
      update: (changes: { title?: string; content?: string; dirty?: boolean }) => void,
      onOpenDocument?: (path: string) => void
    ) => {
      if (!tab.title.toLowerCase().endsWith(".md")) return null;
      const path = tab.id.startsWith("file:") ? tab.id.slice(5) : undefined;
      return (
        <MarkdownEditor
          document={{ title: tab.title.replace(/\.md$/i, ""), path, content: tab.content ?? "" }}
          mode={tab.mode ?? "live"}
          onChange={(content) => {
            if (content === tab.content) return;
            update({ content, dirty: true });
            if (path) changeVaultDocument(path, content, () => update({ dirty: false }));
          }}
          onTitleChange={() => undefined}
          showBacklinks={false}
          documents={documentLocations}
          onOpenDocument={onOpenDocument}
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
          onCreateWorkspace={async ({ name, location }) => {
            const path = workspaceCreationPath(name, location, runtime.vaultAccess === "registry");
            await vault.connectVault(path, "create");
            await finishSetup();
          }}
          onOpenVault={async () => {
            if (runtime.vaultAccess === "registry") {
              setSetupVaultPickerOpen(true);
              return;
            }
            const path = await runtime.selectVaultDirectory?.("open");
            if (path) {
              await vault.connectVault(path, "open");
              await finishSetup();
            }
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
          accountSettings={accountSettings}
          onSettingsOpenChange={setSettingsOpen}
          onCheckForUpdates={runtime.checkForUpdates ? handleCheckForUpdates : undefined}
          onDownloadUpdate={runtime.downloadUpdate}
          onInstallUpdate={runtime.installUpdate}
          onThemeChange={setTheme}
          onStateChange={handleStateChange}
          onQuickCapture={runtime.showQuickCapture}
          onCommand={runtime.onCommand}
          onOpenToday={() => journal.openDaily(localDateKey())}
          chat={runtime.client ? (chat ?? { sessions: [], messages: [], providers: [], modelAdapterFactory: () => ({
            async *run() {
              throw new Error("Open a vault and connect an available local AI provider first.");
            },
          }) }) : undefined}
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
          renderRightSidebar={(pane, onOpenDocument, showSearch) => (
            <WorkspaceRightSidebar
              pane={pane}
              activeDocument={activeDocument}
              documents={openDocuments}
              onOpenDocument={onOpenDocument}
              onOpenReference={(path) => onOpenDocument(path)}
              loadReferences={loadReferences}
              loadFacets={loadFacets}
              onSearchTag={(tag) => {
                setSearchQuery(`tag:${JSON.stringify(tag)}`);
                showSearch();
              }}
            />
          )}
          cpuPercent={performanceStats?.cpuPercent}
          memoryMB={performanceStats?.memoryMB}
          files={visibleFiles}
          workspaceName={vault.vault?.name ?? "No vault open"}
          workspaceOpen={Boolean(vault.vault)}
          onOpenFile={vault.openFile}
          onCreateFile={(parent, name) =>
            runWithToast(vault.createFile(parent, name), {
              loading: "Creating file…",
              success: `${name} created`,
              error: "Could not create file",
            })
          }
          onCreateFolder={(parent, name) =>
            runWithToast(vault.createFolder(parent, name), {
              loading: "Creating folder…",
              success: `${name} created`,
              error: "Could not create folder",
            })
          }
          onRefreshFiles={vault.refreshFiles}
          onRenameFile={(path, name) =>
            runWithToast(vault.renameFile(path, name), {
              loading: "Renaming…",
              success: `Renamed to ${name}`,
              error: "Could not rename item",
            })
          }
          onArchiveFile={(path) =>
            runWithToast(vault.archiveFile(path), {
              loading: "Archiving…",
              success: `${path.split("/").pop()} archived`,
              error: "Could not archive item",
            })
          }
          onDeleteFile={(path) =>
            runWithToast(vault.deleteFile(path), {
              loading: "Moving to Trash…",
              success: `${path.split("/").pop()} moved to Trash`,
              error: "Could not move item to Trash",
            })
          }
          onRestoreArchive={(path) =>
            runWithToast(vault.restoreArchive(path), {
              loading: "Restoring from archive…",
              success: "Restored to vault",
              error: "Could not restore item",
            })
          }
          onListTrash={vault.listTrash}
          onRestoreTrash={(id) =>
            runWithToast(vault.restoreTrash(id), {
              loading: "Restoring from Trash…",
              success: "Restored to vault",
              error: "Could not restore item",
            })
          }
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
          renderEditor={renderEditor}

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
        canSelectDirectory={Boolean(runtime.selectVaultDirectory)}
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
      <Toaster />
    </ThemeProvider>
  );
}
