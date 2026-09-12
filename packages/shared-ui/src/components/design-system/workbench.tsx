import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@vscode/codicons/dist/codicon.css";

import { Button } from "../ui/button";
import { toast } from "../sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, useGroupRef } from "../ui/resizable";
import { ActivityBar, type ActivityBarItem } from "./workbench/chrome/activity-bar";
import { CommandPalette } from "./workbench/chrome/command-palette";
import { NotificationCenter } from "./workbench/chrome/notification-center";
import {
  ReleaseNotesDialog,
  type UpdateDownloadStatus,
} from "./workbench/chrome/release-notes-dialog";
import { WorkbenchFooter } from "./workbench/chrome/workbench-footer";
import { WorkbenchHeader } from "./workbench/chrome/workbench-header";
import { WorkbenchSettingsDialog } from "./workbench/chrome/workbench-settings-dialog";
import { EditorArea, type EditorAreaHandle } from "./workbench/editor/editor-area";
import {
  documentStatistics,
  restoreEditorModel,
  type EditorModel,
} from "./workbench/editor/editor-model";
import { JournalCalendar } from "./workbench/journal/journal-calendar";
import { GroupButton } from "./group-button";
import { PrimarySidebar } from "./workbench/sidebar/primary-sidebar";
import { SecondarySidebar } from "./workbench/sidebar/secondary-sidebar";
import { WorkbenchIcon } from "./workbench/shared/workbench-icon";
import { WorkbenchPanel } from "./workbench/shared/workbench-panel";
import type {
  VSCodeWorkbenchProps,
  WorkbenchNotification,
  WorkbenchSnapshot,
  WorkbenchTheme,
  WorkbenchNativeCommand,
  WorkbenchRightView,
} from "./workbench/types";
import { getWorkbenchTheme } from "./workbench/workbench-theme";

export type {
  VSCodeWorkbenchProps,
  WorkbenchSnapshot,
  WorkbenchTheme,
  WorkbenchUpdate,
  WorkbenchNativeCommand,
} from "./workbench/types";

const activityItems: readonly ActivityBarItem[] = [
  { id: "explorer", label: "Explorer", icon: "files" },
  { id: "search", label: "Search", icon: "search" },
  { id: "graph", label: "Graph", icon: "type-hierarchy" },
  { id: "journal", label: "Journal", icon: "calendar" },
];

const activityCopy: Record<string, { title: string; description: string }> = {
  search: {
    title: "Search isn't connected",
    description: "Workspace search will appear here when a document provider is available.",
  },
};

type WorkbenchState = {
  activeActivity: string;
  leftOpen: boolean;
  rightOpen: boolean;
  rightMaximized: boolean;
  rightActivity: WorkbenchRightView;
  dismissedNotifications: string[];
};

const LAYOUT_KEY = "flux-workbench-layout-v3";

function initialWorkbenchState(value: unknown, supportsChat: boolean): WorkbenchState {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  const fallback: WorkbenchState = {
    activeActivity: "explorer",
    leftOpen: width >= 680,
    rightOpen: width >= 900,
    rightMaximized: false,
    rightActivity: "backlinks",
    dismissedNotifications: [],
  };
  const shell =
    isRecord(value) && value.version === 1 && isRecord(value.shell) ? value.shell : null;
  if (!shell) return fallback;
  const activeActivity =
    typeof shell.activeActivity === "string" && activityItems.some((item) => item.id === shell.activeActivity)
      ? shell.activeActivity
      : fallback.activeActivity;
  const allowedRightViews = supportsChat
    ? ["chat", "backlinks", "outgoing", "tags", "properties", "outline"]
    : ["backlinks", "outgoing", "tags", "properties", "outline"];
  const rightActivity =
    typeof shell.rightActivity === "string" && allowedRightViews.includes(shell.rightActivity)
      ? (shell.rightActivity as WorkbenchRightView)
      : fallback.rightActivity;
  return {
    activeActivity,
    leftOpen: typeof shell.leftOpen === "boolean" ? shell.leftOpen : fallback.leftOpen,
    rightOpen: typeof shell.rightOpen === "boolean" ? shell.rightOpen : fallback.rightOpen,
    rightMaximized:
      supportsChat && shell.rightOpen !== false && rightActivity === "chat" && shell.rightMaximized === true,
    rightActivity,
    dismissedNotifications: Array.isArray(shell.dismissedNotifications)
      ? shell.dismissedNotifications.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function initialPanelLayouts(value?: unknown): WorkbenchSnapshot["panelLayouts"] {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.panelLayouts)) return {};
  return Object.fromEntries(
    Object.entries(value.panelLayouts).flatMap(([key, layout]) => {
      if (!isRecord(layout)) return [];
      const entries = Object.entries(layout).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1])
      );
      return entries.length ? [[key, Object.fromEntries(entries)]] : [];
    })
  );
}

function initialEditorModel(value?: unknown): EditorModel {
  return restoreEditorModel(isRecord(value) && value.version === 1 ? value.editor : undefined, []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function VSCodeWorkbench({
  accountSettings,
  runtimeLabel = "Desktop",
  theme,
  titleBarInset = 0,
  initialState,
  update,
  updateStatus,
  updateProgress,
  settingsOpen = false,
  onSettingsOpenChange,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onThemeChange,
  onStateChange,
  onQuickCapture,
  onCommand,
  onOpenToday,
  renderSearch,
  words,
  characters,
  backlinks,
  cpuPercent,
  memoryMB,
  files,
  workspaceName,
  workspaceOpen,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRefreshFiles,
  onRenameFile,
  onDeleteFile,
  onArchiveFile,
  onRestoreArchive,
  onListTrash,
  onRestoreTrash,
  onManageVaults,
  onEditorChange,
  onActiveEditorChange,
  onExportPdf,
  onFindInEditor,
  chat,
  journal,
  renderEditor,
  renderGraph,
  renderBacklinks,
  renderTags,
  renderRightSidebar,
  onMoveEditorToNewWindow,
}: VSCodeWorkbenchProps) {
  const supportsChat = Boolean(chat);
  const [workbenchState, setWorkbenchState] = useState(() =>
    initialWorkbenchState(initialState, supportsChat)
  );
  const [panelLayouts, setPanelLayouts] = useState(() => initialPanelLayouts(initialState));
  const [editorModel, setEditorModel] = useState(() => initialEditorModel(initialState));
  const { activeActivity, leftOpen, rightOpen, rightMaximized, rightActivity } = workbenchState;
  const [commandOpen, setCommandOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [noUpdatesAvailable, setNoUpdatesAvailable] = useState(false);
  const [localDownloadStatus, setDownloadStatus] = useState<UpdateDownloadStatus>("available");
  const downloadStatus = updateStatus ?? localDownloadStatus;
  const [selectedPath, setSelectedPath] = useState("");
  const [activeTab, setActiveTab] = useState<import("./workbench/editor/editor-model").EditorTab>();
  const editorRef = useRef<EditorAreaHandle>(null);
  const defaultLayout = panelLayouts[LAYOUT_KEY];
  const panelGroup = useGroupRef();
  const panelGroupElement = useRef<HTMLDivElement>(null);
  const primarySize = useRef(
    (defaultLayout?.["primary-sidebar"] ?? 0) > 0 ? defaultLayout?.["primary-sidebar"] : undefined
  );
  const secondarySize = useRef(
    (defaultLayout?.["secondary-sidebar"] ?? 0) > 0
      ? defaultLayout?.["secondary-sidebar"]
      : undefined
  );
  const resolveEditorTab = useCallback(
    (tab: import("./workbench/editor/editor-model").EditorTab) =>
      tab.id.startsWith("file:")
        ? (onOpenFile?.(tab.id.slice(5)) ?? Promise.resolve(undefined))
        : Promise.resolve(tab),
    [onOpenFile]
  );

  useLayoutEffect(() => {
    // Panel constraint changes re-register the group in a nested layout effect.
    // Run after registration, even when Electron suspends animation frames.
    const timer = window.setTimeout(() => {
      const width = panelGroupElement.current?.clientWidth ?? 1;
      const primary =
        leftOpen && !rightMaximized ? (primarySize.current ?? (296 / width) * 100) : 0;
      const secondary = rightOpen
        ? rightMaximized
          ? 100
          : (secondarySize.current ?? (300 / width) * 100)
        : 0;
      panelGroup.current?.setLayout({
        "primary-sidebar": primary,
        editor: Math.max(0, 100 - primary - secondary),
        "secondary-sidebar": secondary,
      });
    });
    return () => window.clearTimeout(timer);
  }, [leftOpen, panelGroup, rightMaximized, rightOpen]);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, [theme]);

  useEffect(() => {
    onStateChange?.({ version: 1, shell: workbenchState, panelLayouts, editor: editorModel });
  }, [editorModel, onStateChange, panelLayouts, workbenchState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandOpen(true);
      }
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        target.matches("input, textarea, select, [contenteditable='true']");
      if (
        !isEditing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        onThemeChange(theme === "dark" ? "light" : "dark");
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onThemeChange, theme]);

  const rootStyle = useMemo(() => getWorkbenchTheme(theme), [theme]);
  const latestVersion = update?.latestVersion;
  const updateAvailable = Boolean(latestVersion && latestVersion !== update?.currentVersion);
  const dismissedNotifications = useMemo(
    () => new Set(workbenchState.dismissedNotifications),
    [workbenchState.dismissedNotifications]
  );

  // Dismiss "no updates" message after 4 seconds
  useEffect(() => {
    if (!noUpdatesAvailable) return;
    const timer = setTimeout(() => setNoUpdatesAvailable(false), 4000);
    return () => clearTimeout(timer);
  }, [noUpdatesAvailable]);

  const notifications = useMemo<WorkbenchNotification[]>(() => {
    const items: WorkbenchNotification[] = [];
    if (noUpdatesAvailable && !updateAvailable) {
      items.push({
        id: "update:no-updates",
        title: "No updates available",
        message: `Flux ${update?.currentVersion ?? ""} is up to date.`,
        source: "Flux Update Service",
      });
    }
    if (updateAvailable && latestVersion) {
      const id = `update:${latestVersion}`;
      if (!dismissedNotifications.has(id)) {
        items.push({
          id,
          title: `Flux ${latestVersion} is available`,
          message:
            downloadStatus === "downloading"
              ? "Downloading the update…"
              : downloadStatus === "ready"
                ? "Download complete. Restart Flux when you're ready to install it."
                : downloadStatus === "error"
                  ? "The update could not be downloaded. Retry when you're ready."
                  : `Codename ${update?.codename ?? "Atlas"} is ready to download.`,
          source: "Flux Update Service",
        });
      }
    }
    return items;
  }, [
    dismissedNotifications,
    downloadStatus,
    latestVersion,
    noUpdatesAvailable,
    update?.codename,
    update?.currentVersion,
    updateAvailable,
  ]);

  function updateWorkbench(changes: Partial<WorkbenchState>) {
    setWorkbenchState((current) => ({
      ...current,
      ...changes,
      rightMaximized:
        changes.leftOpen === true || changes.rightOpen === false
          ? false
          : (changes.rightMaximized ?? current.rightMaximized),
    }));
  }

  async function checkForUpdates() {
    if (!onCheckForUpdates || isCheckingForUpdates) return;
    setIsCheckingForUpdates(true);
    setNoUpdatesAvailable(false);
    try {
      await onCheckForUpdates();
      // After the await, updateAvailable will reflect the new state on next render.
      // noUpdatesAvailable is set to true here and cleared by the effect if update arrived.
      setNoUpdatesAvailable(true);
    } catch (error) {
      toast.error("Could not check for updates", {
        description: error instanceof Error ? error.message : "Try again later.",
      });
    } finally {
      setIsCheckingForUpdates(false);
    }
  }

  function selectActivity(id: string) {
    if (id === "graph" && renderGraph) {
      editorRef.current?.openTab({ id: "workbench:graph", title: "Graph" });
      return;
    }
    if (id === "journal" && journal) {
      editorRef.current?.openTab({ id: "workbench:journal", title: "Journal" });
      return;
    }
    if (id === "chat" && supportsChat) {
      updateWorkbench({
        rightActivity: "chat",
        rightOpen: !(rightOpen && rightActivity === "chat"),
        rightMaximized: false,
      });
      return;
    }
    if (id === activeActivity && leftOpen && !rightMaximized) {
      updateWorkbench({ leftOpen: false });
      return;
    }
    updateWorkbench({ activeActivity: id, leftOpen: true });
  }

  function toggleLeftPane() {
    updateWorkbench({
      leftOpen: !leftOpen || rightMaximized,
      activeActivity: leftOpen ? activeActivity : "explorer",
    });
  }

  const handleNativeCommand = useEffectEvent((command: WorkbenchNativeCommand) => {
    if (command === "settings") onSettingsOpenChange?.(true);
    if (command === "updates") {
      onSettingsOpenChange?.(true);
      void checkForUpdates();
    }
    if (command === "vaults") onManageVaults?.();
    if (command === "search") updateWorkbench({ activeActivity: "search", leftOpen: true });
    if (command === "calendar" && journal) selectActivity("journal");
    if (command === "daily-today" && onOpenToday) {
      if (!workspaceOpen) onManageVaults?.();
      else
        void onOpenToday().then((tab) => {
          if (tab) editorRef.current?.openTab(tab);
        });
    }
  });

  useEffect(() => onCommand?.(handleNativeCommand), [onCommand]);

  function toggleRightPane() {
    updateWorkbench({
      rightOpen: supportsChat && rightActivity === "chat" ? true : !rightOpen,
      rightActivity: "backlinks",
      rightMaximized: false,
    });
  }

  function toggleAI() {
    if (!supportsChat) return;
    updateWorkbench({
      rightOpen: rightActivity === "chat" ? !rightOpen : true,
      rightActivity: "chat",
      rightMaximized: false,
    });
  }

  function toggleTheme() {
    const nextTheme: WorkbenchTheme = theme === "dark" ? "light" : "dark";
    onThemeChange(nextTheme);
  }

  async function openFile(path: string) {
    setSelectedPath(path);
    const tab = await onOpenFile?.(path);
    if (tab) editorRef.current?.openTab(tab);
  }

  function openReleaseNotes() {
    setReleaseNotesOpen(true);
  }

  async function downloadUpdate() {
    if (downloadStatus !== "available" && downloadStatus !== "error") return;
    setDownloadStatus("downloading");
    try {
      await onDownloadUpdate?.();
      setDownloadStatus("ready");
    } catch (error) {
      setDownloadStatus("error");
      toast.error("Update download failed", {
        description: error instanceof Error ? error.message : "Try again later.",
      });
    }
  }

  async function installUpdate() {
    if (downloadStatus !== "ready") return;
    await onInstallUpdate?.();
  }

  const primary =
    activeActivity === "explorer" ? (
      <PrimarySidebar
        files={files}
        selectedPath={selectedPath}
        workspaceName={workspaceName}
        canMutate={workspaceOpen}
        onSelectFile={(path) => void openFile(path)}
        onCreateFile={
          onCreateFile
            ? async (parent, name) => {
                const tab = await onCreateFile(parent, name);
                if (tab) editorRef.current?.openTab(tab);
              }
            : undefined
        }
        onCreateFolder={onCreateFolder}
        onRefresh={() => void onRefreshFiles?.()}
        onRenameFile={
          onRenameFile
            ? async (path, name) => {
                await onRenameFile(path, name);
                const destination = renamedPath(path, name);
                editorRef.current?.renamePath(path, destination);
                setSelectedPath((current) =>
                  current === path || current.startsWith(`${path}/`)
                    ? `${destination}${current.slice(path.length)}`
                    : current
                );
              }
            : undefined
        }
        onDeleteFile={
          onDeleteFile
            ? async (path) => {
                await onDeleteFile(path);
                editorRef.current?.closePath(path);
                setSelectedPath((current) =>
                  current === path || current.startsWith(`${path}/`) ? "" : current
                );
              }
            : undefined
        }
        onArchiveFile={
          onArchiveFile
            ? async (path) => {
                const restoring = path.startsWith("archive/");
                if (restoring) {
                  if (!onRestoreArchive) return;
                  await onRestoreArchive(path);
                } else {
                  if (path === "archive") return;
                  await onArchiveFile(path);
                }
                const destination = restoring ? path.slice("archive/".length) : `archive/${path}`;
                editorRef.current?.renamePath(path, destination);
                setSelectedPath((current) =>
                  current === path || current.startsWith(`${path}/`)
                    ? `${destination}${current.slice(path.length)}`
                    : current
                );
              }
            : undefined
        }
        onManageVaults={onManageVaults}
        onListTrash={onListTrash}
        onRestoreTrash={onRestoreTrash}
      />
    ) : activeActivity === "backlinks" && renderBacklinks ? (
      <WorkbenchPanel aria-label="Backlinks" className="overflow-auto">
        {/* eslint-disable-next-line react-hooks/refs */}
        {renderBacklinks((path) => void openFile(path))}
      </WorkbenchPanel>
    ) : activeActivity === "tags" && renderTags ? (
      <WorkbenchPanel aria-label="Tags" className="overflow-auto">
        {renderTags(() => updateWorkbench({ activeActivity: "search", leftOpen: true }))}
      </WorkbenchPanel>
    ) : activeActivity === "search" && renderSearch ? (
      <WorkbenchPanel aria-label="Search" className="overflow-auto">
        {/* The slot forwards this handler to result clicks; it never reads the editor ref while rendering. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {renderSearch((path) => void openFile(path))}
      </WorkbenchPanel>
    ) : (
      <ActivityPlaceholder activityId={activeActivity} />
    );

  const secondaryContent =
    rightActivity === "chat"
      ? null
      : renderRightSidebar?.(
          rightActivity,
          // The slot invokes this from user events; it does not read the editor ref while rendering.
          // eslint-disable-next-line react-hooks/refs
          (path) => void openFile(path),
          () => updateWorkbench({ activeActivity: "search", leftOpen: true })
        );
  const secondary = (
    <SecondarySidebar
      {...chat}
      view={rightActivity}
      onViewChange={(rightActivity) => updateWorkbench({ rightActivity, rightOpen: true })}
      maximized={rightMaximized}
      onClose={() =>
        updateWorkbench({
          rightOpen: false,
          rightMaximized: false,
          activeActivity: activeActivity === "chat" ? "explorer" : activeActivity,
        })
      }
      onToggleMaximize={() => {
        updateWorkbench({ rightMaximized: !rightMaximized });
      }}
    >
      {secondaryContent}
    </SecondarySidebar>
  );

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} relative grid h-dvh min-h-0 w-full grid-rows-[35px_minmax(0,1fr)_22px] overflow-hidden bg-[var(--workbench-chrome)] text-[13px] text-[var(--workbench-fg)] antialiased`}
      data-theme={theme}
      data-workbench=""
      style={rootStyle}
    >
      <WorkbenchHeader
        title="Flux"
        leftInset={titleBarInset}
        leftPaneOpen={leftOpen && !rightMaximized}
        rightPaneOpen={rightOpen && rightActivity !== "chat"}
        aiPaneOpen={supportsChat && rightOpen && rightActivity === "chat"}
        showAI={supportsChat}
        onCommand={() => setCommandOpen(true)}
        onToggleLeftPane={toggleLeftPane}
        onToggleRightPane={toggleRightPane}
        onToggleAI={supportsChat ? toggleAI : undefined}
        updateStatus={downloadStatus}
        updateProgress={updateProgress}
        onDownloadUpdate={
          updateAvailable && downloadStatus !== "available"
            ? () => void downloadUpdate()
            : undefined
        }
        onInstallUpdate={updateAvailable ? () => void installUpdate() : undefined}
        onOpenReleaseNotes={() => setReleaseNotesOpen(true)}
      />

      <main id="workbench-content" className="flex min-h-0 min-w-0 gap-1 overflow-hidden pb-1">
        <ActivityBar
          items={activityItems}
          activeId={activeActivity}
          theme={theme}
          onActiveChange={selectActivity}
          onThemeChange={onThemeChange}
          onSettings={() => onSettingsOpenChange?.(true)}
        />

        <ResizablePanelGroup
          id="workbench-panes"
          orientation="horizontal"
          groupRef={panelGroup}
          elementRef={panelGroupElement}
          defaultLayout={defaultLayout}
          onLayoutChanged={(layout, meta) => {
            if (meta.isUserInteraction) {
              if ((layout["primary-sidebar"] ?? 0) > 0)
                primarySize.current = layout["primary-sidebar"];
              if ((layout["secondary-sidebar"] ?? 0) > 0)
                secondarySize.current = layout["secondary-sidebar"];
              setPanelLayouts((current) => ({ ...current, [LAYOUT_KEY]: layout }));
            }
          }}
          className="min-w-0 flex-1 pe-1"
        >
          <ResizablePanel
            id="primary-sidebar"
            inert={!leftOpen || rightMaximized}
            defaultSize="296px"
            minSize={leftOpen && !rightMaximized ? "190px" : 0}
            maxSize={leftOpen && !rightMaximized ? "45%" : 0}
          >
            {primary}
          </ResizablePanel>
          <WorkbenchResizeHandle
            label="Resize primary side bar"
            hidden={!leftOpen || rightMaximized}
          />

          <ResizablePanel
            id="editor"
            inert={rightMaximized}
            minSize={rightMaximized ? 0 : "280px"}
            maxSize={rightMaximized ? 0 : "100%"}
          >
            <div className="h-full overflow-hidden rounded-[6px] border border-[var(--workbench-border)] bg-[var(--workbench-editor)] shadow-[0_1px_2px_var(--workbench-shadow)]">
              <EditorArea
                ref={editorRef}
                renderEditor={(tab, updateTab) =>
                  tab.id === "workbench:graph" && renderGraph ? (
                    renderGraph(
                      (path) => void openFile(path),
                      (placement) => editorRef.current?.splitActive(placement),
                      () => updateWorkbench({ activeActivity: "search", leftOpen: true })
                    )
                  ) : tab.id === "workbench:journal" && journal ? (
                    <JournalCalendar
                      {...journal}
                      onOpenEntry={async (path) => {
                        const opened = await journal.onOpenEntry(path);
                        if (opened) editorRef.current?.openTab(opened);
                      }}
                      onCreateEntry={async (date, title, tags) => {
                        const opened = await journal.onCreateEntry(date, title, tags);
                        if (opened) editorRef.current?.openTab(opened);
                        return opened;
                      }}
                      onOpenWeekly={async (date) => {
                        const opened = await journal.onOpenWeekly(date);
                        if (opened) editorRef.current?.openTab(opened);
                      }}
                    />
                  ) : (
                    renderEditor?.(tab, updateTab, (path) => void openFile(path))
                  )
                }
                onMoveToNewWindow={onMoveEditorToNewWindow}
                onDocumentChange={onEditorChange}
                onActiveTabChange={(tab) => {
                  setActiveTab(tab);
                  onActiveEditorChange?.(tab);
                }}
                onResolveTab={resolveEditorTab}
                onExportPdf={onExportPdf}
                onFind={onFindInEditor}
                initialTabs={[]}
                initialModel={editorModel}
                onModelChange={setEditorModel}
              />
            </div>
          </ResizablePanel>

          <WorkbenchResizeHandle
            label="Resize secondary side bar"
            hidden={!rightOpen || rightMaximized}
          />
          <ResizablePanel
            id="secondary-sidebar"
            inert={!rightOpen}
            defaultSize="300px"
            minSize={rightOpen ? "240px" : 0}
            maxSize={!rightOpen ? 0 : rightMaximized ? "100%" : "50%"}
          >
            {secondary}
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      <WorkbenchFooter
        {...documentStatistics(activeTab, { words, characters, backlinks })}
        onShowBacklinks={
          renderRightSidebar
            ? () => updateWorkbench({ rightActivity: "backlinks", rightOpen: true })
            : undefined
        }
        cpuPercent={cpuPercent}
        memoryMB={memoryMB}
        center={`${runtimeLabel} · Flux`}
        right={
          <GroupButton>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-pressed={theme === "dark"}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme (D)`}
              onClick={toggleTheme}
            >
              <WorkbenchIcon name={theme === "dark" ? "color-mode" : "symbol-color"} size={12} />
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <NotificationCenter
              notifications={notifications}
              onQuickCapture={onQuickCapture}
              onNotificationClick={openReleaseNotes}
              onAction={(_notificationId, actionId) => {
                if (actionId === "download") void downloadUpdate();
                if (actionId === "release-notes") openReleaseNotes();
              }}
              onDismiss={(notificationId) =>
                updateWorkbench({
                  dismissedNotifications: [
                    ...new Set([...workbenchState.dismissedNotifications, notificationId]),
                  ],
                })
              }
              onClear={() =>
                updateWorkbench({
                  dismissedNotifications: [
                    ...new Set([
                      ...workbenchState.dismissedNotifications,
                      ...notifications.map(({ id }) => id),
                    ]),
                  ],
                })
              }
            />
          </GroupButton>
        }
      />

      <ReleaseNotesDialog
        open={releaseNotesOpen}
        update={update}
        downloadStatus={downloadStatus}
        downloadProgress={updateProgress}
        onOpenChange={setReleaseNotesOpen}
        onDownload={() => void downloadUpdate()}
      />

      <WorkbenchSettingsDialog
        accountSettings={accountSettings}
        open={settingsOpen}
        theme={theme}
        update={update}
        checking={isCheckingForUpdates}
        canCheckForUpdates={Boolean(onCheckForUpdates)}
        onOpenChange={(open) => onSettingsOpenChange?.(open)}
        onThemeChange={onThemeChange}
        onCheckForUpdates={() => void checkForUpdates()}
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        commands={[
          {
            label: leftOpen ? "View: Hide Primary Side Bar" : "View: Show Primary Side Bar",
            run: toggleLeftPane,
          },
          {
            label: rightOpen ? "View: Hide Secondary Side Bar" : "View: Show Secondary Side Bar",
            run: toggleRightPane,
          },
          ...(update ? [{ label: "Help: Show Release Notes", run: openReleaseNotes }] : []),
          ...(supportsChat ? [{ label: "View: Toggle AI Chat", run: toggleAI }] : []),
          ...(journal ? [{ label: "Journal: Open Calendar", run: () => selectActivity("journal") }] : []),
        ]}
      />
    </div>
  );
}

function renamedPath(path: string, name: string) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return parent ? `${parent}/${name}` : name;
}

function WorkbenchResizeHandle({ label, hidden }: { label: string; hidden?: boolean }) {
  return (
    <ResizableHandle
      aria-label={label}
      disabled={hidden}
      style={hidden ? { display: "none" } : undefined}
      className="w-1 bg-transparent after:w-1 after:bg-transparent hover:after:bg-[var(--workbench-focus)] focus-visible:ring-0 focus-visible:after:bg-[var(--workbench-focus)]"
    />
  );
}

function ActivityPlaceholder({ activityId }: { activityId: string }) {
  const copy = activityCopy[activityId] ?? {
    title: "View unavailable",
    description: "This view is not connected yet.",
  };
  return (
    <WorkbenchPanel>
      <header className="flex h-[35px] shrink-0 items-center px-3">
        <h2 className="truncate text-[11px] font-normal uppercase tracking-[.04em]">
          {activityItems.find((item) => item.id === activityId)?.label ?? "View"}
        </h2>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <WorkbenchIcon name="info" size={24} className="mb-3 text-[var(--workbench-muted)]" />
        <p className="text-[13px] font-medium text-[var(--workbench-fg)]">{copy.title}</p>
        <p className="mt-1 max-w-[28ch] text-pretty text-[12px] leading-[1.5] text-[var(--workbench-muted)]">
          {copy.description}
        </p>
      </div>
    </WorkbenchPanel>
  );
}
