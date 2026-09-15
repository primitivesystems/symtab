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

export type WorkbenchTreeItem =
  | { name: string; path: string; type: "file" }
  | {
      name: string;
      path: string;
      type: "folder";
      open?: boolean;
      children?: WorkbenchTreeItem[];
    };

const FILES: WorkbenchTreeItem[] = [
  { name: ".capacity", path: ".capacity", type: "folder" },
  { name: "public", path: "public", type: "folder" },
  {
    name: "src",
    path: "src",
    type: "folder",
    open: true,
    children: [
      { name: "app", path: "src/app", type: "folder" },
      { name: "components", path: "src/components", type: "folder" },
      { name: "lib", path: "src/lib", type: "folder" },
    ],
  },
  { name: ".gitignore", path: ".gitignore", type: "file" },
  { name: "AGENTS.md", path: "AGENTS.md", type: "file" },
  { name: "CLAUDE.md", path: "CLAUDE.md", type: "file" },
  { name: "components.json", path: "components.json", type: "file" },
  { name: "eslint.config.mjs", path: "eslint.config.mjs", type: "file" },
  { name: "next.config.ts", path: "next.config.ts", type: "file" },
  { name: "package.json", path: "package.json", type: "file" },
  { name: "pnpm-lock.yaml", path: "pnpm-lock.yaml", type: "file" },
  { name: "postcss.config.mjs", path: "postcss.config.mjs", type: "file" },
  { name: "README.md", path: "README.md", type: "file" },
  { name: "tsconfig.json", path: "tsconfig.json", type: "file" },
];

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
  onArchiveFile?: (path: string) => Promise<void>;
  onDeleteFile?: (path: string) => Promise<void>;
  onOpenTrash?: () => void;
  onManageVaults?: () => void;
};

export function PrimarySidebar({
  files,
  selectedPath = "package.json",
  workspaceName = "flux-landing [GitHub]",
  canMutate = true,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onCollapseAll,
  onRenameFile,
  onArchiveFile,
  onDeleteFile,
  onOpenTrash,
  onManageVaults,
}: PrimarySidebarProps) {
  const [collapseVersion, setCollapseVersion] = React.useState(0);
  const [showArchived, setShowArchived] = React.useState(false);
  const [request, setRequest] = React.useState<ResourceRequest>();
  const [deletePath, setDeletePath] = React.useState<string>();
  const tree = React.useMemo(
    () => (files ? fileTree(files, showArchived) : FILES),
    [files, showArchived]
  );
  const startRename = (path: string) =>
    setRequest({ kind: "rename", path, initialName: path.split("/").pop() ?? path });

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
              <WorkbenchMenuItem onClick={() => setShowArchived((visible) => !visible)}>
                <WorkbenchIcon name="archive" />
                {showArchived ? "Hide Archive" : "Show Archive"}
              </WorkbenchMenuItem>
              <WorkbenchMenuItem disabled={!onManageVaults} onClick={onManageVaults}>
                Manage Vaults…
              </WorkbenchMenuItem>
              <WorkbenchMenuItem disabled={!onOpenTrash} onClick={onOpenTrash}>
                Open Trash…
              </WorkbenchMenuItem>
            </WorkbenchMenuContent>
          </DropdownMenu>
        </header>

        <div className="group flex h-[22px] shrink-0 items-center ps-2 pe-1">
          <WorkbenchIcon name="chevron-down" className="me-0.5" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={workspaceName}>
            {workspaceName}
          </span>
          <div className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <WorkbenchIconButton
              icon="new-file"
              aria-label="New file"
              disabled={!canMutate || !onCreateFile}
              onClick={() => setRequest({ kind: "file" })}
            />
            <WorkbenchIconButton
              icon="new-folder"
              aria-label="New folder"
              disabled={!canMutate || !onCreateFolder}
              onClick={() => setRequest({ kind: "folder" })}
            />
            <WorkbenchIconButton
              icon="refresh"
              aria-label="Refresh explorer"
              disabled={!onRefresh}
              onClick={onRefresh}
            />
            <WorkbenchIconButton
              icon="collapse-all"
              aria-label="Collapse folders in Explorer"
              onClick={() => {
                setCollapseVersion((version) => version + 1);
                onCollapseAll?.();
              }}
            />
          </div>
        </div>

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
          ) : tree.length ? (
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
                onRenameFile={startRename}
                onArchiveFile={onArchiveFile}
                onDeleteFile={setDeletePath}
              />
            ))
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-5 text-center">
              <p className="text-xs text-[var(--workbench-muted)]">This workspace has no notes.</p>
              <Button size="sm" variant="outline" type="button" disabled={!onCreateFile}
                onClick={() => setRequest({ kind: "file" })}>New file</Button>
            </div>
          )}
        </ScrollArea>
        <ResourceDialog
          key={
            request
              ? `${request.kind}:${"path" in request ? request.path : (request.parent ?? "root")}`
              : "resource:closed"
          }
          request={request}
          onOpenChange={(open) => !open && setRequest(undefined)}
          onSubmit={async (name) => {
            if (request?.kind === "file") await onCreateFile?.(request.parent, name);
            if (request?.kind === "folder") await onCreateFolder?.(request.parent, name);
            if (request?.kind === "rename") await onRenameFile?.(request.path, name);
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
  onRenameFile,
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
  onRenameFile?: (path: string) => void;
  onArchiveFile?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
}) {
  if (item.type === "file") {
    const selected = item.path === selectedPath;

    return (
      <div
        role="none"
        className={`group/row relative flex h-[22px] min-w-0 items-center hover:bg-[var(--workbench-hover)] focus-within:bg-[var(--workbench-hover)] ${selected ? "bg-[var(--workbench-selected)]" : ""}`}
      >
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
      onRenameFile={onRenameFile}
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
  onRenameFile,
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
  onRenameFile?: (path: string) => void;
  onArchiveFile?: (path: string) => void;
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
        <div className="pointer-events-none absolute inset-y-0 end-1 flex items-center bg-[var(--workbench-hover)] opacity-0 transition-opacity duration-100 motion-reduce:transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
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
          {onNewFileInFolder ||
          onNewFolderInFolder ||
          onRenameFile ||
          onArchiveFile ||
          onDeleteFile ? (
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
              onRenameFile={onRenameFile}
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
  onArchive?: (path: string) => void;
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
          disabled={!onArchive || item.path === "archive" || item.path.startsWith("archive/")}
          onClick={() => onArchive?.(item.path)}
        >
          <WorkbenchIcon name="archive" />
          Archive
        </WorkbenchMenuItem>
        <WorkbenchMenuItem disabled={!onDelete} onClick={() => onDelete?.(item.path)}>
          <WorkbenchIcon name="trash" />
          Delete
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
  onArchive?: (path: string) => void;
  onDelete?: (path: string) => void;
}) {
  const name = path.split("/").pop() ?? path;

  return (
    <div className="pointer-events-none absolute inset-y-0 end-1 flex items-center bg-[var(--workbench-hover)] opacity-0 transition-opacity duration-100 motion-reduce:transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
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
          <WorkbenchMenuItem
            disabled={!onArchive || path.startsWith("archive/")}
            onClick={() => onArchive?.(path)}
          >
            <WorkbenchIcon name="archive" />
            Archive
          </WorkbenchMenuItem>
          <WorkbenchMenuItem disabled={!onDelete} onClick={() => onDelete?.(path)}>
            <WorkbenchIcon name="trash" />
            Delete
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
  }[],
  showArchived = true
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
    if (!showArchived && (entry.path === "archive" || entry.path.startsWith("archive/"))) continue;
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
