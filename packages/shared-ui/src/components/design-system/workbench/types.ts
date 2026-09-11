import type { ChatProps } from "../../ai/chat";
import type { ReactNode } from "react";
import type { EditorRenderer } from "./editor/editor-surface";
import type { EditorModel, EditorTab } from "./editor/editor-model";

export type WorkbenchTheme = "dark" | "light";
export type WorkbenchRightView =
  "chat" | "backlinks" | "outgoing" | "tags" | "properties" | "outline";
export type WorkbenchNativeCommand =
  "search" | "daily-today" | "calendar" | "settings" | "vaults" | "updates";

export interface WorkbenchUpdate {
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  codename?: string;
  bannerUrl?: string;
}

export type WorkbenchUpdateStatus =
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "verifying"
  | "ready"
  | "installing"
  | "error";

export interface WorkbenchNotificationAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface WorkbenchNotification {
  id: string;
  title: string;
  message: string;
  source?: string;
  kind?: "info" | "warning" | "error";
  actions?: readonly WorkbenchNotificationAction[];
}

export interface WorkbenchSnapshot {
  version: 1;
  shell: {
    activeActivity: string;
    leftOpen: boolean;
    rightOpen: boolean;
    rightMaximized: boolean;
    rightActivity?: WorkbenchRightView;
    dismissedNotifications?: string[];
  };
  panelLayouts: Record<string, Record<string, number>>;
  editor?: EditorModel;
}

export interface WorkbenchFile {
  path: string;
  name: string;
  kind: "directory" | "markdown" | "text" | "binary";
}

export interface WorkbenchCalendarEntry {
  path: string;
  title: string;
  date: string;
  kind: "journal" | "file";
  tags: readonly string[];
}

export interface WorkbenchJournal {
  selectedDate: string;
  monthLabel: string;
  days: readonly Date[];
  entries: readonly WorkbenchCalendarEntry[];
  onSelectDate: (date: string) => void;
  onChangeMonth: (offset: number) => void;
  onOpenEntry: (path: string) => Promise<EditorTab | void>;
  onCreateEntry: (date: string, title: string, tags: string[]) => Promise<EditorTab | void>;
  onOpenWeekly: (date: string) => Promise<EditorTab | void>;
}

export interface VSCodeWorkbenchProps {
  accountSettings?: ReactNode;
  runtimeLabel?: string;
  theme: WorkbenchTheme;
  titleBarInset?: number;
  initialState?: unknown;
  update?: WorkbenchUpdate;
  updateStatus?: WorkbenchUpdateStatus;
  updateProgress?: number;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  onCheckForUpdates?: () => Promise<void>;
  onDownloadUpdate?: () => Promise<void>;
  onInstallUpdate?: () => Promise<void>;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onStateChange?: (state: WorkbenchSnapshot) => void;
  onQuickCapture?: () => Promise<void>;
  onCommand?: (handler: (command: WorkbenchNativeCommand) => void) => () => void;
  onOpenToday?: () => Promise<EditorTab | void>;
  renderSearch?: (onOpenFile: (path: string) => void) => ReactNode;
  words?: number;
  characters?: number;
  backlinks?: number;
  cpuPercent?: number;
  memoryMB?: number;
  files?: readonly WorkbenchFile[];
  workspaceName?: string;
  workspaceOpen?: boolean;
  onOpenFile?: (path: string) => Promise<EditorTab | undefined>;
  onCreateFile?: (parent: string | undefined, name: string) => Promise<EditorTab | void>;
  onCreateFolder?: (parent: string | undefined, name: string) => Promise<void>;
  onRefreshFiles?: () => Promise<void>;
  onRenameFile?: (path: string, name: string) => Promise<void>;
  onDeleteFile?: (path: string) => Promise<void>;
  onArchiveFile?: (path: string) => Promise<void>;
  onRestoreArchive?: (path: string) => Promise<void>;
  onListTrash?: () => Promise<{ id: string; originalPath: string; deletedAt: string }[]>;
  onRestoreTrash?: (id: string) => Promise<void>;
  onManageVaults?: () => void;
  onEditorChange?: (tab: EditorTab, content: string, onSaved: () => void) => void;
  onActiveEditorChange?: (tab?: EditorTab) => void;
  onExportPdf?: (tab: EditorTab) => void;
  onFindInEditor?: (tab: EditorTab) => void;
  chat?: ChatProps;
  journal?: WorkbenchJournal;
  renderEditor?: EditorRenderer;
  renderGraph?: (
    onOpenFile: (path: string) => void,
    onSplit: (placement: "right" | "bottom") => void,
    showSearch: () => void
  ) => ReactNode;
  renderBacklinks?: (onOpenFile: (path: string) => void) => ReactNode;
  renderTags?: (showSearch: () => void) => ReactNode;
  renderRightSidebar?: (
    pane: Exclude<WorkbenchRightView, "chat">,
    onOpenFile: (path: string) => void,
    showSearch: () => void
  ) => ReactNode;
  onMoveEditorToNewWindow?: (tab: EditorTab) => void;
}
