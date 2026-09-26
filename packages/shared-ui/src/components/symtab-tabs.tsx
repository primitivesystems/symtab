import type {
  ButtonHTMLAttributes,
  DragEventHandler,
  HTMLAttributes,
  KeyboardEvent,
  MouseEventHandler,
  ReactNode,
} from "react";
import { Check, ChevronDown, FileText, Pin, Plus, X } from "lucide-react";
import type { HTMLMotionProps } from "motion/react";
import * as m from "motion/react-m";

import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

export interface SymtabTabProps extends Omit<HTMLMotionProps<"div">, "title"> {
  active?: boolean;
  closeable?: boolean;
  pinned?: boolean;
  tooltip?: ReactNode;
  onClose?: MouseEventHandler<HTMLButtonElement>;
  onNativeDragStart?: DragEventHandler<HTMLDivElement>;
  onNativeDragEnd?: DragEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export type SymtabTabAddButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export interface SymtabTabBarProps extends HTMLAttributes<HTMLDivElement> {
  inlineAction?: ReactNode;
  actions?: ReactNode;
}

export interface SymtabTabMenuEntry {
  id: string | number;
  label: string;
  active?: boolean;
}

export interface SymtabTabMenuProps {
  tabs: SymtabTabMenuEntry[];
  stacked: boolean;
  onStackedChange: (stacked: boolean) => void;
  onCloseAll: () => void;
  onSelect: (id: string | number) => void;
}

export type SymtabStackedTabProps = SymtabTabProps;

const TAB_LAYOUT_SPRING = {
  type: "spring" as const,
  visualDuration: 0.2,
  bounce: 0,
};

export function SymtabTab({
  active = false,
  closeable = false,
  pinned = false,
  tooltip,
  onClose,
  onNativeDragStart,
  onNativeDragEnd,
  children,
  className,
  onKeyDown,
  ...props
}: SymtabTabProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const tablist = event.currentTarget.closest('[role="tablist"]');
    const tabs = Array.from(tablist?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabs.length < 2) return;

    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <m.div
          role="tab"
          tabIndex={active ? 0 : -1}
          aria-selected={active}
          data-active={active}
          data-pinned={pinned}
          className={cn(
            "symtab-tab symtab-window-no-drag group/tab relative flex h-9 w-52 min-w-2 shrink items-center px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
            active
              ? "z-10 min-w-12 max-w-52 text-foreground"
              : "max-w-52 text-muted-foreground hover:text-foreground",
            className
          )}
          {...props}
          onDragStartCapture={onNativeDragStart}
          onDragEndCapture={onNativeDragEnd}
          onKeyDown={handleKeyDown}
          layout="position"
          initial={{
            opacity: 0,
            scale: 0.985,
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            flexBasis: 0,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            width: "13rem",
            minWidth: active ? "3rem" : "0.5rem",
            maxWidth: "13rem",
            flexBasis: "13rem",
          }}
          exit={{
            opacity: 0,
            scale: 0.985,
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            flexBasis: 0,
            paddingLeft: 0,
            paddingRight: 0,
          }}
          transition={{
            duration: 0.18,
            ease: [0.4, 0, 0.2, 1],
            layout: TAB_LAYOUT_SPRING,
            scale: TAB_LAYOUT_SPRING,
            opacity: { duration: 0.11 },
          }}
        >
          <div
            className={cn(
              "symtab-tab-content relative flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2",
              !active && "group-hover/tab:bg-[var(--tab-hover)]",
              active &&
                "mx-0.5 bg-[var(--tab-active)] font-medium ring-1 ring-[var(--surface-ring)]",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left leading-4">
              {children}
            </span>
            {pinned ? (
              <span
                className="grid size-5 shrink-0 place-items-center text-muted-foreground"
                aria-label="Pinned tab"
              >
                <Pin className="size-3 fill-current opacity-75" />
              </span>
            ) : closeable ? (
              <button
                type="button"
                aria-label={`Close ${typeof children === "string" ? children : "tab"}`}
                className={cn(
                  "grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/50",
                  active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"
                )}
                onClick={onClose}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
          {!active ? (
            <span
              aria-hidden="true"
              className="symtab-tab-separator pointer-events-none absolute top-1/2 -right-0.5 h-4 w-px -translate-y-1/2 bg-[var(--layout-separator)]"
            />
          ) : null}
          </m.div>
        }
      />
      <TooltipContent side="bottom" sideOffset={8} className="max-w-72">
        {tooltip ?? children}
      </TooltipContent>
    </Tooltip>
  );
}

export function SymtabStackedTab({
  active = false,
  closeable = false,
  pinned = false,
  onClose,
  onNativeDragStart,
  onNativeDragEnd,
  children,
  className,
  ...props
}: SymtabStackedTabProps) {
  return (
    <m.div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      data-pinned={pinned}
      className={cn(
        "symtab-window-no-drag group/stacked-tab relative flex h-full w-8 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1 text-xs text-muted-foreground outline-none [border-color:var(--layout-separator)] focus-visible:bg-accent/50",
        active && "bg-[var(--tab-active)] text-foreground",
        className
      )}
      {...props}
      onDragStartCapture={onNativeDragStart}
      onDragEndCapture={onNativeDragEnd}
      layout="position"
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: 32 }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1], layout: TAB_LAYOUT_SPRING }}
    >
      {closeable ? (
        <button
          type="button"
          aria-label={`Close ${typeof children === "string" ? children : "tab"}`}
          className="grid size-5 shrink-0 place-items-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      ) : null}
      {pinned ? <Pin className="size-3 shrink-0 fill-current opacity-75" /> : null}
      <FileText className="size-3 shrink-0 opacity-60" />
      <span className="min-h-0 flex-1 truncate py-1 [writing-mode:vertical-rl]">{children}</span>
    </m.div>
  );
}

export function SymtabTabBar({
  children,
  inlineAction,
  actions,
  className,
  ...props
}: SymtabTabBarProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "symtab-window-drag flex h-full min-w-0 items-center overflow-hidden px-2 [&:has(.symtab-tab-strip:empty)>.symtab-tab-inline-action]:ml-0",
        className
      )}
      {...props}
    >
      <div className="symtab-tab-strip flex h-full w-max min-w-0 max-w-full shrink items-center overflow-visible">
        {children}
      </div>
      {inlineAction ? (
        <div className="symtab-tab-inline-action ml-1 flex shrink-0 items-center">{inlineAction}</div>
      ) : null}
      <div className="min-w-0 flex-1" />
      {actions ? <div className="ml-1 flex shrink-0 items-center">{actions}</div> : null}
    </div>
  );
}

export function SymtabTabAddButton({
  className,
  "aria-label": ariaLabel = "New tab",
  ...props
}: SymtabTabAddButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "symtab-window-no-drag grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70",
        className
      )}
      {...props}
    >
      <Plus className="size-4" />
    </button>
  );
}

export function SymtabTabMenu({
  tabs,
  stacked,
  onStackedChange,
  onCloseAll,
  onSelect,
}: SymtabTabMenuProps) {
  return (
    <Menu>
      <MenuTrigger
        render={<button
          type="button"
          aria-label="Tab options"
          title="Tab options"
          className="symtab-window-no-drag grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 data-popup-open:bg-accent/60 data-popup-open:text-foreground"
        />}
      >
        <ChevronDown className="size-4" />
      </MenuTrigger>
      <MenuPopup
          align="end"
          sideOffset={6}
          className="z-[100] max-h-[min(420px,var(--available-height))] min-w-56"
        >
          <MenuCheckboxItem
            checked={stacked}
            onCheckedChange={(checked) => onStackedChange(checked === true)}
          >
            Stack tabs
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem
            disabled={tabs.length === 0}
            onClick={onCloseAll}
            variant="destructive"
          >
            <X className="size-4" />
            Close all
          </MenuItem>
          <MenuSeparator />
          {tabs.map((tab) => (
            <MenuItem
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className="relative max-w-72 pr-8"
            >
              <span className="truncate">{tab.label}</span>
              {tab.active ? <Check className="absolute right-2 size-4" /> : null}
            </MenuItem>
          ))}
      </MenuPopup>
    </Menu>
  );
}
