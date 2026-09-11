"use client";

import * as React from "react";

import { DropdownMenu, DropdownMenuTrigger } from "../../../ui/dropdown-menu";
import { Button } from "../../../ui/button";
import { ScrollArea } from "../../../ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../ui/tooltip";
import { WorkbenchIconButton } from "../shared/workbench-control";
import { WorkbenchIcon } from "../shared/workbench-icon";
import {
  WorkbenchMenuContent,
  WorkbenchMenuItem,
  WorkbenchMenuSeparator,
} from "../shared/workbench-menu";
import { WorkbenchPanel } from "../shared/workbench-panel";
import { DeleteResourceDialog, ResourceDialog, type ResourceRequest } from "./resource-dialog";
import { TrashList } from "./trash-list";

export type WorkbenchTreeItem =
  | { name: string; path: string; type: "file" }
  | {
      name: string;
      path: string;
      type: "folder";
      open?: boolean;
      children?: WorkbenchTreeItem[];
    };

export type PrimarySidebarProps = {
  files?: readonly {
    path: string;
    name: string;
    kind: "directory" | "markdown" | "text" | "binary";
  }[];
  selectedPath?: string;
  workspaceName?: string;
  canMutate?: boolean;
  onSelectFile?: (path: string) => void;
  onCreateFile?: (parent: string | undefined, name: string) => Promise<void>;
  onCreateFolder?: (parent: string | undefined, name: string) => Promise<void>;
  onRefresh?: () => void;
  onCollapseAll?: () => void;
  onRenameFile?: (path: string, name: string) => Promise<void>;
  onDeleteFile?: (path: string) => Promise<void>;
  onArchiveFile?: (path: string) => Promise<void>;
  onManageVaults?: () => void;
  onListTrash?: () => Promise<{ id: string; originalPath: string; deletedAt: string }[]>;
  onRestoreTrash?: (id: string) => Promise<void>;
};

export function PrimarySidebar({
  files,
  selectedPath = "package.json",
  workspaceName = "No vault open",
  canMutate = true,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onCollapseAll,
  onRenameFile,
  onDeleteFile,
  onArchiveFile,
  onManageVaults,
  onListTrash,
  onRestoreTrash,
}: PrimarySidebarProps) {
  const [collapseVersion, setCollapseVersion] = React.useState(0);
  const [request, setRequest] = React.useState<ResourceRequest>();
  const [deletePath, setDeletePath] = React.useState<string>();
  const [renamePath, setRenamePath] = React.useState<string>();
  const [view, setView] = React.useState<"files" | "archive" | "trash">("files");
  const [showArchive, setShowArchive] = React.useState(false);
  const tree = React.useMemo(
    () =>
      fileTree(
        (files ?? []).filter((file) => {
          const archived = file.path === "archive" || file.path.startsWith("archive/");
          return view === "archive" ? archived : showArchive || !archived;
        })
      ),
    [files, showArchive, view]
  );

  return (
    <TooltipProvider delay={500}>
      <WorkbenchPanel>
        <header className="flex h-[35px] shrink-0 items-center ps-2 pe-2 text-[11px] font-normal uppercase tracking-[.04em]">
          <h2 className="min-w-0 flex-1 truncate text-[inherit] font-[inherit]">Explorer</h2>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<WorkbenchIconButton icon="ellipsis" aria-label="More Explorer actions" />}
            />
            <WorkbenchMenuContent align="end" className="w-48">
              <WorkbenchMenuItem
                disabled={!canMutate || !onCreateFile}
                onClick={() => setRequest({ kind: "file" })}
              >
                New File
              </WorkbenchMenuItem>
              <WorkbenchMenuItem
                disabled={!canMutate || !onCreateFolder}
                onClick={() => setRequest({ kind: "folder" })}
              >
                New Folder
              </WorkbenchMenuItem>
              <WorkbenchMenuSeparator />
              <WorkbenchMenuItem disabled={!onRefresh} onClick={onRefresh}>
                Refresh Explorer
              </WorkbenchMenuItem>
              <WorkbenchMenuItem
                onClick={() => {
                  setCollapseVersion((version) => version + 1);
                  onCollapseAll?.();
                }}
              >
                Collapse Folders
              </WorkbenchMenuItem>
              <WorkbenchMenuSeparator />
              <WorkbenchMenuItem disabled={!canMutate} onClick={() => setView("files")}>
                Vault files
              </WorkbenchMenuItem>
              <WorkbenchMenuItem disabled={!canMutate} onClick={() => setView("archive")}>
                Archive
              </WorkbenchMenuItem>
              <WorkbenchMenuItem disabled={!canMutate} onClick={() => setView("trash")}>
                Trash
              </WorkbenchMenuItem>
              <WorkbenchMenuItem
                disabled={!canMutate}
                onClick={() => setShowArchive((value) => !value)}
              >
                {showArchive ? "Hide archive in explorer" : "Show archive in explorer"}
              </WorkbenchMenuItem>
              <WorkbenchMenuSeparator />
              <WorkbenchMenuItem disabled={!onManageVaults} onClick={onManageVaults}>
                Manage Vaults…
              </WorkbenchMenuItem>
            </WorkbenchMenuContent>
          </DropdownMenu>
        </header>

        <p className="h-[22px] shrink-0 truncate px-2 text-[13px] font-medium" title={workspaceName}>
          {workspaceName}
          {view !== "files" ? ` · ${view === "trash" ? "Trash" : "Archive"}` : ""}
        </p>

        <ScrollArea
          className="min-h-0 flex-1 overflow-x-hidden py-0.5"
          role="tree"
          aria-label="Files Explorer"
        >
          {!canMutate ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-5 text-center">
              <p className="text-xs text-[var(--workbench-muted)]">
                Open or create a vault to manage files.
              </p>
              <Button size="sm" variant="outline" type="button" onClick={onManageVaults}>
                Manage vaults
              </Button>
            </div>
          ) : view === "trash" ? (
            <TrashList load={onListTrash} restore={onRestoreTrash} />
          ) : (
            tree.map((item) => (
              <TreeRow
                key={item.path}
                item={item}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                collapseVersion={collapseVersion}
                onNewFileInFolder={(parent) => setRequest({ kind: "file", parent })}
                onNewFolderInFolder={(parent) => setRequest({ kind: "folder", parent })}
                renamePath={renamePath}
                onRenameFile={setRenamePath}
                onCommitRename={async (path, name) => {
                  await onRenameFile?.(path, name);
                  setRenamePath(undefined);
                }}
                onArchiveFile={onArchiveFile}
                onDeleteFile={setDeletePath}
              />
            ))
          )}
        </ScrollArea>
        <ResourceDialog
          key={request ? `${request.kind}:${request.parent ?? "root"}` : "resource:closed"}
          request={request}
          onOpenChange={(open) => !open && setRequest(undefined)}
          onSubmit={async (name) => {
            if (request?.kind === "file") await onCreateFile?.(request.parent, name);
            if (request?.kind === "folder") await onCreateFolder?.(request.parent, name);
          }}
        />
        <DeleteResourceDialog
          key={deletePath ? `delete:${deletePath}` : "delete:closed"}
          path={deletePath}
          onOpenChange={(open) => !open && setDeletePath(undefined)}
          onDelete={async () => {
            if (deletePath) await onDeleteFile?.(deletePath);
          }}
        />
      </WorkbenchPanel>
    </TooltipProvider>
  );
}

function TreeRow({
  item,
  depth,
  selectedPath,
  onSelectFile,
  collapseVersion,
  onNewFileInFolder,
  onNewFolderInFolder,
  renamePath,
  onRenameFile,
  onCommitRename,
  onArchiveFile,
  onDeleteFile,
}: {
  item: WorkbenchTreeItem;
  depth: number;
  selectedPath: string;
  onSelectFile?: (path: string) => void;
  collapseVersion: number;
  onNewFileInFolder?: (folderPath: string) => void;
  onNewFolderInFolder?: (folderPath: string) => void;
  renamePath?: string;
  onRenameFile?: (path: string) => void;
  onCommitRename?: (path: string, name: string) => Promise<void>;
  onArchiveFile?: (path: string) => Promise<void>;
  onDeleteFile?: (path: string) => void;
}) {
  if (item.type === "file") {
    const selected = item.path === selectedPath;

    return (
      <div
        role="none"
        className={`group/row relative flex h-[22px] min-w-0 items-center hover:bg-[var(--workbench-hover)] focus-within:bg-[var(--workbench-hover)] ${selected ? "bg-[var(--workbench-selected)]" : ""}`}
      >
        {renamePath === item.path ? (
          <InlineRename
            item={item}
            depth={depth}
            onCancel={() => onRenameFile?.("")}
            onCommit={(name) => onCommitRename?.(item.path, name) ?? Promise.resolve()}
          />
        ) : (
          <button
            type="button"
            role="treeitem"
            aria-selected={selected}
            draggable
            onClick={() => onSelectFile?.(item.path)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copyMove";
              event.dataTransfer.setData("application/x-flux-path", item.path);
              event.dataTransfer.setData("application/x-flux-file", item.path);
              event.dataTransfer.setData("text/plain", item.path);
            }}
            className="flex h-[22px] w-full min-w-0 select-none items-center pe-2 text-start text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workbench-fg)]"
            style={{ paddingInlineStart: 8 + depth * 8 }}
            title={item.path}
          >
            <span aria-hidden="true" className="me-0.5 inline-block size-4 shrink-0" />
            <WorkbenchIcon name="file" className="me-1.5 text-[var(--workbench-muted)]" />
            <span className="truncate">{item.name}</span>
          </button>
        )}
        <FileRowActions
          path={item.path}
          onOpen={() => onSelectFile?.(item.path)}
          onRename={onRenameFile}
          onArchive={onArchiveFile}
          onDelete={onDeleteFile}
        />
      </div>
    );
  }

  return (
    <TreeFolderRow
      item={item}
      depth={depth}
      selectedPath={selectedPath}
      onSelectFile={onSelectFile}
      collapseVersion={collapseVersion}
      onNewFileInFolder={onNewFileInFolder}
      onNewFolderInFolder={onNewFolderInFolder}
      renamePath={renamePath}
      onRenameFile={onRenameFile}
      onCommitRename={onCommitRename}
      onArchiveFile={onArchiveFile}
      onDeleteFile={onDeleteFile}
    />
  );
}

function TreeFolderRow({
  item,
  depth,
  selectedPath,
  onSelectFile,
  collapseVersion,
  onNewFileInFolder,
  onNewFolderInFolder,
  renamePath,
  onRenameFile,
  onCommitRename,
  onArchiveFile,
  onDeleteFile,
}: {
  item: Extract<WorkbenchTreeItem, { type: "folder" }>;
  depth: number;
  selectedPath: string;
  onSelectFile?: (path: string) => void;
  collapseVersion: number;
  onNewFileInFolder?: (folderPath: string) => void;
  onNewFolderInFolder?: (folderPath: string) => void;
  renamePath?: string;
  onRenameFile?: (path: string) => void;
  onCommitRename?: (path: string, name: string) => Promise<void>;
  onArchiveFile?: (path: string) => Promise<void>;
  onDeleteFile?: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(item.open ?? false);
  const previousCollapseVersion = React.useRef(collapseVersion);

  React.useEffect(() => {
    if (previousCollapseVersion.current === collapseVersion) return;
    previousCollapseVersion.current = collapseVersion;
    setOpen(false);
  }, [collapseVersion]);

  return (
    <div role="none">
      <div className="group/row relative flex h-[22px] min-w-0 items-center hover:bg-[var(--workbench-hover)] focus-within:bg-[var(--workbench-hover)]">
        {renamePath === item.path ? (
          <InlineRename
            item={item}
            depth={depth}
            onCancel={() => onRenameFile?.("")}
            onCommit={(name) => onCommitRename?.(item.path, name) ?? Promise.resolve()}
          />
        ) : (
          <button
            type="button"
            role="treeitem"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex h-[22px] w-full min-w-0 select-none items-center pe-2 text-start text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workbench-fg)]"
            style={{ paddingInlineStart: 8 + depth * 8 }}
            title={item.path}
          >
            <WorkbenchIcon name={open ? "chevron-down" : "chevron-right"} className="me-0.5" />
            <WorkbenchIcon
              name={open ? "folder-opened" : "folder"}
              className="me-1.5 text-[var(--workbench-muted)]"
            />
            <span className="truncate">{item.name}</span>
          </button>
        )}
        <div className="pointer-events-none absolute inset-y-0 end-1 flex items-center bg-[var(--workbench-hover)] opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
          {onNewFileInFolder ? (
            <RowActionButton
              label={`New file in ${item.name}`}
              icon="new-file"
              onClick={() => onNewFileInFolder(item.path)}
            />
          ) : null}
          {onNewFolderInFolder ? (
            <RowActionButton
              label={`New folder in ${item.name}`}
              icon="new-folder"
              onClick={() => onNewFolderInFolder(item.path)}
            />
          ) : null}
          {onNewFileInFolder || onNewFolderInFolder || onRenameFile || onDeleteFile ? (
            <FolderRowActions
              item={item}
              onNewFile={onNewFileInFolder}
              onNewFolder={onNewFolderInFolder}
              onRename={onRenameFile}
              onArchive={onArchiveFile}
              onDelete={onDeleteFile}
            />
          ) : null}
        </div>
      </div>
      {open && item.children && (
        <div role="group">
          {item.children.map((child) => (
            <TreeRow
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              collapseVersion={collapseVersion}
              onNewFileInFolder={onNewFileInFolder}
              onNewFolderInFolder={onNewFolderInFolder}
              renamePath={renamePath}
              onRenameFile={onRenameFile}
              onCommitRename={onCommitRename}
              onArchiveFile={onArchiveFile}
              onDeleteFile={onDeleteFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderRowActions({
  item,
  onNewFile,
  onNewFolder,
  onRename,
  onArchive,
  onDelete,
}: {
  item: Extract<WorkbenchTreeItem, { type: "folder" }>;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onRename?: (path: string) => void;
  onArchive?: (path: string) => Promise<void>;
  onDelete?: (path: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <WorkbenchIconButton
            icon="more"
            density="row"
            aria-label={`More actions for ${item.name}`}
            title="More Actions..."
          />
        }
      />
      <WorkbenchMenuContent align="end" sideOffset={2} className="w-44">
        <WorkbenchMenuItem disabled={!onNewFile} onClick={() => onNewFile?.(item.path)}>
          <WorkbenchIcon name="new-file" />
          New File
        </WorkbenchMenuItem>
        <WorkbenchMenuItem disabled={!onNewFolder} onClick={() => onNewFolder?.(item.path)}>
          <WorkbenchIcon name="new-folder" />
          New Folder
        </WorkbenchMenuItem>
        <WorkbenchMenuSeparator />
        <WorkbenchMenuItem disabled={!onRename} onClick={() => onRename?.(item.path)}>
          <WorkbenchIcon name="rename" />
          Rename
        </WorkbenchMenuItem>
        <WorkbenchMenuItem
          disabled={!onArchive || item.path === "archive"}
          onClick={() => void onArchive?.(item.path)}
        >
          <WorkbenchIcon name="archive" />
          {item.path.startsWith("archive/") ? "Restore to vault" : "Move to archive"}
        </WorkbenchMenuItem>
        <WorkbenchMenuItem disabled={!onDelete} onClick={() => onDelete?.(item.path)}>
          <WorkbenchIcon name="trash" />
          Move to trash
        </WorkbenchMenuItem>
      </WorkbenchMenuContent>
    </DropdownMenu>
  );
}

function RowActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <WorkbenchIconButton icon={icon} density="row" aria-label={label} onClick={onClick} />
        }
      />
      <TooltipContent side="top" className="rounded-sm px-2 py-1">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function InlineRename({
  item,
  depth,
  onCommit,
  onCancel,
}: {
  item: WorkbenchTreeItem;
  depth: number;
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(item.name);
  const [error, setError] = React.useState("");
  const busy = React.useRef(false);
  const cancelled = React.useRef(false);
  const input = React.useRef<HTMLInputElement>(null);

  const submit = async () => {
    const next = name.trim();
    if (busy.current || cancelled.current) return;
    if (!next || next === "." || next === ".." || /[/\\\0]/.test(next)) {
      setError("Use a name without slashes.");
      queueMicrotask(() => input.current?.focus());
      return;
    }
    busy.current = true;
    try {
      await onCommit(next);
    } catch (cause) {
      busy.current = false;
      setError(cause instanceof Error ? cause.message : "Rename failed.");
      queueMicrotask(() => input.current?.focus());
    }
  };

  return (
    <div
      className="flex h-[22px] min-w-0 flex-1 items-center pe-1"
      style={{ paddingInlineStart: 8 + depth * 8 }}
    >
      <WorkbenchIcon
        name={item.type === "folder" ? "folder" : "file"}
        className="me-1.5 shrink-0 text-[var(--workbench-muted)]"
      />
      <input
        ref={input}
        autoFocus
        value={name}
        aria-label={`Rename ${item.name}`}
        aria-invalid={Boolean(error)}
        title={error || `Rename ${item.name}`}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setName(event.target.value);
          setError("");
        }}
        onBlur={() => void submit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") {
            cancelled.current = true;
            onCancel();
          }
        }}
        className="h-[20px] min-w-0 flex-1 rounded-[2px] border border-[var(--workbench-focus)] bg-[var(--workbench-input)] px-1 text-[13px] text-[var(--workbench-fg)] outline-none"
      />
    </div>
  );
}

function FileRowActions({
  path,
  onOpen,
  onRename,
  onArchive,
  onDelete,
}: {
  path: string;
  onOpen?: () => void;
  onRename?: (path: string) => void;
  onArchive?: (path: string) => Promise<void>;
  onDelete?: (path: string) => void;
}) {
  const name = path.split("/").pop() ?? path;

  return (
    <div className="pointer-events-none absolute inset-y-0 end-1 flex items-center bg-[var(--workbench-hover)] opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <WorkbenchIconButton
              icon="more"
              density="row"
              aria-label={`More actions for ${name}`}
              title="More Actions..."
            />
          }
        />
        <WorkbenchMenuContent align="end" sideOffset={2} className="w-44">
          <WorkbenchMenuItem onClick={onOpen}>
            <WorkbenchIcon name="go-to-file" />
            Open
          </WorkbenchMenuItem>
          <WorkbenchMenuSeparator />
          <WorkbenchMenuItem disabled={!onRename} onClick={() => onRename?.(path)}>
            <WorkbenchIcon name="rename" />
            Rename
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!onArchive} onClick={() => void onArchive?.(path)}>
            <WorkbenchIcon name="archive" />
            {path.startsWith("archive/") ? "Restore to vault" : "Move to archive"}
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!onDelete} onClick={() => onDelete?.(path)}>
            <WorkbenchIcon name="trash" />
            Move to trash
          </WorkbenchMenuItem>
        </WorkbenchMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function fileTree(
  files: readonly {
    path: string;
    name: string;
    kind: "directory" | "markdown" | "text" | "binary";
  }[]
): WorkbenchTreeItem[] {
  const roots: WorkbenchTreeItem[] = [];
  const folders = new Map<string, Extract<WorkbenchTreeItem, { type: "folder" }>>();

  const ensureFolder = (path: string) => {
    const existing = folders.get(path);
    if (existing) return existing;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const folder: Extract<WorkbenchTreeItem, { type: "folder" }> = {
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      type: "folder",
      children: [],
    };
    folders.set(path, folder);
    (parentPath ? ensureFolder(parentPath).children! : roots).push(folder);
    return folder;
  };

  for (const entry of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (entry.kind === "directory") {
      ensureFolder(entry.path).name = entry.name;
      continue;
    }
    const parentPath = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : "";
    (parentPath ? ensureFolder(parentPath).children! : roots).push({
      name: entry.name,
      path: entry.path,
      type: "file",
    });
  }
  return roots;
}
