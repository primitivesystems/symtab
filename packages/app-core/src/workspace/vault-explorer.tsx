import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import type { FileEntry } from "@flux/bridge-contract";
import {
  Archive,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  ListFilter,
  Trash2,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@flux/shared-ui/components/ui/context-menu";
import {
  Dialog,
  DialogDescription,
  DialogContent,
  DialogTitle,
} from "@flux/shared-ui/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@flux/shared-ui/components/ui/hover-card";
import { splitFrontmatter } from "../editor/frontmatter";
import type { DemoDocument } from "../editor/markdown-editor";

const ReadingView = lazy(() => import("../editor/reading-view"));

interface VaultExplorerProps {
  entries: FileEntry[];
  activePath?: string;
  revealPath?: string;
  selectedPath?: string;
  onClearRevealPath?: () => void;
  onOpen: (path: string) => void;
  onCreateNote: (parent: string, name: string) => void;
  onCreateFolder: (parent: string, name: string) => void;
  onMove: (sourcePath: string, destinationPath: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
  onArchive: (path: string) => void;
  onOpenTrash: () => void;
  onPreview: (path: string) => Promise<string | null>;
  documents: DemoDocument[];
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onExpandFolder?: (path: string) => void;
  onSelectPath?: (path: string) => void;
}

function filePresentation(entry: FileEntry) {
  if (entry.kind === "directory") return { label: entry.name, badge: "" };
  if (/^\.[^.]+$/.test(entry.name)) return { label: entry.name, badge: "" };
  const extension = entry.name.match(/\.([^.]+)$/)?.[1] ?? "";
  if (entry.kind === "markdown")
    return { label: entry.name.replace(/\.(md|markdown)$/i, ""), badge: "" };
  return {
    label: extension ? entry.name.slice(0, -(extension.length + 1)) : entry.name,
    badge: extension.toLocaleUpperCase(),
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function entryMetadata(entry: FileEntry) {
  const kind = entry.kind === "directory" ? "Folder" : filePresentation(entry).badge || "Markdown";
  const modified = new Date(entry.modifiedAt).toLocaleString();
  return entry.kind === "directory"
    ? `${kind} • Modified ${modified}`
    : `${kind} • ${formatFileSize(entry.sizeBytes)} • Modified ${modified}`;
}

export function VaultExplorer({
  entries,
  activePath,
  onOpen,
  onCreateNote,
  onCreateFolder,
  onMove,
  onRename,
  onDelete,
  onArchive,
  onOpenTrash,
  onPreview,
  documents,
  revealPath,
  onClearRevealPath,
  expandedFolders,
  onExpandedFoldersChange,
  onExpandFolder,
  onSelectPath,
  selectedPath,
}: VaultExplorerProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const prevActiveRef = useRef(activePath);
  const prevRevealRef = useRef(revealPath);

  useEffect(() => {
    const activeChanged = activePath !== prevActiveRef.current;
    const revealChanged = revealPath !== prevRevealRef.current;
    prevActiveRef.current = activePath;
    prevRevealRef.current = revealPath;

    const targetRef =
      revealChanged && revealPath
        ? revealRef.current ?? activeRef.current
        : activeChanged && activePath
          ? activeRef.current
          : null;

    targetRef?.scrollIntoView({ behavior: "auto", block: "nearest" });
  }, [activePath, revealPath]);

  const [selectedFolder, setSelectedFolder] = useState<string>();
  const [localExpandedPaths, setLocalExpandedPaths] = useState<Set<string>>(new Set());
  const expandedPaths = useMemo(
    () => (expandedFolders ? new Set(expandedFolders) : localExpandedPaths),
    [expandedFolders, localExpandedPaths]
  );
  const updateExpandedPaths = (update: (current: Set<string>) => Set<string>) => {
    const next = update(expandedPaths);
    if (expandedFolders) onExpandedFoldersChange?.([...next].sort());
    else setLocalExpandedPaths(next);
  };
  const [sortByName, setSortByName] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [dropTarget, setDropTarget] = useState<string>();
  const [preview, setPreview] = useState<{
    path: string;
    content?: string;
    loading: boolean;
  }>();
  const previewRequestRef = useRef(0);
  const dragSourceRef = useRef<string | undefined>(undefined);
  const cancelInlineEditRef = useRef(false);
  const [inlineEdit, setInlineEdit] = useState<
    | { kind: "note" | "folder"; parent: string; value: string }
    | { kind: "rename"; entry: FileEntry; value: string }
  >();
  const [dialog, setDialog] = useState<{ kind: "move"; entry: FileEntry; value: string }>();

  const activeParent = activePath?.includes("/")
    ? activePath.slice(0, activePath.lastIndexOf("/"))
    : "";
  const creationFolder = selectedFolder ?? activeParent;

  const canMoveTo = (source: string, targetFolder: string) => {
    const separator = source.lastIndexOf("/");
    const currentParent = separator < 0 ? "" : source.slice(0, separator);
    return (
      currentParent !== targetFolder &&
      source !== targetFolder &&
      !targetFolder.startsWith(`${source}/`)
    );
  };

  const showPreview = async (entry: FileEntry) => {
    if (entry.kind !== "markdown" && entry.kind !== "text") return;
    if (preview?.path === entry.path) return;
    const request = ++previewRequestRef.current;
    setPreview({ path: entry.path, loading: true });
    try {
      const content = await onPreview(entry.path);
      if (request !== previewRequestRef.current) return;
      setPreview({ path: entry.path, content: content ?? undefined, loading: false });
    } catch {
      if (request === previewRequestRef.current) setPreview({ path: entry.path, loading: false });
    }
  };

  const hidePreview = (path: string) => {
    if (preview?.path !== path) return;
    previewRequestRef.current += 1;
    setPreview(undefined);
  };
  const children = useMemo(() => {
    const grouped = new Map<string, FileEntry[]>();
    for (const entry of entries) {
      if (!showArchived && (entry.path === "archive" || entry.path.startsWith("archive/")))
        continue;
      const separator = entry.path.lastIndexOf("/");
      const parent = separator < 0 ? "" : entry.path.slice(0, separator);
      const list = grouped.get(parent) ?? [];
      list.push(entry);
      grouped.set(parent, list);
    }
    for (const list of grouped.values()) {
      list.sort((left, right) => {
        if (left.kind === "directory" && right.kind !== "directory") return -1;
        if (right.kind === "directory" && left.kind !== "directory") return 1;
        return sortByName
          ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
          : left.modifiedAt.localeCompare(right.modifiedAt);
      });
    }
    return grouped;
  }, [entries, showArchived, sortByName]);

  const beginCreate = (kind: "note" | "folder", parent: string) => {
    cancelInlineEditRef.current = false;
    if (parent) {
      updateExpandedPaths((current) => {
        const next = new Set(current);
        next.add(parent);
        return next;
      });
    }
    setInlineEdit({ kind, parent, value: kind === "note" ? "Untitled" : "New folder" });
  };

  const commitInlineEdit = () => {
    if (cancelInlineEditRef.current) {
      cancelInlineEditRef.current = false;
      setInlineEdit(undefined);
      return;
    }
    const current = inlineEdit;
    if (!current) return;
    setInlineEdit(undefined);
    const value = current.value.trim();
    if (!value) return;
    if (current.kind === "rename") onRename(current.entry.path, value);
    else if (current.kind === "note") onCreateNote(current.parent, value);
    else onCreateFolder(current.parent, value);
  };

  const renderInlineEdit = (parent: string, depth: number, entry?: FileEntry) => {
    if (!inlineEdit) return null;
    if (inlineEdit.kind === "rename") {
      if (!entry || inlineEdit.entry.path !== entry.path) return null;
    } else if (entry || inlineEdit.parent !== parent) return null;
    const directory = inlineEdit.kind === "folder" || entry?.kind === "directory";
    const label =
      inlineEdit.kind === "rename"
        ? `Rename ${entry?.name ?? "item"}`
        : inlineEdit.kind === "folder"
          ? "New folder name"
          : "New note name";
    return (
      <div
        role="treeitem"
        className="flex h-7 w-full items-center gap-1.5 pr-2 text-xs"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {directory ? (
          <FolderOpen className="size-3.5 shrink-0" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <input
          autoFocus
          aria-label={label}
          value={inlineEdit.value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
          onBlur={commitInlineEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitInlineEdit();
            if (event.key === "Escape") {
              cancelInlineEditRef.current = true;
              setInlineEdit(undefined);
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-sm border bg-background px-1.5 outline-none focus:ring-1 focus:ring-ring [border-color:var(--layout-separator)]"
        />
      </div>
    );
  };

  const submitDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    const folder = value.replace(/^\/+|\/+$/g, "");
    onMove(dialog.entry.path, folder ? `${folder}/${dialog.entry.name}` : dialog.entry.name);
    setDialog(undefined);
  };

  const renderEntry = (entry: FileEntry, depth: number) => {
    if (inlineEdit?.kind === "rename" && inlineEdit.entry.path === entry.path) {
      return <div key={entry.path}>{renderInlineEdit("", depth, entry)}</div>;
    }
    const directory = entry.kind === "directory";
    const expanded = expandedPaths.has(entry.path);
    const isRevealTarget = revealPath === entry.path;
    const presentation = filePresentation(entry);
    const metadata = entryMetadata(entry);
    const row = (
      <button
        ref={entry.path === activePath ? activeRef : entry.path === revealPath ? revealRef : undefined}
        type="button"
        role="treeitem"
        data-flux-drop-folder={directory ? entry.path : undefined}
        aria-expanded={directory ? expanded : undefined}
        aria-selected={entry.path === activePath}
        aria-label={`${presentation.label}, ${metadata}`}
        draggable
        onClick={() => {
          onClearRevealPath?.();
          if (!directory) {
            const separator = entry.path.lastIndexOf("/");
            setSelectedFolder(separator < 0 ? "" : entry.path.slice(0, separator));
            onSelectPath?.(entry.path);
            onOpen(entry.path);
            return;
          }
          setSelectedFolder(entry.path);
          onSelectPath?.(entry.path);
          updateExpandedPaths((current) => {
            const next = new Set(current);
            if (next.has(entry.path)) next.delete(entry.path);
            else {
              next.add(entry.path);
              onExpandFolder?.(entry.path);
            }
            return next;
          });
        }}
        onDragStart={(event) => {
          dragSourceRef.current = entry.path;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-flux-path", entry.path);
          event.dataTransfer.setData("text/plain", entry.path);
        }}
        onPointerEnter={(event) => {
          if (event.metaKey || event.ctrlKey) void showPreview(entry);
        }}
        onPointerMove={(event) => {
          if ((event.metaKey || event.ctrlKey) && preview?.path !== entry.path)
            void showPreview(entry);
        }}
        onDragOver={(event) => {
          if (!directory) return;
          const source =
            dragSourceRef.current ??
            event.dataTransfer.getData("application/x-flux-path");
          if (!source || !canMoveTo(source, entry.path)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(entry.path);
        }}
        onDrop={(event) => {
          if (!directory) return;
          const source =
            dragSourceRef.current ??
            event.dataTransfer.getData("application/x-flux-path");
          if (!source || !canMoveTo(source, entry.path)) return;
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(undefined);
          const name = source.slice(source.lastIndexOf("/") + 1);
          onMove(source, `${entry.path}/${name}`);
          setSelectedFolder(entry.path);
        }}
        onDragEnd={() => {
          dragSourceRef.current = undefined;
          setDropTarget(undefined);
        }}
        onPointerLeave={() => hidePreview(entry.path)}
        className={`flex w-full min-w-0 max-w-full select-none items-center gap-1.5 overflow-hidden rounded-md py-1.5 pr-2 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 ${
          dropTarget === entry.path
            ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/50"
            : entry.path === activePath
              ? "bg-sidebar-selected text-sidebar-accent-foreground font-medium"
              : isRevealTarget
                ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/50"
                : entry.path === selectedPath
                  ? "bg-accent/60 text-foreground ring-1 ring-inset ring-primary/50"
                  : "text-muted-foreground"
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {directory ? (
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          />
        ) : null}
        {directory ? (
          <FolderOpen className="size-3.5 shrink-0" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
        {presentation.badge ? (
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {presentation.badge}
          </span>
        ) : null}
      </button>
    );

    return (
      <div key={entry.path}>
        <ContextMenu>
          <ContextMenuTrigger render={<div className="contents" />}>
            <HoverCard
              open={preview?.path === entry.path}
              onOpenChange={(open) => !open && hidePreview(entry.path)}
            >
              <HoverCardTrigger render={row} />
              <HoverCardContent
                side="right"
                align="start"
                sideOffset={10}
                className="z-[160] w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md p-0"
              >
                <div className="grid grid-cols-[3px_minmax(0,1fr)] border-b [border-color:var(--layout-separator)]">
                  <span className="bg-primary/70" aria-hidden="true" />
                  <div className="px-4 py-3">
                    <p className="truncate text-sm font-semibold tracking-tight">
                      {presentation.label}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {entry.path}
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{metadata}</p>
                  </div>
                </div>
                <div className="max-h-96 overflow-auto bg-background/70">
                  {preview?.loading ? (
                    <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
                      <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
                      Loading preview…
                    </div>
                  ) : preview?.content?.trim() ? (
                    <div className="[&_.flux-reading-view]:max-w-none [&_.flux-reading-view]:px-5 [&_.flux-reading-view]:pb-8 [&_.flux-reading-view]:pt-4 [&_.flux-reading-view]:text-sm">
                      <Suspense fallback={<div>Loading...</div>}>
                        <ReadingView
                          value={splitFrontmatter(preview.content).body}
                          documents={documents}
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <p className="p-4 text-xs text-muted-foreground">Empty file</p>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
          </ContextMenuTrigger>
            <ContextMenuContent className="z-[150] min-w-44">
              {directory ? (
                <>
                  <ContextMenuItem
                    onClick={() => beginCreate("note", entry.path)}
                  >
                    New note
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => beginCreate("folder", entry.path)}
                  >
                    New folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              ) : null}
              <ContextMenuItem
                onClick={() => setDialog({ kind: "move", entry, value: "" })}
              >
                Move {directory ? "folder" : "file"} to…
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  cancelInlineEditRef.current = false;
                  setInlineEdit({ kind: "rename", entry, value: entry.name });
                }}
              >
                Rename…
              </ContextMenuItem>
              <ContextMenuSeparator />
              {entry.path !== "archive" && !entry.path.startsWith("archive/") ? (
                <ContextMenuItem onClick={() => onArchive(entry.path)}>
                  Move to archive
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem
                variant="destructive"
                onClick={() => onDelete(entry.path)}
              >
                Move to trash
              </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
        {directory ? (
          <AnimatePresence initial={false}>
            {expanded ? (
              <m.div
                key={`${entry.path}:children`}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
                  opacity: { duration: 0.1, ease: "easeOut" },
                  layout: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
                }}
                layout="size"
                className="overflow-hidden"
              >
                <div role="group" className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_oklab,var(--muted-foreground)_16%,transparent)]"
                    style={{ left: 15 + depth * 16 }}
                  />
                  {renderInlineEdit(entry.path, depth + 1)}
                  {(children.get(entry.path) ?? []).map((child) => renderEntry(child, depth + 1))}
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-9 shrink-0 items-center justify-center gap-0.5 bg-sidebar px-2">
        <button
          type="button"
          aria-label="New note"
          title="New note"
          onClick={() => beginCreate("note", creationFolder)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <FilePlus2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="New folder"
          title="New folder"
          onClick={() => beginCreate("folder", creationFolder)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <FolderPlus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={showArchived ? "Hide archived files" : "Show archived files"}
          title={showArchived ? "Hide archived files" : "Show archived files"}
          onClick={() => setShowArchived((current) => !current)}
          className={`grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent ${showArchived ? "bg-accent" : ""}`}
        >
          <Archive className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Open trash"
          title="Open trash"
          onClick={onOpenTrash}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Sort: ${sortByName ? "Name" : "Modified"}`}
          title="Change sort order"
          onClick={() => setSortByName((current) => !current)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ListFilter className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Collapse all"
          title="Collapse all"
          onClick={() => updateExpandedPaths(() => new Set())}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <div
        data-flux-drop-folder=""
        className={`flux-editor-scroll flux-sidebar-scroll min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto p-1.5 ${dropTarget === "" ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""}`}
        role="tree"
        aria-label="Files"
        onDragOver={(event) => {
          const source =
            dragSourceRef.current ??
            event.dataTransfer.getData("application/x-flux-path");
          if (!source || !canMoveTo(source, "")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget("");
        }}
        onDrop={(event) => {
          const source =
            dragSourceRef.current ??
            event.dataTransfer.getData("application/x-flux-path");
          if (!source || !canMoveTo(source, "")) return;
          event.preventDefault();
          const name = source.slice(source.lastIndexOf("/") + 1);
          onMove(source, name);
          setSelectedFolder("");
          dragSourceRef.current = undefined;
          setDropTarget(undefined);
        }}
        onClick={(event) => {
          if (event.currentTarget === event.target) {
            setSelectedFolder("");
            onSelectPath?.("");
            onClearRevealPath?.();
          }
        }}
      >
        {renderInlineEdit("", 0)}
        {(children.get("") ?? []).map((entry) => renderEntry(entry, 0))}
      </div>
      {dialog ? (
        <Dialog open onOpenChange={(open) => !open && setDialog(undefined)}>
          <DialogContent showCloseButton={false} className="max-w-sm p-5">
            <DialogTitle className="text-sm font-semibold">Move to folder</DialogTitle>
            <DialogDescription className="sr-only">
              Enter destination folder or leave blank for vault root.
            </DialogDescription>
            <input
              id="vault-operation-value"
              autoFocus
              value={dialog.value}
              placeholder="Vault root"
              onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDialog();
              }}
              className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 [border-color:var(--layout-separator)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(undefined)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDialog}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                Move
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
