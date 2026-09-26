import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  BookmarkPlus,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  FileText,
  FilePlus2,
  Files,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Grid2X2,
  List,
  ListCollapse,
  ListFilter,
  LayoutDashboard,
  Link2,
  LocateFixed,
  Network,
  PanelLeft,
  PanelRight,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogContent,
  AlertDialogTitle,
} from "@symtab/shared-ui/components/ui/alert-dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@symtab/shared-ui/components/ui/hover-card";
import type {
  DocumentReferences,
  FileEntry,
  SearchResult,
  VaultFacets,
} from "@symtab/bridge-contract";
import type { BookmarkItem } from "../bookmarks/store";
import { getFrontmatterProperties, splitFrontmatter } from "../editor/frontmatter";
import type { DemoDocument } from "../editor/markdown-editor";
import { buildLinkIndex, linkedMentionsFor, type DocumentMention } from "../editor/link-index";
import { VaultExplorer } from "./vault-explorer";
import { cn } from "@symtab/shared-ui";

export type LeftPane = "files" | "search" | "bookmarks";
export type RightPane =
  "backlinks" | "outgoing" | "tags" | "properties" | "outline" | "source-control";

export interface PluginRibbonItem {
  id: string;
  label: string;
  icon?: string;
  iconSrc?: string;
  active?: boolean;
  onClick: () => void;
}

const pluginIcons = {
  puzzle: Puzzle,
  sparkles: Sparkles,
  "git-branch": GitBranch,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  "layout-dashboard": LayoutDashboard,
  calendar: CalendarDays,
  list: List,
} as const;

export function getLeftOptions(
  plugins?: Record<string, boolean>
): Array<{ id: LeftPane; label: string; icon: typeof Files }> {
  const options: Array<{ id: LeftPane; label: string; icon: typeof Files }> = [];
  if (!plugins || plugins["file-explorer"] !== false) {
    options.push({ id: "files", label: "Files", icon: Files });
  }
  if (!plugins || plugins["search"] !== false) {
    options.push({ id: "search", label: "Search", icon: Search });
  }
  if (!plugins || plugins["bookmarks"] !== false) {
    options.push({ id: "bookmarks", label: "Bookmarks", icon: Bookmark });
  }
  return options;
}

export function getRightOptions(
  plugins?: Record<string, boolean>
): Array<{ id: RightPane; label: string; icon: typeof List }> {
  const options: Array<{ id: RightPane; label: string; icon: typeof List }> = [];

  if (!plugins || plugins["backlinks"] !== false) {
    options.push({ id: "backlinks", label: "Backlinks", icon: Link2 });
  }

  options.push({ id: "outgoing", label: "Outgoing links", icon: ExternalLink });
  options.push({ id: "tags", label: "Tags", icon: Tags });

  if (!plugins || plugins["properties"] !== false) {
    options.push({ id: "properties", label: "Properties", icon: Settings2 });
  }

  if (!plugins || plugins["outline"] !== false) {
    options.push({ id: "outline", label: "Outline", icon: List });
  }

  return options;
}

function IconButton({
  label,
  children,
  active = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PaneTabs<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<{ id: T; label: string; icon: typeof Files }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav aria-label="Sidebar views" className="flex h-8 items-center gap-1 overflow-hidden px-2">
      {options.map(({ id, label, icon: Icon }) => (
        <IconButton key={id} label={label} active={active === id} onClick={() => onChange(id)}>
          <Icon className="size-4" strokeWidth={1.8} />
        </IconButton>
      ))}
    </nav>
  );
}

function SidebarToolbar({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <div
      className={`sticky top-0 z-30 flex min-h-9 shrink-0 items-center justify-center gap-0.5 bg-sidebar px-2 ${wrap ? "flex-wrap py-1" : ""}`}
    >
      {children}
    </div>
  );
}

function SidebarPane({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="shrink-0 bg-sidebar">{controls}</div>
      <div className="symtab-editor-scroll symtab-sidebar-scroll min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function documentSummary(document: DemoDocument) {
  const body = splitFrontmatter(document.content).body;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const properties = getFrontmatterProperties(document.content);
  const tags = properties.find(({ key }) => key === "tags")?.value;
  const preview = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`[\]{}|~=!-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
  return { words, tags, preview };
}

function FileRow({
  document,
  selected,
  depth,
  onOpen,
  onReorder,
}: {
  document: DemoDocument;
  selected: boolean;
  depth: number;
  onOpen: () => void;
  onReorder: (title: string, before: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const summary = useMemo(() => documentSummary(document), [document]);
  const metadata = ["Markdown", `${summary.words} words`, summary.tags && `tags ${summary.tags}`]
    .filter(Boolean)
    .join(" • ");

  return (
    <HoverCard
      open={previewOpen}
      onOpenChange={(open) => {
        if (!open) setPreviewOpen(false);
      }}
    >
      <HoverCardTrigger
        render={
          <button
            type="button"
            role="treeitem"
            draggable
            aria-selected={selected}
            title={`${document.title}\n${metadata}\n⌘/Ctrl + hover to preview`}
            onClick={onOpen}
            onPointerEnter={(event) => setPreviewOpen(event.metaKey || event.ctrlKey)}
            onPointerLeave={() => setPreviewOpen(false)}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-symtab-file", document.title);
              event.dataTransfer.setData("text/plain", document.title);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("application/x-symtab-file")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const source = event.dataTransfer.getData("application/x-symtab-file");
              if (source && source !== document.title) onReorder(source, document.title);
            }}
            className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              selected
                ? "bg-sidebar-selected text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
            style={{ paddingLeft: 8 + depth * 16 }}
          />
        }
      >
        <Files className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{document.title}</span>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} className="z-[130] w-80">
        <p className="truncate text-sm font-semibold">{document.title}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{metadata}</p>
        <p className="mt-3 line-clamp-6 text-xs leading-5 text-muted-foreground">
          {summary.preview || "Empty note"}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function FileExplorer({
  activeTitle,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
}: {
  activeTitle: string;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string) => void;
}) {
  const [folders, setFolders] = useState(() => ["Projects", "Reference"]);
  const [locations, setLocations] = useState<Record<string, string | null>>(() => ({
    "Project plan": "Projects",
    "Performance notes": "Reference",
  }));
  const [order, setOrder] = useState(() => documents.map(({ title }) => title));
  const [sortByName, setSortByName] = useState(false);
  const [autoReveal, setAutoReveal] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingMove, setPendingMove] = useState<
    | { kind: "folder"; title: string; folder: string | null }
    | { kind: "reorder"; title: string; before: string }
  >();

  const sortedDocuments = useMemo(() => {
    const rank = new Map(order.map((title, index) => [title, index]));
    return [...documents].sort((a, b) =>
      sortByName
        ? a.title.localeCompare(b.title)
        : (rank.get(a.title) ?? order.length) - (rank.get(b.title) ?? order.length)
    );
  }, [documents, order, sortByName]);

  const confirmMove = () => {
    if (!pendingMove) return;
    if (pendingMove.kind === "folder") {
      setLocations((current) => ({ ...current, [pendingMove.title]: pendingMove.folder }));
    } else {
      setOrder((current) => {
        const next = current.filter((title) => title !== pendingMove.title);
        const index = next.indexOf(pendingMove.before);
        next.splice(index < 0 ? next.length : index, 0, pendingMove.title);
        return next;
      });
      setSortByName(false);
    }
    setPendingMove(undefined);
  };

  const renderFiles = (folder: string | null, depth = 0) =>
    sortedDocuments
      .filter((document) => (locations[document.title] ?? null) === folder)
      .map((document) => (
        <FileRow
          key={document.title}
          document={document}
          selected={document.title === activeTitle}
          depth={depth}
          onOpen={() => onOpenDocument(document.title)}
          onReorder={(title, before) => setPendingMove({ kind: "reorder", title, before })}
        />
      ));

  return (
    <>
      <SidebarToolbar>
        <IconButton label="New note" onClick={onCreateNote}>
          <FilePlus2 className="size-3.5" />
        </IconButton>
        <IconButton
          label="New folder"
          onClick={() => setFolders((current) => [...current, `New folder ${current.length - 1}`])}
        >
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton
          label={`Sort: ${sortByName ? "Name" : "Manual"}`}
          active={sortByName}
          onClick={() => setSortByName((current) => !current)}
        >
          <ListFilter className="size-3.5" />
        </IconButton>
        <IconButton
          label="Auto-reveal active file"
          active={autoReveal}
          onClick={() => setAutoReveal((current) => !current)}
        >
          <LocateFixed className="size-3.5" />
        </IconButton>
        <IconButton
          label={collapsed.size === folders.length ? "Expand all" : "Collapse all"}
          onClick={() =>
            setCollapsed((current) =>
              current.size === folders.length ? new Set() : new Set(folders)
            )
          }
        >
          <ChevronRight className="size-3.5 rotate-90" />
        </IconButton>
      </SidebarToolbar>
      <div
        className="p-1.5"
        role="tree"
        aria-label="Files"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("application/x-symtab-file")) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const title = event.dataTransfer.getData("application/x-symtab-file");
          if (title && locations[title]) setPendingMove({ kind: "folder", title, folder: null });
        }}
      >
        <button
          type="button"
          role="treeitem"
          onClick={onOpenPdf}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <FileText className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">Symtab PDF demo</span>
          <span className="text-[9px] uppercase tracking-wide">PDF</span>
        </button>
        {renderFiles(null)}
        {folders.map((folder) => (
          <div key={folder}>
            <button
              type="button"
              role="treeitem"
              aria-expanded={
                !collapsed.has(folder) || (autoReveal && locations[activeTitle] === folder)
              }
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(folder)) next.delete(folder);
                  else next.add(folder);
                  return next;
                })
              }
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("application/x-symtab-file")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const title = event.dataTransfer.getData("application/x-symtab-file");
                if (title && locations[title] !== folder) {
                  setPendingMove({ kind: "folder", title, folder });
                }
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={`size-3.5 transition-transform ${
                  collapsed.has(folder) && !(autoReveal && locations[activeTitle] === folder)
                    ? ""
                    : "rotate-90"
                }`}
              />
              <FolderOpen className="size-3.5" />
              <span className="truncate">{folder}</span>
            </button>
            {collapsed.has(folder) && !(autoReveal && locations[activeTitle] === folder) ? null : (
              <div role="group">{renderFiles(folder, 1)}</div>
            )}
          </div>
        ))}
      </div>
      <AlertDialog
        open={Boolean(pendingMove)}
        onOpenChange={(open) => !open && setPendingMove(undefined)}
      >
        <AlertDialogContent className="w-[min(420px,calc(100vw-2rem))] rounded-xl p-5">
          <AlertDialogTitle className="text-sm font-semibold">Move file?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-5 text-muted-foreground">
            {pendingMove?.kind === "folder"
              ? `Move “${pendingMove.title}” to ${pendingMove.folder ?? "vault root"}?`
              : `Move “${pendingMove?.title ?? "file"}” before “${pendingMove?.kind === "reorder" ? pendingMove.before : "file"}”?`}
          </AlertDialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogCancel className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmMove}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Move
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-3">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary"
      />
    </label>
  );
}

function searchHighlightTerms(query: string) {
  const content: string[] = [];
  const path: string[] = [];
  for (const token of query.split(/\s+/)) {
    const separator = token.indexOf(":");
    const operator = separator > 0 ? token.slice(0, separator).toLowerCase() : "";
    const value = separator > 0 ? token.slice(separator + 1) : token;
    const terms = value.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (operator === "path" || operator === "file") path.push(...terms);
    else if (operator !== "tag" && operator !== "property") content.push(...terms);
  }
  return { content, path };
}

function HighlightedText({
  text,
  terms,
  matchCase,
}: {
  text: string;
  terms: string[];
  matchCase: boolean;
}) {
  const uniqueTerms = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniqueTerms.length) return text;
  const escaped = uniqueTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, matchCase ? "g" : "gi");
  return text.split(pattern).map((part, index) => {
    const matched = uniqueTerms.some((term) =>
      matchCase ? part === term : part.toLocaleLowerCase() === term.toLocaleLowerCase()
    );
    return matched ? (
      <mark
        // Text plus position is stable for a given result.
        key={`${part}-${index}`}
        className="rounded-[2px] px-px font-semibold text-inherit"
        style={{ backgroundColor: "rgba(250, 204, 21, 0.42)" }}
      >
        {part}
      </mark>
    ) : (
      part
    );
  });
}

export function SearchPane({
  searchVault,
  onOpenDocument,
  query,
  onQueryChange,
}: {
  searchVault?: (query: string, offset?: number, matchCase?: boolean) => Promise<SearchResult[]>;
  onOpenDocument: (title: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [matchCase, setMatchCase] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [collapseResults, setCollapseResults] = useState(false);
  const [moreContext, setMoreContext] = useState(false);
  const [explainTerms, setExplainTerms] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedCount, setLoadedCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const displayedResults = query.trim() ? results : [];
  const displayedError = query.trim() ? error : "";
  const highlightTerms = useMemo(() => searchHighlightTerms(query), [query]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !searchVault) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      setHasMore(false);
      setLoadedCount(0);
      void searchVault(trimmed, 0, matchCase)
        .then((next) => {
          if (!current) return;
          setResults(next);
          setLoadedCount(next.length);
          setHasMore(next.length === 100);
        })
        .catch((reason) => {
          if (current) setError(reason instanceof Error ? reason.message : "Search failed");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [matchCase, query, searchVault]);

  const loadMore = async () => {
    if (!searchVault || !query.trim() || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await searchVault(query.trim(), loadedCount, matchCase);
      setResults((current) => [
        ...current,
        ...next.filter((result) => !current.some((existing) => existing.path === result.path)),
      ]);
      setLoadedCount((current) => current + next.length);
      setHasMore(next.length === 100);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-1 bg-sidebar p-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            aria-label="Search vault"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => onQueryChange("")}>
              <X className="size-3.5 text-muted-foreground" />
            </button>
          ) : null}
        </label>
        <IconButton
          label="Match case"
          active={matchCase}
          onClick={() => setMatchCase((current) => !current)}
        >
          <span className="text-[11px] font-semibold">Aa</span>
        </IconButton>
        <IconButton
          label="Search settings"
          active={showSettings}
          onClick={() => setShowSettings((current) => !current)}
        >
          <Settings2 className="size-3.5" />
        </IconButton>
      </div>
      {showSettings ? (
        <div className="space-y-1 border-b px-3 pb-2 text-xs [border-color:var(--layout-separator)]">
          <ToggleRow
            label="Collapse results"
            checked={collapseResults}
            onChange={setCollapseResults}
          />
          <ToggleRow label="Show more context" checked={moreContext} onChange={setMoreContext} />
          <ToggleRow
            label="Explain search terms"
            checked={explainTerms}
            onChange={setExplainTerms}
          />
          {explainTerms ? (
            <div className="rounded-md bg-muted/45 px-2.5 py-2 font-mono text-[10px] leading-5 text-muted-foreground">
              <div>
                <span className="text-foreground">path:</span> folder or path
              </div>
              <div>
                <span className="text-foreground">file:</span> file name
              </div>
              <div>
                <span className="text-foreground">tag:</span> exact tag
              </div>
              <div>
                <span className="text-foreground">property:</span> frontmatter key
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="px-2 pb-3 text-[11px] text-muted-foreground">
        {query ? (
          <div className="flex items-center justify-between border-b px-1 py-2 [border-color:var(--layout-separator)]">
            <span>
              {loading
                ? "Searching index…"
                : `${displayedResults.length}${hasMore ? "+" : ""} results`}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[9px]">FTS5</span>
              {hasMore ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="rounded border px-1.5 py-0.5 font-medium text-foreground hover:bg-accent disabled:opacity-50 [border-color:var(--layout-separator)]"
                >
                  {loadingMore ? "Loading…" : "+100"}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {displayedError ? <p className="px-1 py-3 text-destructive">{displayedError}</p> : null}
        {!displayedError && displayedResults.length
          ? displayedResults.map((result) => (
              <button
                key={result.path}
                type="button"
                onClick={() => onOpenDocument(result.path)}
                className="mt-1 block w-full rounded-md px-2 py-2 text-left outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="block truncate font-medium text-foreground">
                  <HighlightedText
                    text={result.title}
                    terms={[...highlightTerms.content, ...highlightTerms.path]}
                    matchCase={matchCase}
                  />
                </span>
                <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                  <HighlightedText
                    text={result.path}
                    terms={[...highlightTerms.content, ...highlightTerms.path]}
                    matchCase={matchCase}
                  />
                </span>
                {!collapseResults && result.excerpt ? (
                  <span
                    className={`mt-1.5 block border-l pl-2 leading-4 [border-color:var(--layout-separator)] ${
                      moreContext ? "line-clamp-4" : "line-clamp-2"
                    }`}
                  >
                    <HighlightedText
                      text={result.excerpt}
                      terms={highlightTerms.content}
                      matchCase={matchCase}
                    />
                  </span>
                ) : null}
              </button>
            ))
          : !loading && query
            ? "No matches found."
            : !query
              ? "Search indexed note content, paths, tags, and properties."
              : null}
      </div>
    </>
  );
}

function BookmarksPane({
  activeTitle,
  activePath,
  bookmarks = [],
  groups = [],
  onOpenDocument,
  onRemoveBookmark,
  onOpenAddBookmark,
  onCreateGroup,
}: {
  activeTitle: string;
  activePath?: string;
  bookmarks?: BookmarkItem[];
  groups?: string[];
  onOpenDocument: (titleOrPath: string) => void;
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateGroup?: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const handleCreateGroup = () => {
    const name = window.prompt("Enter new group name:");
    if (name?.trim()) {
      onCreateGroup?.(name.trim());
    }
  };

  const renderBookmarkRow = (item: BookmarkItem, plClass = "pl-7") => (
    <div
      key={item.id}
      className={cn(
        "group/bookmark flex w-full items-center rounded-md py-1.5 text-left hover:bg-accent/60",
        (item.path === activePath || item.title === activeTitle) && "bg-accent/50"
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDocument(item.path || item.title)}
        className={cn("flex min-w-0 flex-1 items-center gap-2 text-left outline-none", plClass)}
      >
        <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{item.title}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${item.title} bookmark`}
        onClick={() => onRemoveBookmark?.(item.id)}
        className="mr-1 grid size-6 shrink-0 place-items-center rounded opacity-0 text-muted-foreground hover:bg-accent hover:text-foreground group-hover/bookmark:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );

  const ungroupedBookmarks = bookmarks.filter(
    (b) => !b.group || b.group === "None" || !groups.includes(b.group)
  );

  return (
    <>
      <SidebarToolbar>
        <IconButton label="Bookmark active tab" onClick={onOpenAddBookmark}>
          <BookmarkPlus className="size-3.5" />
        </IconButton>
        <IconButton label="New group" onClick={handleCreateGroup}>
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton label="Collapse all" onClick={() => setCollapsed(new Set(groups))}>
          <ListCollapse className="size-3.5" />
        </IconButton>
      </SidebarToolbar>
      <div className="p-1.5 text-xs">
        {bookmarks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No bookmarks added yet.
            <br />
            Click <span className="font-medium text-foreground">Bookmark</span> in a note menu to
            add one.
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const groupItems = bookmarks.filter((b) => b.group === group);
              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <ChevronRight
                      className={`size-3.5 transition-transform ${collapsed.has(group) ? "" : "rotate-90"}`}
                    />
                    <span className="truncate">{group}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {groupItems.length}
                    </span>
                  </button>
                  {collapsed.has(group)
                    ? null
                    : groupItems.map((item) => renderBookmarkRow(item, "pl-7"))}
                </div>
              );
            })}
            {ungroupedBookmarks.map((item) => renderBookmarkRow(item, "pl-2"))}
          </>
        )}
      </div>
    </>
  );
}

function LeftSidebar({
  activeTitle,
  pane,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
  vaultEntries,
  activePath,
  revealPath,
  selectedPath,
  onClearRevealPath,
  onCreateFolder,
  onMovePath,
  onRenamePath,
  onDeletePath,
  onArchivePath,
  onOpenTrash,
  onPreviewPath,
  bookmarks,
  bookmarkGroups,
  onRemoveBookmark,
  onOpenAddBookmark,
  onCreateBookmarkGroup,
  expandedFolders,
  onExpandedFoldersChange,
  onExpandFolder,
  searchVault,
  searchQuery,
  onSearchQueryChange,
  onSelectPath,
}: {
  activeTitle: string;
  pane: LeftPane;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string, name?: string) => void;
  vaultEntries?: FileEntry[];
  activePath?: string;
  revealPath?: string;
  selectedPath?: string;
  onClearRevealPath?: () => void;
  onCreateFolder?: (parent: string, name: string) => void;
  onMovePath?: (sourcePath: string, destinationPath: string) => void;
  onRenamePath?: (path: string, name: string) => void;
  onDeletePath?: (path: string) => void;
  onArchivePath?: (path: string) => void;
  onOpenTrash?: () => void;
  onPreviewPath?: (path: string) => Promise<string | null>;
  bookmarks?: BookmarkItem[];
  bookmarkGroups?: string[];
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateBookmarkGroup?: (name: string) => void;
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onExpandFolder?: (path: string) => void;
  searchVault?: (query: string, offset?: number, matchCase?: boolean) => Promise<SearchResult[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectPath?: (path: string) => void;
}) {
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Left sidebar"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 max-w-full" hidden={pane !== "files"}>
          {vaultEntries ? (
            <VaultExplorer
              entries={vaultEntries}
              documents={documents}
              activePath={activePath}
              revealPath={revealPath}
              onClearRevealPath={onClearRevealPath}
              onOpen={onOpenDocument}
              onCreateNote={(parent, name) => onCreateNote(parent, name)}
              onCreateFolder={(parent, name) => onCreateFolder?.(parent, name)}
              onMove={(source, destination) => onMovePath?.(source, destination)}
              onRename={(path, name) => onRenamePath?.(path, name)}
              onDelete={(path) => onDeletePath?.(path)}
              onArchive={(path) => onArchivePath?.(path)}
              onOpenTrash={() => onOpenTrash?.()}
              onPreview={(path) => onPreviewPath?.(path) ?? Promise.resolve(null)}
              expandedFolders={expandedFolders}
              onExpandedFoldersChange={onExpandedFoldersChange}
              onExpandFolder={onExpandFolder}
              onSelectPath={onSelectPath}
              selectedPath={selectedPath}
            />
          ) : (
            <FileExplorer
              activeTitle={activeTitle}
              documents={documents}
              onOpenDocument={onOpenDocument}
              onOpenPdf={onOpenPdf}
              onCreateNote={onCreateNote}
            />
          )}
        </div>
        <div
          className="symtab-editor-scroll symtab-sidebar-scroll h-full min-h-0 overflow-x-clip overflow-y-auto"
          hidden={pane !== "search"}
        >
          <SearchPane
            searchVault={searchVault}
            query={searchQuery}
            onQueryChange={onSearchQueryChange}
            onOpenDocument={onOpenDocument}
          />
        </div>
        <div
          className="symtab-editor-scroll symtab-sidebar-scroll h-full min-h-0 overflow-x-clip overflow-y-auto"
          hidden={pane !== "bookmarks"}
        >
          <BookmarksPane
            activeTitle={activeTitle}
            activePath={activePath}
            bookmarks={bookmarks}
            groups={bookmarkGroups}
            onOpenDocument={onOpenDocument}
            onRemoveBookmark={onRemoveBookmark}
            onOpenAddBookmark={onOpenAddBookmark}
            onCreateGroup={onCreateBookmarkGroup}
          />
        </div>
      </div>
    </section>
  );
}

function RightContent({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  loadReferences,
  loadFacets,
  onSearchTag,
  onNavigateHeading,
  onOpenReference,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  loadReferences?: (path: string, includeUnlinked?: boolean) => Promise<DocumentReferences>;
  loadFacets?: () => Promise<VaultFacets>;
  onSearchTag?: (tag: string) => void;
  onNavigateHeading?: (heading: string, line: number) => void;
  onOpenReference?: (path: string, line: number) => void;
}) {
  const [filterVisible, setFilterVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const [descending, setDescending] = useState(false);
  const [collapsedResults, setCollapsedResults] = useState(false);
  const [moreContext, setMoreContext] = useState(false);
  const [collapsedMentionGroups, setCollapsedMentionGroups] = useState<Record<string, boolean>>({});
  const [references, setReferences] = useState<DocumentReferences>();
  const [referencePath, setReferencePath] = useState("");
  const [facets, setFacets] = useState<VaultFacets>();
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [unlinkedPath, setUnlinkedPath] = useState("");
  const referenceRequestRef = useRef(0);
  const [facetLoading, setFacetLoading] = useState(false);
  const [facetError, setFacetError] = useState("");
  const activePath = activeDocument?.path;
  const visibleReferences = referencePath === activePath ? references : undefined;
  const loading = pane === "backlinks" || pane === "outgoing" ? referenceLoading : facetLoading;
  const loadError = pane === "backlinks" || pane === "outgoing" ? referenceError : facetError;

  useEffect(() => {
    if (!activePath || !loadReferences || (pane !== "backlinks" && pane !== "outgoing")) return;
    let current = true;
    const timer = window.setTimeout(() => {
      if (!current) return;
      const request = ++referenceRequestRef.current;
      setReferenceLoading(true);
      setReferenceError("");
      void loadReferences(activePath)
        .then((result) => {
          if (current && request === referenceRequestRef.current) {
            setReferences(result);
            setReferencePath(activePath);
          }
        })
        .catch((error) => {
          if (current && request === referenceRequestRef.current)
            setReferenceError(error instanceof Error ? error.message : "Could not load links");
        })
        .finally(() => {
          if (current && request === referenceRequestRef.current) setReferenceLoading(false);
        });
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [activePath, loadReferences, pane]);

  useEffect(() => {
    if (!loadFacets || (pane !== "tags" && pane !== "properties")) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFacetLoading(true);
      setFacetError("");
    });
    void loadFacets()
      .then((result) => {
        if (current) setFacets(result);
      })
      .catch((error) => {
        if (current) setFacetError(error instanceof Error ? error.message : "Could not load index");
      })
      .finally(() => {
        if (current) setFacetLoading(false);
      });
    return () => {
      current = false;
    };
  }, [loadFacets, pane]);
  const filterField = filterVisible ? (
    <div className="bg-sidebar px-2 pb-2">
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          aria-label={`Filter ${pane}`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter..."
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </label>
    </div>
  ) : null;

  if (!activeDocument) {
    return (
      <div className="grid min-h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
        No active file
      </div>
    );
  }

  if (pane === "outline") {
    const headings = activeDocument
      ? [...splitFrontmatter(activeDocument.content).body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
          (match) => ({
            level: match[1].length,
            title: match[2],
            line: splitFrontmatter(activeDocument.content).body.slice(0, match.index).split("\n")
              .length,
          })
        )
      : [];
    const visibleHeadings = headings.filter(({ title }) =>
      title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    );
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
              <IconButton label="Expand all headings" onClick={() => setCollapsedResults(false)}>
                <ChevronsUpDown className="size-3.5" />
              </IconButton>
              <IconButton label="Collapse all headings" onClick={() => setCollapsedResults(true)}>
                <ListCollapse className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="p-2 text-xs">
          {collapsedResults
            ? null
            : visibleHeadings.map((heading, index) => (
                <button
                  key={`${heading.title}-${index}`}
                  type="button"
                  onClick={() => onNavigateHeading?.(heading.title, heading.line)}
                  className="flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left hover:bg-accent/60"
                  style={{ paddingLeft: 8 + (heading.level - 1) * 14 }}
                >
                  <ChevronRight className="size-3.5 rotate-90 text-muted-foreground" />
                  <span className="truncate">{heading.title}</span>
                </button>
              ))}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "backlinks") {
    const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";
    const activeName = activeDocument.title.replace(/\.[^.]+$/, "");
    const mentionHighlightTerms = [...new Set([activeName, activeDocument.title].filter(Boolean))];
    const groupMentions = (mentions: DocumentMention[]) => {
      const grouped = new Map<string, DocumentMention[]>();
      for (const mention of mentions) {
        const matchesFilter = `${mention.source} ${mention.excerpt}`
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase());
        if (!matchesFilter) continue;
        const group = grouped.get(mention.source) ?? [];
        group.push(mention);
        grouped.set(mention.source, group);
      }
      return [...grouped].sort(([left], [right]) =>
        descending ? right.localeCompare(left) : left.localeCompare(right)
      );
    };
    const linkedMentions = visibleReferences
      ? visibleReferences.linked.map((mention) => ({
          ...mention,
          target: activeTitle,
        }))
      : linkedMentionsFor(documents, activeTitle);
    const unlinkedExpanded = unlinkedPath === activePath;
    const unlinkedMentions =
      unlinkedExpanded && visibleReferences
        ? visibleReferences.unlinked.map((mention) => ({
            ...mention,
            target: activeTitle,
          }))
        : [];
    const linked = groupMentions(linkedMentions);
    const unlinked = groupMentions(unlinkedMentions);
    const mentionCount = (groups: Array<[string, DocumentMention[]]>) =>
      groups.reduce((total, [, mentions]) => total + mentions.length, 0);
    const mentionRows = (groups: Array<[string, DocumentMention[]]>, linkedMention: boolean) =>
      groups.map(([source, mentions]) => {
        const groupKey = `${linkedMention ? "linked" : "unlinked"}-${source}`;
        const collapsed = collapsedMentionGroups[groupKey] ?? false;
        const sourceName =
          source
            .split("/")
            .at(-1)
            ?.replace(/\.[^.]+$/, "") ?? source;
        return (
          <div key={groupKey} className="w-full py-1">
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() =>
                setCollapsedMentionGroups((current) => ({
                  ...current,
                  [groupKey]: !collapsed,
                }))
              }
              className="flex w-full items-start gap-1.5 rounded-md px-1 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ChevronRight
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                  !collapsed && "rotate-90"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{sourceName}</span>
                <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                  {source}
                </span>
              </span>
              <span className="pt-0.5 text-[10px] text-muted-foreground">{mentions.length}</span>
            </button>
            {collapsed
              ? null
              : mentions.map((mention) => (
                  <button
                    type="button"
                    key={`${mention.line}-${mention.excerpt}`}
                    onClick={() => onOpenReference?.(source, mention.line)}
                    className="mt-1 block w-full rounded-md px-2 py-2 text-left text-[11px] text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="mb-1 block font-mono text-[9px] opacity-60">
                      Line {mention.line}
                    </span>
                    <span
                      className={cn(
                        "block border-l pl-2 leading-4 [border-color:var(--layout-separator)]",
                        moreContext ? "line-clamp-4" : "line-clamp-2"
                      )}
                    >
                      <HighlightedText
                        text={mention.excerpt}
                        terms={mentionHighlightTerms}
                        matchCase={false}
                      />
                    </span>
                  </button>
                ))}
          </div>
        );
      });
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Collapse results"
                active={collapsedResults}
                onClick={() => setCollapsedResults((current) => !current)}
              >
                <ListCollapse className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show more context"
                active={moreContext}
                onClick={() => setMoreContext((current) => !current)}
              >
                <ChevronsUpDown className="size-3.5" />
              </IconButton>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          {loading ? <p className="py-2 text-muted-foreground">Reading link index…</p> : null}
          {loadError ? <p className="py-2 text-destructive">{loadError}</p> : null}
          <div className="flex items-center justify-between py-1 font-medium text-foreground">
            <span>Linked mentions</span>
            <span className="text-[10px] text-muted-foreground">{mentionCount(linked)}</span>
          </div>
          {collapsedResults ? null : linked.length ? (
            mentionRows(linked, true)
          ) : (
            <p className="py-2 text-muted-foreground">No backlinks found.</p>
          )}
          <button
            type="button"
            aria-expanded={unlinkedExpanded}
            title={unlinkedExpanded ? "Collapse unlinked mentions" : "Load unlinked mentions"}
            onClick={() => {
              if (unlinkedExpanded) {
                referenceRequestRef.current += 1;
                setUnlinkedPath("");
                setReferenceLoading(false);
                return;
              }
              if (!activePath || !loadReferences) return;
              const request = ++referenceRequestRef.current;
              setUnlinkedPath(activePath);
              setReferenceLoading(true);
              setReferenceError("");
              void loadReferences(activePath, true)
                .then((result) => {
                  if (request === referenceRequestRef.current) {
                    setReferences(result);
                    setReferencePath(activePath);
                  }
                })
                .catch((error) => {
                  if (request === referenceRequestRef.current)
                    setReferenceError(
                      error instanceof Error ? error.message : "Could not load unlinked mentions"
                    );
                })
                .finally(() => {
                  if (request === referenceRequestRef.current) setReferenceLoading(false);
                });
            }}
            className="mt-3 flex w-full items-center justify-between rounded-md py-1 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-1">
              <ChevronRight
                className={cn("size-3 transition-transform", unlinkedExpanded && "rotate-90")}
              />
              Unlinked mentions
            </span>
            {unlinkedExpanded ? (
              <span className="text-[10px]">{mentionCount(unlinked)}</span>
            ) : null}
          </button>
          {!unlinkedExpanded || collapsedResults ? null : unlinked.length ? (
            mentionRows(unlinked, false)
          ) : (
            <p className="py-2 text-muted-foreground">No unlinked mentions found.</p>
          )}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "outgoing") {
    const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";
    const outgoing = (
      visibleReferences
        ? visibleReferences.outgoing
        : [...(buildLinkIndex(documents).outgoing.get(activeTitle) ?? new Set<string>())]
    )
      .filter((title) => title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          {loading ? <p className="py-2 text-muted-foreground">Reading link index…</p> : null}
          {loadError ? <p className="py-2 text-destructive">{loadError}</p> : null}
          <div className="flex items-center justify-between py-1 font-medium">
            <span>Links</span>
            <span className="text-[10px] text-muted-foreground">{outgoing.length}</span>
          </div>
          {outgoing.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => onOpenDocument(title)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-left hover:bg-accent/60"
            >
              <Link2 className="size-3.5 text-muted-foreground" />
              {title}
            </button>
          ))}
          {!loading && !outgoing.length ? (
            <p className="py-2 text-muted-foreground">No outgoing links found.</p>
          ) : null}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "tags") {
    const counts = new Map<string, number>();
    for (const document of documents) {
      const value = getFrontmatterProperties(document.content).find(
        ({ key }) => key === "tags"
      )?.value;
      for (const tag of value?.replace(/^\[|\]$/g, "").split(",") ?? []) {
        const normalized = tag.trim();
        if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    const tags = (
      facets?.tags.map(({ name, count }) => [name, count] as [string, number]) ?? [...counts]
    )
      .filter(([tag]) => tag.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort(([a], [b]) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show nested tags"
                active={moreContext}
                onClick={() => setMoreContext((current) => !current)}
              >
                <Network className="size-3.5" />
              </IconButton>
              <IconButton
                label="Collapse all"
                active={collapsedResults}
                onClick={() => setCollapsedResults((current) => !current)}
              >
                <ChevronsUpDown className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          {loading ? <p className="py-2 text-muted-foreground">Reading tag index…</p> : null}
          {loadError ? <p className="py-2 text-destructive">{loadError}</p> : null}
          {collapsedResults
            ? null
            : tags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSearchTag?.(tag)}
                  className="flex w-full justify-between rounded-md px-1 py-1.5 text-left hover:bg-accent/60"
                >
                  <span>{moreContext ? tag.replaceAll("/", " › ") : tag}</span>
                  <span className="text-muted-foreground">{count}</span>
                </button>
              ))}
          {!loading && !tags.length ? (
            <p className="py-2 text-muted-foreground">No tags found.</p>
          ) : null}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "properties") {
    const fallbackCounts = new Map<string, number>();
    for (const document of documents) {
      for (const property of getFrontmatterProperties(document.content)) {
        fallbackCounts.set(property.key, (fallbackCounts.get(property.key) ?? 0) + 1);
      }
    }
    const properties = (
      facets?.properties.map(({ name, count }) => ({ key: name, count })) ??
      [...fallbackCounts].map(([key, count]) => ({ key, count }))
    )
      .filter(({ key }) => key.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort((a, b) => (descending ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          {loading ? <p className="py-2 text-muted-foreground">Reading property index…</p> : null}
          {loadError ? <p className="py-2 text-destructive">{loadError}</p> : null}
          {properties.map((property) => (
            <div
              key={property.key}
              className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50"
            >
              <span className="truncate text-muted-foreground">{property.key}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {property.count}
              </span>
            </div>
          ))}
          {!loading && !properties.length ? (
            <p className="py-2 text-muted-foreground">No properties found.</p>
          ) : null}
        </div>
      </SidebarPane>
    );
  }
  return null;
}

function RightSidebar({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  loadReferences,
  loadFacets,
  onSearchTag,
  onNavigateHeading,
  onOpenReference,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  loadReferences?: (path: string, includeUnlinked?: boolean) => Promise<DocumentReferences>;
  loadFacets?: () => Promise<VaultFacets>;
  onSearchTag?: (tag: string) => void;
  onNavigateHeading?: (heading: string, line: number) => void;
  onOpenReference?: (path: string, line: number) => void;
}) {
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Right sidebar"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <RightContent
          pane={pane}
          activeDocument={activeDocument}
          documents={documents}
          onOpenDocument={onOpenDocument}
          loadReferences={loadReferences}
          loadFacets={loadFacets}
          onSearchTag={onSearchTag}
          onNavigateHeading={onNavigateHeading}
          onOpenReference={onOpenReference}
        />
      </div>
    </section>
  );
}

export function WorkspaceSidebarHeader<T extends LeftPane | RightPane>({
  side,
  active,
  onChange,
  plugins,
}: {
  side: "left" | "right";
  active: T;
  onChange: (id: T) => void;
  plugins?: Record<string, boolean>;
}) {
  const options = side === "left" ? getLeftOptions(plugins) : getRightOptions(plugins);
  return (
    <PaneTabs
      options={options as Array<{ id: T; label: string; icon: typeof Files }>}
      active={active}
      onChange={onChange}
    />
  );
}

export function WorkspaceLeftSidebar({
  activeTitle,
  pane,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
  vaultEntries,
  activePath,
  revealPath,
  selectedPath,
  onClearRevealPath,
  onCreateFolder,
  onMovePath,
  onRenamePath,
  onDeletePath,
  onArchivePath,
  onOpenTrash,
  onPreviewPath,
  bookmarks,
  bookmarkGroups,
  onRemoveBookmark,
  onOpenAddBookmark,
  onCreateBookmarkGroup,
  expandedFolders,
  onExpandedFoldersChange,
  onExpandFolder,
  searchVault,
  searchQuery,
  onSearchQueryChange,
  onSelectPath,
}: {
  activeTitle: string;
  pane: LeftPane;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string, name?: string) => void;
  vaultEntries?: FileEntry[];
  activePath?: string;
  revealPath?: string;
  selectedPath?: string;
  onClearRevealPath?: () => void;
  onCreateFolder?: (parent: string, name: string) => void;
  onMovePath?: (sourcePath: string, destinationPath: string) => void;
  onRenamePath?: (path: string, name: string) => void;
  onDeletePath?: (path: string) => void;
  onArchivePath?: (path: string) => void;
  onOpenTrash?: () => void;
  onPreviewPath?: (path: string) => Promise<string | null>;
  bookmarks?: BookmarkItem[];
  bookmarkGroups?: string[];
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateBookmarkGroup?: (name: string) => void;
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onExpandFolder?: (path: string) => void;
  searchVault?: (query: string, offset?: number, matchCase?: boolean) => Promise<SearchResult[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectPath?: (path: string) => void;
}) {
  return (
    <LeftSidebar
      activeTitle={activeTitle}
      pane={pane}
      documents={documents}
      onOpenDocument={onOpenDocument}
      onOpenPdf={onOpenPdf}
      onCreateNote={onCreateNote}
      vaultEntries={vaultEntries}
      activePath={activePath}
      revealPath={revealPath}
      selectedPath={selectedPath}
      onClearRevealPath={onClearRevealPath}
      onCreateFolder={onCreateFolder}
      onMovePath={onMovePath}
      onRenamePath={onRenamePath}
      onDeletePath={onDeletePath}
      onArchivePath={onArchivePath}
      onOpenTrash={onOpenTrash}
      onPreviewPath={onPreviewPath}
      bookmarks={bookmarks}
      bookmarkGroups={bookmarkGroups}
      onRemoveBookmark={onRemoveBookmark}
      onOpenAddBookmark={onOpenAddBookmark}
      onCreateBookmarkGroup={onCreateBookmarkGroup}
      expandedFolders={expandedFolders}
      onExpandedFoldersChange={onExpandedFoldersChange}
      onExpandFolder={onExpandFolder}
      searchVault={searchVault}
      searchQuery={searchQuery}
      onSearchQueryChange={onSearchQueryChange}
      onSelectPath={onSelectPath}
    />
  );
}

export function WorkspaceRightSidebar({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  loadReferences,
  loadFacets,
  onSearchTag,
  onNavigateHeading,
  onOpenReference,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  loadReferences?: (path: string, includeUnlinked?: boolean) => Promise<DocumentReferences>;
  loadFacets?: () => Promise<VaultFacets>;
  onSearchTag?: (tag: string) => void;
  onNavigateHeading?: (heading: string, line: number) => void;
  onOpenReference?: (path: string, line: number) => void;
}) {
  return (
    <RightSidebar
      pane={pane}
      activeDocument={activeDocument}
      documents={documents}
      onOpenDocument={onOpenDocument}
      loadReferences={loadReferences}
      loadFacets={loadFacets}
      onSearchTag={onSearchTag}
      onNavigateHeading={onNavigateHeading}
      onOpenReference={onOpenReference}
    />
  );
}

export function WorkspaceRibbon({
  onGraph,
  onFiles,
  onPlugins,
  onCanvas,
  onCalendar,
  plugins,
  pluginItems = [],
}: {
  onGraph?: () => void;
  onFiles?: () => void;
  onPlugins?: () => void;
  onCanvas?: () => void;
  onCalendar?: () => void;
  plugins?: Record<string, boolean>;
  pluginItems?: PluginRibbonItem[];
}) {
  const showFiles = !plugins || plugins["file-explorer"] !== false;
  const showGraph = !plugins || plugins["graph-view"] !== false;
  const showCanvas = !plugins || plugins["canvas"] !== false;
  const showDailyNotes = !plugins || plugins["daily-notes"] !== false;

  return (
    <nav aria-label="Workspace tools" className="flex h-full flex-col items-center gap-0.5 py-1.5">
      {showFiles ? (
        <IconButton label="Files" onClick={onFiles}>
          <Files className="size-4" />
        </IconButton>
      ) : null}
      {showGraph ? (
        <IconButton label="Graph view" onClick={onGraph}>
          <Network className="size-4" />
        </IconButton>
      ) : null}
      {showCanvas ? (
        <IconButton label="Canvas" onClick={onCanvas}>
          <Grid2X2 className="size-4" />
        </IconButton>
      ) : null}
      {showDailyNotes ? (
        <IconButton label="Calendar" onClick={onCalendar}>
          <CalendarDays className="size-4" />
        </IconButton>
      ) : null}
      <IconButton label="Plugins" onClick={onPlugins}>
        <Puzzle className="size-4" />
      </IconButton>
      {pluginItems.length ? (
        <div className="my-1 h-px w-5 bg-[var(--layout-separator)]" aria-hidden="true" />
      ) : null}
      {pluginItems.map((item) => {
        const PluginIcon = pluginIcons[item.icon as keyof typeof pluginIcons] ?? Puzzle;
        return (
          <IconButton key={item.id} label={item.label} active={item.active} onClick={item.onClick}>
            {item.iconSrc ? (
              <span
                aria-hidden="true"
                className="size-4 bg-current"
                style={{
                  WebkitMask: `center / contain no-repeat url("${item.iconSrc}")`,
                  mask: `center / contain no-repeat url("${item.iconSrc}")`,
                }}
              />
            ) : (
              <PluginIcon className="size-4" />
            )}
          </IconButton>
        );
      })}
    </nav>
  );
}
