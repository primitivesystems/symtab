import { useState } from "react";
import { ButtonGroup } from "../../../ui/button-group";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../../ui/context-menu";
import { DropdownMenu, DropdownMenuShortcut, DropdownMenuTrigger } from "../../../ui/dropdown-menu";
import type { SplitPlacement } from "./editor-model";
import { WorkbenchIconButton } from "../shared/workbench-control";
import {
  WorkbenchMenuContent,
  WorkbenchMenuItem,
  WorkbenchMenuSeparator,
} from "../shared/workbench-menu";

export type EditorActionsProps = {
  activeTab?: { pinned?: boolean };
  canCloseAfter: boolean;
  canCloseOthers: boolean;
  onClose: () => void;
  onCloseAfter: () => void;
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onCloseSaved: () => void;
  onMoveToNewWindow?: () => void;
  onExportPdf?: () => void;
  onFind?: () => void;
  onSplit: (placement: SplitPlacement) => void;
  onTogglePin: () => void;
};

export function EditorActions({
  activeTab,
  canCloseAfter,
  canCloseOthers,
  onClose,
  onCloseAfter,
  onCloseAll,
  onCloseOthers,
  onCloseSaved,
  onMoveToNewWindow,
  onExportPdf,
  onFind,
  onSplit,
  onTogglePin,
}: EditorActionsProps) {
  const [splitPlacement, setSplitPlacement] = useState<SplitPlacement>("right");
  const split = (placement: SplitPlacement) => {
    setSplitPlacement(placement);
    onSplit(placement);
  };

  return (
    <ButtonGroup className="shrink-0 px-0.5" role="toolbar" aria-label="Editor actions">
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <WorkbenchIconButton
              icon={splitPlacement === "top" || splitPlacement === "bottom" ? "split-vertical" : "split-horizontal"}
              density="chrome"
              aria-label={`Split editor ${splitPlacement}`}
              title={`Split Editor ${splitPlacement[0].toUpperCase()}${splitPlacement.slice(1)} (right-click for direction)`}
              onClick={() => split(splitPlacement)}
            />
          }
        />
        <ContextMenuContent className="w-44">
          {(["left", "right", "top", "bottom"] as const).map((placement) => (
            <ContextMenuItem key={placement} onClick={() => split(placement)}>
              Split {placement === "top" ? "Up" : placement === "bottom" ? "Down" : placement[0].toUpperCase() + placement.slice(1)}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <WorkbenchIconButton
              icon="more"
              density="chrome"
              aria-label="More editor actions"
              title="More Actions..."
            />
          }
        />
        <WorkbenchMenuContent align="end" className="w-52">
          <WorkbenchMenuItem disabled={!activeTab} onClick={onClose}>
            Close Editor
            <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!canCloseOthers} onClick={onCloseOthers}>
            Close Other Editors
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!canCloseAfter} onClick={onCloseAfter}>
            Close Editors to the Right
          </WorkbenchMenuItem>
          <WorkbenchMenuItem onClick={onCloseAll}>
            Close All Editors
            <DropdownMenuShortcut>⌘K W</DropdownMenuShortcut>
          </WorkbenchMenuItem>
          <WorkbenchMenuItem onClick={onCloseSaved}>
            Close Saved Editors
            <DropdownMenuShortcut>⌘K U</DropdownMenuShortcut>
          </WorkbenchMenuItem>
          <WorkbenchMenuSeparator />
          <WorkbenchMenuItem disabled={!activeTab} onClick={onTogglePin}>
            {activeTab?.pinned ? "Unpin Editor" : "Pin Editor"}
          </WorkbenchMenuItem>
          {onMoveToNewWindow ? (
            <WorkbenchMenuItem onClick={onMoveToNewWindow}>Move into New Window</WorkbenchMenuItem>
          ) : null}
          <WorkbenchMenuSeparator />
          <WorkbenchMenuItem disabled={!onFind} onClick={onFind}>
            Find in Document
            <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!onExportPdf} onClick={onExportPdf}>
            Export to PDF…
          </WorkbenchMenuItem>
        </WorkbenchMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
