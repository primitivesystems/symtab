"use client";

import * as React from "react";

import { cn } from "../../../../lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../ui/resizable";
import { Tabs } from "../../../ui/tabs";
import {
  hasEditorDropData,
  isCopyOperation,
  isSplitToggleOperation,
  readDroppedTab,
  type DropPlacement,
} from "./editor-dnd";
import { EditorHeader } from "./editor-header";
import {
  createEditorModel,
  editorReducer,
  getGroup,
  type EditorGroupId,
  type EditorLayoutNode,
  type EditorTab,
  type SplitPlacement,
} from "./editor-model";
import { EditorSurface, type EditorRenderer } from "./editor-surface";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";

export type { EditorTab } from "./editor-model";

export type EditorAreaProps = {
  initialTabs?: readonly EditorTab[];
  className?: string;
  onTabsChange?: (tabs: readonly EditorTab[]) => void;
  onSplit?: (tab: EditorTab) => void;
  onMoveToNewWindow?: (tab: EditorTab) => void;
  onDocumentChange?: (tab: EditorTab, content: string, onSaved: () => void) => void;
  onActiveTabChange?: (tab?: EditorTab) => void;
  onResolveTab?: (tab: EditorTab) => Promise<EditorTab | undefined>;
  onExportPdf?: (tab: EditorTab) => void;
  onFind?: (tab: EditorTab) => void;
  renderEditor?: EditorRenderer;
};

export type EditorAreaHandle = {
  openTab: (tab: EditorTab) => void;
  openTabToSide: (tab: EditorTab) => void;
  updateDocument: (tabId: string, changes: Partial<Omit<EditorTab, "id">>) => void;
  renamePath: (sourcePath: string, destinationPath: string) => void;
  closePath: (path: string) => void;
  splitActive: (placement: SplitPlacement) => void;
};

const DEFAULT_TABS: readonly EditorTab[] = [{ id: "agents", title: "AGENTS.md" }];

export const EditorArea = React.forwardRef<EditorAreaHandle, EditorAreaProps>(function EditorArea(
  {
    initialTabs = DEFAULT_TABS,
    className,
    onTabsChange,
    onSplit,
    onMoveToNewWindow,
    onDocumentChange,
    onActiveTabChange,
    onResolveTab,
    onExportPdf,
    onFind,
    renderEditor,
  },
  ref
) {
  const [model, dispatch] = React.useReducer(editorReducer, initialTabs, createEditorModel);
  const [pendingClose, setPendingClose] = React.useState<{
    groupId: EditorGroupId;
    tabId?: string;
  } | null>(null);

  React.useImperativeHandle(ref, () => ({
    openTab: (tab) => dispatch({ type: "open", tab }),
    openTabToSide: (tab) => {
      dispatch({ type: "open", tab, groupId: model.activeGroupId });
      dispatch({ type: "split", groupId: model.activeGroupId, placement: "right" });
    },
    updateDocument: (tabId, changes) => dispatch({ type: "update-document", tabId, changes }),
    renamePath: (sourcePath, destinationPath) =>
      dispatch({ type: "rename-path", sourcePath, destinationPath }),
    closePath: (path) => dispatch({ type: "close-path", path }),
    splitActive: (placement) =>
      dispatch({ type: "split", groupId: model.activeGroupId, placement }),
  }));

  const notifyTabsChange = React.useEffectEvent((tabs: EditorTab[]) => onTabsChange?.(tabs));
  const notifyActiveTabChange = React.useEffectEvent((tab?: EditorTab) => onActiveTabChange?.(tab));
  React.useEffect(() => {
    const openIds = [...new Set(model.groups.flatMap((group) => group.tabIds))];
    notifyTabsChange(openIds.flatMap((id) => (model.documents[id] ? [model.documents[id]] : [])));
  }, [model.documents, model.groups]);

  React.useEffect(() => {
    const group = getGroup(model, model.activeGroupId);
    notifyActiveTabChange(group?.activeTabId ? model.documents[group.activeTabId] : undefined);
  }, [model]);

  // Handle opening external URLs in new tabs
  React.useEffect(() => {
    const handleOpenUrl = (event: CustomEvent<{ url: string }>) => {
      const { url } = event.detail;
      const tabId = `url:${url}`;
      const urlObj = new URL(url);
      const title = urlObj.hostname;
      dispatch({
        type: "open",
        tab: { id: tabId, title },
      });
    };

    window.addEventListener("flux-open-url", handleOpenUrl as EventListener);
    return () => window.removeEventListener("flux-open-url", handleOpenUrl as EventListener);
  }, []);

  function splitEditor(groupId: EditorGroupId, placement: SplitPlacement) {
    const group = getGroup(model, groupId);
    const tab = group?.activeTabId ? model.documents[group.activeTabId] : undefined;
    dispatch({ type: "split", groupId, placement });
    if (tab) onSplit?.(tab);
  }

  async function dropTab(
    targetGroupId: EditorGroupId,
    placement: DropPlacement,
    dataTransfer: DataTransfer,
    targetIndex?: number,
    copy = false
  ) {
    const dropped = readDroppedTab(dataTransfer);
    if (!dropped) return;
    const tab =
      !dropped.source && onResolveTab
        ? ((await onResolveTab(dropped.tab)) ?? dropped.tab)
        : dropped.tab;
    dispatch({
      type: "drop",
      tab,
      sourceGroupId: dropped.source,
      targetGroupId,
      placement,
      targetIndex,
      operation: copy ? "copy" : "move",
    });
  }

  function isLastDirtyView(groupId: EditorGroupId, tabId: string) {
    return Boolean(
      model.documents[tabId]?.dirty &&
      model.groups.filter((candidate) => candidate.tabIds.includes(tabId)).length === 1 &&
      model.groups.some((candidate) => candidate.id === groupId && candidate.tabIds.includes(tabId))
    );
  }

  function requestClose(groupId: EditorGroupId, tabId: string) {
    if (isLastDirtyView(groupId, tabId)) setPendingClose({ groupId, tabId });
    else dispatch({ type: "close", groupId, tabId });
  }

  function requestCloseAll(groupId: EditorGroupId) {
    const group = getGroup(model, groupId);
    if (group?.tabIds.some((tabId) => isLastDirtyView(groupId, tabId))) {
      setPendingClose({ groupId });
    } else dispatch({ type: "close-all", groupId });
  }

  const renderGroup = (groupId: EditorGroupId) => {
    const group = getGroup(model, groupId);
    if (!group) return null;
    return (
      <EditorGroup
        group={groupId}
        tabs={group.tabIds.flatMap((id) => (model.documents[id] ? [model.documents[id]] : []))}
        activeTabId={group.activeTabId}
        active={model.activeGroupId === groupId}
        onActivate={(tabId) => dispatch({ type: "activate-tab", groupId, tabId })}
        onClose={(tabId) => requestClose(groupId, tabId)}
        onCloseAfter={(tabId) => dispatch({ type: "close-after", groupId, tabId })}
        onCloseAll={() => requestCloseAll(groupId)}
        onCloseOthers={(tabId) => dispatch({ type: "close-others", groupId, tabId })}
        onCloseSaved={() => dispatch({ type: "close-saved", groupId })}
        onDocumentChange={(tabId, content) => {
          const tab = model.documents[tabId];
          dispatch({ type: "update-document", tabId, changes: { content, dirty: true } });
          if (tab)
            onDocumentChange?.(tab, content, () =>
              dispatch({ type: "update-document", tabId, changes: { dirty: false } })
            );
        }}
        onDocumentUpdate={(tabId, changes) => dispatch({ type: "update-document", tabId, changes })}
        renderEditor={renderEditor}
        onTogglePin={(tabId) => dispatch({ type: "toggle-pin", groupId, tabId })}
        onMoveToNewWindow={onMoveToNewWindow}
        onExportPdf={onExportPdf}
        onFind={onFind}
        onFocus={() => dispatch({ type: "activate-group", groupId })}
        onSplit={(placement) => splitEditor(groupId, placement)}
        onDropTab={(placement, dataTransfer, targetIndex, copy) =>
          dropTab(groupId, placement, dataTransfer, targetIndex, copy)
        }
      />
    );
  };

  return (
    <>
      <div className={cn("h-full min-h-0 min-w-0", className)}>
        <EditorSplitLayout
          node={model.layout}
          renderGroup={renderGroup}
          onResize={(splitId, sizes) => dispatch({ type: "resize-split", splitId, sizes })}
        />
      </div>
      <UnsavedChangesDialog
        open={Boolean(pendingClose)}
        fileName={
          pendingClose?.tabId
            ? (model.documents[pendingClose.tabId]?.title ?? "this file")
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
        onDiscard={() => {
          if (!pendingClose) return;
          if (pendingClose.tabId) {
            dispatch({
              type: "close",
              groupId: pendingClose.groupId,
              tabId: pendingClose.tabId,
              force: true,
            });
          } else {
            dispatch({ type: "close-all", groupId: pendingClose.groupId, force: true });
          }
          setPendingClose(null);
        }}
      />
    </>
  );
});

function EditorSplitLayout({
  node,
  renderGroup,
  onResize,
}: {
  node: EditorLayoutNode;
  renderGroup: (groupId: EditorGroupId) => React.ReactNode;
  onResize: (splitId: string, sizes: [number, number]) => void;
}) {
  if (node.type === "group") return renderGroup(node.groupId);
  const vertical = node.orientation === "vertical";
  return (
    <ResizablePanelGroup
      id={node.id}
      orientation={node.orientation}
      className="h-full min-h-0 min-w-0"
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return;
        onResize(node.id, [
          layout[`${node.id}-first`] ?? node.sizes[0],
          layout[`${node.id}-second`] ?? node.sizes[1],
        ]);
      }}
    >
      <ResizablePanel
        id={`${node.id}-first`}
        defaultSize={`${node.sizes[0] * 100}%`}
        minSize={vertical ? "140px" : "220px"}
      >
        <EditorSplitLayout node={node.first} renderGroup={renderGroup} onResize={onResize} />
      </ResizablePanel>
      <ResizableHandle className="bg-[var(--workbench-border)]" />
      <ResizablePanel
        id={`${node.id}-second`}
        defaultSize={`${node.sizes[1] * 100}%`}
        minSize={vertical ? "140px" : "220px"}
      >
        <EditorSplitLayout node={node.second} renderGroup={renderGroup} onResize={onResize} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

type EditorGroupProps = {
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
  onDocumentChange: (tabId: string, content: string) => void;
  onDocumentUpdate: (tabId: string, changes: Partial<Omit<EditorTab, "id">>) => void;
  renderEditor?: EditorRenderer;
  onTogglePin: (id: string) => void;
  onMoveToNewWindow?: (tab: EditorTab) => void;
  onExportPdf?: (tab: EditorTab) => void;
  onFind?: (tab: EditorTab) => void;
  onFocus: () => void;
  onSplit: (side: SplitPlacement) => void;
  onDropTab: (
    placement: DropPlacement,
    dataTransfer: DataTransfer,
    targetIndex?: number,
    copy?: boolean
  ) => void;
};

function EditorGroup({
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
  onDocumentChange,
  onDocumentUpdate,
  renderEditor,
  onTogglePin,
  onMoveToNewWindow,
  onExportPdf,
  onFind,
  onFocus,
  onSplit,
  onDropTab,
}: EditorGroupProps) {
  const [dropPlacement, setDropPlacement] = React.useState<DropPlacement | null>(null);

  function clearDragState() {
    setDropPlacement(null);
  }

  function updateDropPlacement(event: React.DragEvent<HTMLElement>) {
    if (!hasEditorDropData(event.dataTransfer)) return;
    event.preventDefault();
    const internal = event.dataTransfer.types.includes("application/x-symtab-editor-tab");
    event.dataTransfer.dropEffect =
      internal && !isCopyOperation(event.nativeEvent) ? "move" : "copy";
    if ((event.target as Element).closest("[data-editor-tab-strip]")) {
      setDropPlacement(null);
      return;
    }
    if (isSplitToggleOperation(event.nativeEvent)) {
      setDropPlacement("center");
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = bounds.width;
    const height = Math.max(bounds.height - 35, 1);
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top - 35;
    const insideCenter = x > width * 0.1 && x < width * 0.9 && y > height * 0.1 && y < height * 0.9;
    if (insideCenter) {
      setDropPlacement("center");
    } else if (x < width / 3) {
      setDropPlacement("left");
    } else if (x > (width * 2) / 3) {
      setDropPlacement("right");
    } else {
      setDropPlacement(y < height / 2 ? "top" : "bottom");
    }
  }

  return (
    <section
      aria-label={`${active ? "Active " : ""}editor group`}
      data-active={active || undefined}
      className="relative h-full min-h-0 min-w-0 bg-[var(--workbench-editor)] text-[var(--workbench-fg)]"
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
      onDragEnter={updateDropPlacement}
      onDragOver={updateDropPlacement}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDragState();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dropPlacement)
          onDropTab(
            dropPlacement,
            event.dataTransfer,
            undefined,
            isCopyOperation(event.nativeEvent)
          );
        clearDragState();
      }}
    >
      <Tabs
        value={activeTabId ?? ""}
        onValueChange={(value) => onActivate(String(value))}
        className="h-full min-h-0 flex-col gap-0"
      >
        {tabs.length ? <EditorHeader
          group={group}
          tabs={tabs}
          activeTabId={activeTabId}
          active={active}
          onActivate={onActivate}
          onClose={onClose}
          onCloseAfter={onCloseAfter}
          onCloseAll={onCloseAll}
          onCloseOthers={onCloseOthers}
          onCloseSaved={onCloseSaved}
          onSplit={onSplit}
          onTogglePin={onTogglePin}
          onMoveToNewWindow={onMoveToNewWindow}
          onExportPdf={onExportPdf}
          onFind={onFind}
          onDropTab={(dataTransfer, targetIndex, copy) =>
            onDropTab("center", dataTransfer, targetIndex, copy)
          }
          onDragEnd={clearDragState}
        /> : null}

        {tabs.length ? (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {tabs.map((tab) => {
              const selected = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  role="tabpanel"
                  aria-label={`${tab.title} editor`}
                  aria-hidden={!selected}
                  className={cn("absolute inset-0", selected ? "flex" : "invisible")}
                >
                  <EditorSurface
                    tab={tab}
                    active={selected}
                    onChange={(content) => onDocumentChange(tab.id, content)}
                    onUpdate={(changes) => onDocumentUpdate(tab.id, changes)}
                    renderEditor={renderEditor}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <EditorSurface />
          </div>
        )}
      </Tabs>

      <DropPreview placement={dropPlacement} withHeader={tabs.length > 0} />
      <span className="sr-only" role="status">
        {dropPlacement ? `Drop to open in the ${dropPlacement} editor area` : ""}
      </span>
    </section>
  );
}

function DropPreview({ placement, withHeader }: { placement: DropPlacement | null; withHeader: boolean }) {
  if (!placement) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20 bg-[var(--workbench-drop)] transition-[inset,width,height] duration-100 ease-out",
        placement === "left" && "right-1/2 bottom-0 left-0",
        placement === "center" && "inset-x-0 bottom-0",
        placement === "right" && "right-0 bottom-0 left-1/2",
        placement === "top" && "inset-x-0 bottom-1/2",
        placement === "bottom" && "inset-x-0 top-1/2 bottom-0",
        withHeader ? "top-[35px]" : "top-0"
      )}
    />
  );
}

export default EditorArea;
