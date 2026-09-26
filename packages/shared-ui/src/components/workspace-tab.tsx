import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Link2,
  PanelBottomOpen,
  PanelRightOpen,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";

export interface SymtabTabCommands {
  pinned?: boolean;
  canCloseOthers?: boolean;
  canCloseAfter?: boolean;
  onClose?: () => void;
  onCloseOthers?: () => void;
  onCloseAfter?: () => void;
  onCloseAll?: () => void;
  onTogglePin?: () => void;
  onMoveToNewWindow?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
}

export interface SymtabTabContextMenuProps extends SymtabTabCommands {
  children: ReactNode;
}

export interface SymtabEditorPaneProps extends SymtabTabCommands {
  title: ReactNode;
  children: ReactNode;
  headerAction?: ReactNode;
  menuContent?: ReactNode;
  menuLabel?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  className?: string;
}

function ContextCommands({
  pinned,
  canCloseOthers,
  canCloseAfter,
  onClose,
  onCloseOthers,
  onCloseAfter,
  onCloseAll,
  onTogglePin,
  onMoveToNewWindow,
  onSplitRight,
  onSplitDown,
}: SymtabTabCommands) {
  return (
    <>
      <ContextMenuItem disabled={!onClose} onClick={onClose}>
        <X className="size-4 text-muted-foreground" />
        Close
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onCloseOthers || !canCloseOthers}
        onClick={onCloseOthers}
      >
        Close others
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onCloseAfter || !canCloseAfter}
        onClick={onCloseAfter}
      >
        Close tabs after
      </ContextMenuItem>
      <ContextMenuItem disabled={!onCloseAll} onClick={onCloseAll}>
        Close all
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!onTogglePin}
        onClick={onTogglePin}
      >
        {pinned ? (
          <PinOff className="size-4 text-muted-foreground" />
        ) : (
          <Pin className="size-4 text-muted-foreground" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </ContextMenuItem>
      <ContextMenuItem disabled>
        <Link2 className="size-4" />
        Link with tab…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!onMoveToNewWindow}
        onClick={onMoveToNewWindow}
      >
        <ExternalLink className="size-4" />
        Move to new window
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onSplitRight}
        onClick={onSplitRight}
      >
        <PanelRightOpen className="size-4" />
        Split right
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onSplitDown}
        onClick={onSplitDown}
      >
        <PanelBottomOpen className="size-4" />
        Split down
      </ContextMenuItem>
    </>
  );
}

function DropdownCommands({
  pinned,
  canCloseOthers,
  canCloseAfter,
  onClose,
  onCloseOthers,
  onCloseAfter,
  onCloseAll,
  onTogglePin,
  onMoveToNewWindow,
  onSplitRight,
  onSplitDown,
}: SymtabTabCommands) {
  return (
    <>
      <MenuItem disabled={!onClose} onClick={onClose}>
        <X className="size-4 text-muted-foreground" />
        Close
      </MenuItem>
      <MenuItem
        disabled={!onCloseOthers || !canCloseOthers}
        onClick={onCloseOthers}
      >
        Close others
      </MenuItem>
      <MenuItem
        disabled={!onCloseAfter || !canCloseAfter}
        onClick={onCloseAfter}
      >
        Close tabs after
      </MenuItem>
      <MenuItem disabled={!onCloseAll} onClick={onCloseAll}>
        Close all
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        disabled={!onTogglePin}
        onClick={onTogglePin}
      >
        {pinned ? (
          <PinOff className="size-4 text-muted-foreground" />
        ) : (
          <Pin className="size-4 text-muted-foreground" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem
        disabled={!onMoveToNewWindow}
        onClick={onMoveToNewWindow}
      >
        <ExternalLink className="size-4" />
        Move to new window
      </MenuItem>
      <MenuItem
        disabled={!onSplitRight}
        onClick={onSplitRight}
      >
        <PanelRightOpen className="size-4" />
        Split right
      </MenuItem>
      <MenuItem
        disabled={!onSplitDown}
        onClick={onSplitDown}
      >
        <PanelBottomOpen className="size-4" />
        Split down
      </MenuItem>
    </>
  );
}

export function SymtabTabContextMenu({ children, ...commands }: SymtabTabContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="contents" />}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="z-[110] min-w-52">
        <ContextCommands {...commands} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SymtabEditorPane({
  title,
  children,
  headerAction,
  menuContent,
  menuLabel = "Editor options",
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  className,
  ...commands
}: SymtabEditorPaneProps) {
  return (
    <section
      className={cn(
        "symtab-editor-pane flex h-full min-h-0 min-w-0 flex-col bg-sidebar",
        className
      )}
    >
      <header className="symtab-editor-pane-header relative flex h-9 shrink-0 items-center border-b px-2 text-muted-foreground [border-color:var(--layout-separator)]">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Navigate back"
            disabled={!canGoBack}
            onClick={onGoBack}
            className="grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Navigate forward"
            disabled={!canGoForward}
            onClick={onGoForward}
            className="grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <h1 className="absolute inset-x-20 truncate text-center text-xs font-medium text-foreground">
          {title}
        </h1>

        {headerAction ? <div className="ml-auto flex items-center">{headerAction}</div> : null}

        <Menu>
          <MenuTrigger
            render={<button
              type="button"
              aria-label={menuLabel}
              className={cn(
                "grid size-7 place-items-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-popup-open:bg-accent data-popup-open:text-foreground",
                !headerAction && "ml-auto"
              )}
            />}
          >
            <Ellipsis className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" sideOffset={5} className="z-[110] min-w-52">
            {menuContent ?? <DropdownCommands {...commands} />}
          </MenuPopup>
        </Menu>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
