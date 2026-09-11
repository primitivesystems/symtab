import * as React from "react";

import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import { TabsList, TabsTrigger } from "../../../ui/tabs";
import { WorkbenchIcon } from "../shared/workbench-icon";
import { EditorActions } from "./editor-actions";
import { hasEditorDropData, isCopyOperation } from "./editor-dnd";
import type { EditorGroupId, EditorTab, SplitPlacement } from "./editor-model";
import { fileIconName } from "./editor-surface";

export type EditorHeaderProps = {
  group: EditorGroupId;
  tabs: readonly EditorTab[];
  activeTabId?: string;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAfter: (id: string) => void;
  onCloseAll: () => void;
  onCloseOthers: (id: string) => void;
  onCloseSaved: () => void;
  onSplit: (placement: SplitPlacement) => void;
  onTogglePin: (id: string) => void;
  onMoveToNewWindow?: (tab: EditorTab) => void;
  onExportPdf?: (tab: EditorTab) => void;
  onFind?: (tab: EditorTab) => void;
  onDropTab: (dataTransfer: DataTransfer, targetIndex: number, copy: boolean) => void;
  onDragEnd: () => void;
};

export function EditorHeader({
  group,
  tabs,
  activeTabId,
  active,
  onActivate,
  onClose,
  onCloseAfter,
  onCloseAll,
  onCloseOthers,
  onCloseSaved,
  onSplit,
  onTogglePin,
  onMoveToNewWindow,
  onExportPdf,
  onFind,
  onDropTab,
  onDragEnd,
}: EditorHeaderProps) {
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const activeTabRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearDragState() {
    setDropIndex(null);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    onDragEnd();
  }

  React.useLayoutEffect(() => {
    const tab = activeTabRef.current;
    const viewport = viewportRef.current;
    if (!tab || !viewport) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < viewport.scrollLeft) viewport.scrollLeft = start;
    else if (end > viewport.scrollLeft + viewport.clientWidth)
      viewport.scrollLeft = end - viewport.clientWidth;
  }, [activeTabId]);

  return (
    <header
      data-editor-tab-strip
      className="flex h-[35px] shrink-0 items-center border-b border-[var(--workbench-border)] bg-[var(--workbench-tab-bar)]"
    >
      <div
        ref={viewportRef}
        className="h-[35px] min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-color:var(--workbench-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--workbench-border)]"
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          const viewport = event.currentTarget;
          if (viewport.scrollWidth <= viewport.clientWidth) return;
          viewport.scrollLeft += event.deltaY;
          event.preventDefault();
        }}
      >
        <TabsList
          variant="line"
          aria-label="Open editors"
          className="h-[35px]! w-max min-w-full justify-start gap-0 rounded-none p-0"
        >
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              ref={tab.id === activeTabId ? activeTabRef : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copyMove";
                event.dataTransfer.setData(
                  "application/x-flux-editor-tab",
                  JSON.stringify({ tab, source: group })
                );
                event.dataTransfer.setData("text/plain", tab.title);
                const dragImage = document.createElement("div");
                dragImage.textContent = tab.title;
                dragImage.className =
                  "fixed -top-96 left-0 rounded-sm bg-[var(--workbench-sidebar)] px-2 py-1 text-[12px] text-[var(--workbench-fg)] shadow-md";
                document.body.append(dragImage);
                event.dataTransfer.setDragImage(dragImage, 12, 12);
                setTimeout(() => dragImage.remove());
              }}
              onDragEnd={clearDragState}
              onDragOver={(event) => {
                if (!hasEditorDropData(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = isCopyOperation(event.nativeEvent)
                  ? "copy"
                  : "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropIndex(index + (event.clientX > bounds.left + bounds.width / 2 ? 1 : 0));

                const viewport = viewportRef.current;
                if (viewport) {
                  const viewportBounds = viewport.getBoundingClientRect();
                  if (event.clientX < viewportBounds.left + 32) viewport.scrollLeft -= 16;
                  else if (event.clientX > viewportBounds.right - 32) viewport.scrollLeft += 16;
                }

                if (tab.id !== activeTabId && !hoverTimerRef.current) {
                  hoverTimerRef.current = setTimeout(() => {
                    onActivate(tab.id);
                    hoverTimerRef.current = null;
                  }, 500);
                }
              }}
              onDragLeave={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                onDropTab(
                  event.dataTransfer,
                  index + (event.clientX > bounds.left + bounds.width / 2 ? 1 : 0),
                  isCopyOperation(event.nativeEvent)
                );
                clearDragState();
              }}
              className={cn(
                "group/tab relative mx-[2px] flex h-[30px] min-w-[96px] max-w-[220px] flex-none items-center rounded-[7px] text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-fg)] has-[>[data-active]]:text-[var(--workbench-fg)]",
                active
                  ? "has-[>[data-active]]:bg-[var(--workbench-tab-active)]"
                  : "has-[>[data-active]]:bg-[var(--workbench-tab-unfocused)] has-[>[data-active]]:text-[var(--workbench-muted)]",
                dropIndex === index &&
                  "before:absolute before:inset-y-0 before:-left-[3px] before:z-20 before:w-0.5 before:bg-[var(--workbench-selected)]",
                dropIndex === tabs.length &&
                  index === tabs.length - 1 &&
                  "after:absolute after:inset-y-0 after:-right-[3px] after:z-20 after:w-0.5 after:bg-[var(--workbench-selected)]"
              )}
            >
              <TabsTrigger
                value={tab.id}
                aria-label={tab.title}
                className="h-full min-w-0 flex-1 justify-start rounded-[7px] border-0 bg-transparent px-2 text-[13px] font-normal leading-none text-inherit transition-none after:hidden data-active:bg-transparent data-active:text-inherit"
              >
                <WorkbenchIcon name={fileIconName(tab.title)} />
                <span className="min-w-0 flex-1 truncate text-start">{tab.title}</span>
              </TabsTrigger>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${tab.title}${tab.dirty ? ", unsaved changes" : ""}`}
                className={cn(
                  "!size-5 !rounded-[3px] transition-colors hover:bg-[var(--workbench-hover)] focus-visible:ring-2 focus-visible:ring-[var(--workbench-selected)]",
                  tab.id === activeTabId
                    ? "opacity-100"
                    : "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100"
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <WorkbenchIcon name="close" />
              </Button>
            </div>
          ))}
        </TabsList>
      </div>

      <EditorActions
        activeTab={tabs.find((tab) => tab.id === activeTabId)}
        canCloseOthers={tabs.length > 1}
        canCloseAfter={tabs.findIndex((tab) => tab.id === activeTabId) < tabs.length - 1}
        onClose={() => activeTabId && onClose(activeTabId)}
        onCloseOthers={() => activeTabId && onCloseOthers(activeTabId)}
        onCloseAfter={() => activeTabId && onCloseAfter(activeTabId)}
        onCloseAll={onCloseAll}
        onCloseSaved={onCloseSaved}
        onTogglePin={() => activeTabId && onTogglePin(activeTabId)}
        onMoveToNewWindow={
          onMoveToNewWindow && activeTabId
            ? () => {
                const tab = tabs.find((candidate) => candidate.id === activeTabId);
                if (tab) onMoveToNewWindow(tab);
              }
            : undefined
        }
        onExportPdf={
          onExportPdf && activeTabId
            ? () => {
                const tab = tabs.find((candidate) => candidate.id === activeTabId);
                if (tab) onExportPdf(tab);
              }
            : undefined
        }
        onFind={
          onFind && activeTabId
            ? () => {
                const tab = tabs.find((candidate) => candidate.id === activeTabId);
                if (tab) onFind(tab);
              }
            : undefined
        }
        onSplit={onSplit}
      />
    </header>
  );
}
