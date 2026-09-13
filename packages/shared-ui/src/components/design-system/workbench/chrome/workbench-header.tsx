import { ButtonGroupDropdown } from "#components/design-system/button-with-dropdown";
import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import { WorkbenchIconButton } from "../shared/workbench-control";
import { WorkbenchIcon } from "../shared/workbench-icon";
import type { UpdateDownloadStatus } from "./release-notes-dialog";

export interface WorkbenchHeaderProps {
  title: string;
  leftInset?: number;
  leftPaneOpen: boolean;
  rightPaneOpen?: boolean;
  onCommand: () => void;
  onBack?: () => void;
  onForward?: () => void;
  onToggleLeftPane: () => void;
  onToggleRightPane?: () => void;
  updateStatus?: UpdateDownloadStatus;
  updateProgress?: number;
  /** Called to download the update — only passed when an update is available */
  onDownloadUpdate?: () => void;
  onInstallUpdate?: () => void;
  onOpenReleaseNotes?: () => void;
  className?: string;
}

export function WorkbenchHeader({
  title,
  leftInset = 0,
  leftPaneOpen,
  rightPaneOpen,
  onCommand,
  onBack,
  onForward,
  onToggleLeftPane,
  onToggleRightPane,
  updateStatus = "available",
  updateProgress,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenReleaseNotes,
  className,
}: WorkbenchHeaderProps) {
  // Map WorkbenchUpdateStatus → the narrower UpdateStatus accepted by ButtonGroupDropdown
  function resolvedDropdownStatus() {
    if (updateStatus === "ready") return "ready-to-install";
    if (
      updateStatus === "downloading" ||
      updateStatus === "downloaded" ||
      updateStatus === "verifying" ||
      updateStatus === "checking" ||
      updateStatus === "installing"
    )
      return "downloading";
    if (updateStatus === "error") return "error";
    return "available";
  }

  return (
    <header
      className={cn(
        "relative flex h-[35px] shrink-0 select-none items-center bg-[var(--workbench-chrome)] px-2 text-[var(--workbench-muted)] [-webkit-app-region:drag]",
        className
      )}
    >
      <div aria-hidden="true" style={{ width: leftInset }} />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-28">
        <div className="pointer-events-auto flex min-w-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          <WorkbenchIconButton
            icon="arrow-left"
            density="chrome"
            aria-label="Go back"
            title="Go back"
            disabled={!onBack}
            onClick={onBack}
          />
          <WorkbenchIconButton
            icon="arrow-right"
            density="chrome"
            aria-label="Go forward"
            title="Go forward"
            disabled={!onForward}
            onClick={onForward}
          />
          <Button
            variant="ghost"
            type="button"
            onClick={onCommand}
            aria-label={`Open command menu: ${title}`}
            title="Open command menu"
            className="flex h-6 w-[480px] max-w-[calc(100vw-260px)] min-w-0 justify-start gap-1.5 rounded-[5px] border border-[var(--workbench-border)] bg-[var(--workbench-editor)]/40 px-2 text-[12px] font-normal text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-fg)] focus-visible:ring-2 focus-visible:ring-[var(--workbench-focus)]"
          >
            <WorkbenchIcon name="search" size={12} />
            <span className="min-w-0 flex-1 truncate text-start">{title}</span>
            <kbd className="shrink-0 text-[10px] opacity-60">⌘K</kbd>
          </Button>
        </div>
      </div>

      <div className="ms-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        <WorkbenchIconButton
          icon={leftPaneOpen ? "layout-sidebar-left" : "layout-sidebar-left-off"}
          density="chrome"
          aria-label="Toggle primary pane"
          title="Toggle primary pane"
          aria-pressed={leftPaneOpen}
          onClick={onToggleLeftPane}
          selected={leftPaneOpen}
        />
        {onToggleRightPane ? (
          <WorkbenchIconButton
            icon={rightPaneOpen ? "layout-sidebar-right" : "layout-sidebar-right-off"}
            density="chrome"
            aria-label="Toggle secondary pane"
            title="Toggle secondary pane"
            aria-pressed={rightPaneOpen}
            onClick={onToggleRightPane}
            selected={rightPaneOpen}
          />
        ) : null}

        {/* Update available dropdown — shown when an update is ready */}
        {onDownloadUpdate && onOpenReleaseNotes && (
          <div className="ms-1">
            <ButtonGroupDropdown
              status={resolvedDropdownStatus()}
              progress={updateProgress}
              onUpdate={onDownloadUpdate}
              onInstall={onInstallUpdate ?? onDownloadUpdate}
              onViewChangelog={onOpenReleaseNotes}
            />
          </div>
        )}
      </div>
    </header>
  );
}
