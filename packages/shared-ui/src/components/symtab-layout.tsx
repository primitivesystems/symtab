import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import {
  useSymtabLayout,
  type SymtabLayoutState,
  type SymtabSidebarOptions,
  type SymtabSidebarSide,
} from "../hooks/use-symtab-layout";
import { cn } from "../lib/utils";
import { SymtabTab, SymtabTabBar } from "./symtab-tabs";

export interface SymtabLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  main: ReactNode;
  stickySidebar?: ReactNode;
  leftSidebar?: ReactNode;
  rightSidebar?: ReactNode;
  title?: ReactNode;
  tabs?: ReactNode;
  tabInlineAction?: ReactNode;
  tabActions?: ReactNode;
  titlebarLeading?: ReactNode;
  titlebarTrailing?: ReactNode;
  leftSidebarHeader?: ReactNode;
  rightSidebarHeader?: ReactNode;
  footer?: ReactNode;
  stickySidebarWidth?: number;
  windowControlsInset?: number;
  leftSidebarOptions?: SymtabSidebarOptions;
  rightSidebarOptions?: SymtabSidebarOptions;
  onLayoutChange?: (state: SymtabLayoutState) => void;
  layoutState?: SymtabLayoutState;
  mainExtendsIntoTitlebar?: boolean;
}

const LAYOUT_TRANSITION = {
  type: "tween" as const,
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

interface ResizeHandleProps {
  side: SymtabSidebarSide;
  panelId: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsePressure: number;
  onResize: (side: SymtabSidebarSide, width: number) => void;
  onDragChange: (side: SymtabSidebarSide | null) => void;
}

function ResizeHandle({
  side,
  panelId,
  width,
  minWidth,
  maxWidth,
  collapsePressure,
  onResize,
  onDragChange,
}: ResizeHandleProps) {
  const dragStart = useRef<{ pointerX: number; width: number } | null>(null);

  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = side === "left" ? 1 : -1;
    const delta = event.shiftKey ? 40 : 12;
    let nextWidth: number | undefined;

    if (event.key === "ArrowLeft") nextWidth = width - delta * direction;
    if (event.key === "ArrowRight") nextWidth = width + delta * direction;
    if (event.key === "Home") nextWidth = minWidth - collapsePressure - 1;
    if (event.key === "End") nextWidth = maxWidth;
    if (nextWidth === undefined) return;

    event.preventDefault();
    onResize(side, nextWidth);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = { pointerX: event.clientX, width };
    onDragChange(side);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - dragStart.current.pointerX;
    const requestedWidth = dragStart.current.width + (side === "left" ? delta : -delta);
    if (requestedWidth <= minWidth - collapsePressure) onDragChange(null);
    onResize(side, requestedWidth);
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    onDragChange(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-controls={panelId}
      aria-label={`Resize ${side} sidebar`}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      className={cn(
        "relative z-40 -ml-1 h-full w-2 touch-none outline-none focus-visible:bg-foreground/10",
        side === "left" ? "col-start-3" : "col-start-5"
      )}
      onKeyDown={resizeByKey}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
    </div>
  );
}

function SidebarToggle({
  side,
  collapsed,
  controls,
  onToggle,
}: {
  side: SymtabSidebarSide;
  collapsed: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const label = `${collapsed ? "Open" : "Close"} ${side} sidebar`;
  const panelX = side === "left" ? 3 : 13;
  const dividerX = side === "left" ? 8 : 12;

  return (
    <button
      type="button"
      className="symtab-window-no-drag grid size-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={label}
      aria-controls={controls}
      aria-expanded={!collapsed}
      title={label}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="size-[18px] overflow-visible"
        fill="none"
      >
        <rect x="2.5" y="3" width="15" height="14" rx="2.25" stroke="currentColor" />
        <rect
          x={panelX}
          y="3.5"
          width="4.5"
          height="13"
          rx="1.5"
          fill="currentColor"
          opacity="0.15"
        />
        <path
          d={`M${dividerX} 3.5v13`}
          stroke="currentColor"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </button>
  );
}

export function SymtabLayout({
  main,
  stickySidebar,
  leftSidebar,
  rightSidebar,
  title,
  tabs,
  tabInlineAction,
  tabActions,
  titlebarLeading,
  titlebarTrailing,
  leftSidebarHeader,
  rightSidebarHeader,
  footer,
  stickySidebarWidth = 48,
  windowControlsInset = 72,
  leftSidebarOptions,
  rightSidebarOptions,
  onLayoutChange,
  layoutState,
  mainExtendsIntoTitlebar = false,
  className,
  style,
  ...props
}: SymtabLayoutProps) {
  const leftId = useId();
  const rightId = useId();
  const [windowActive, setWindowActive] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus()
  );
  const [resizingSide, setResizingSide] = useState<SymtabSidebarSide | null>(null);
  const reduceMotion = useReducedMotion();
  const { state, constraints, resize, toggle } = useSymtabLayout({
    left: leftSidebarOptions,
    right: rightSidebarOptions,
    onStateChange: onLayoutChange,
    initialState: layoutState,
  });

  useEffect(() => {
    const markActive = () => setWindowActive(true);
    const markInactive = () => setWindowActive(false);

    window.addEventListener("focus", markActive);
    window.addEventListener("blur", markInactive);

    return () => {
      window.removeEventListener("focus", markActive);
      window.removeEventListener("blur", markInactive);
    };
  }, []);

  const hasLeftSidebar = leftSidebar != null;
  const hasRightSidebar = rightSidebar != null;
  const leftVisible = hasLeftSidebar && !state.left.collapsed;
  const rightVisible = hasRightSidebar && !state.right.collapsed;
  const railWidth = stickySidebar ? stickySidebarWidth : 0;
  const leftFootprint = railWidth + (leftVisible ? state.left.width : 0);
  const rightFootprint = rightVisible ? state.right.width : 0;
  const tabRailLeft = Math.max(leftFootprint, windowControlsInset + 44);
  const rightChromeWidth = Math.max(rightFootprint, hasRightSidebar ? 44 : 0);
  const collapsedLeftToggleX = windowControlsInset
    ? windowControlsInset + 4
    : Math.max(0, (railWidth - 32) / 2);
  const leftToggleX = leftVisible
    ? Math.max(windowControlsInset + 4, leftFootprint - 36)
    : collapsedLeftToggleX;
  // Splitter keeps zero layout width; handle overflows around its hairline.
  const chromeColor = windowActive ? "var(--window-chrome-active)" : "var(--sidebar)";
  const contentColumns = [
    `${railWidth}px`,
    leftVisible ? `${state.left.width}px` : "0px",
    "0px",
    "minmax(0, 1fr)",
    "0px",
    rightVisible ? `${state.right.width}px` : "0px",
  ].join(" ");
  const layoutTransition = resizingSide || reduceMotion ? { duration: 0 } : LAYOUT_TRANSITION;
  const titlebarStyle = {
    "--symtab-titlebar-left-inset": `${
      mainExtendsIntoTitlebar && !leftVisible ? tabRailLeft - leftFootprint - 8 : 0
    }px`,
    "--symtab-titlebar-right-inset": `${
      mainExtendsIntoTitlebar && !rightVisible ? rightChromeWidth - 8 : 0
    }px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={cn(
        "symtab-layout-root group/layout relative grid h-svh min-h-0 w-full grid-rows-[44px_minmax(0,1fr)_28px] overflow-hidden bg-[var(--window-well)] text-foreground",
        resizingSide && "cursor-col-resize select-none [&_iframe]:pointer-events-none",
        className
      )}
      data-window-active={windowActive}
      style={titlebarStyle}
      {...props}
    >
      <header
        className="symtab-window-drag relative min-w-0 text-sidebar-foreground"
        style={{ backgroundColor: chromeColor }}
      >
        <div className="absolute inset-y-0 left-0 z-20 flex min-w-0 items-center pl-1">
          <div
            className="shrink-0"
            style={{ width: Math.max(0, Math.max(windowControlsInset, railWidth) - 4) }}
            aria-hidden="true"
          />
          <m.div
            className={cn(
              "symtab-window-no-drag flex min-w-0 items-center gap-0.5",
              !leftVisible && "pointer-events-none"
            )}
            aria-hidden={!leftVisible}
            inert={!leftVisible}
            initial={false}
            animate={{ opacity: leftVisible ? 1 : 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.14 }}
          >
            {leftSidebarHeader}
          </m.div>
          <m.div
            className={cn("symtab-window-no-drag min-w-0", !leftVisible && "pointer-events-none")}
            initial={false}
            animate={{ opacity: leftVisible ? 1 : 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.14 }}
          >
            {titlebarLeading}
          </m.div>
        </div>

        {hasLeftSidebar ? (
          <m.div
            className="absolute inset-y-0 z-30 flex items-center"
            initial={false}
            animate={{ left: leftToggleX }}
            transition={layoutTransition}
          >
            <SidebarToggle
              side="left"
              collapsed={!leftVisible}
              controls={leftId}
              onToggle={() => toggle("left")}
            />
          </m.div>
        ) : null}

        {!mainExtendsIntoTitlebar ? (
          <m.div
            className="absolute inset-y-0 z-10 overflow-visible"
            initial={false}
            animate={{ left: tabRailLeft, right: rightChromeWidth }}
            transition={layoutTransition}
            style={{ backgroundColor: chromeColor }}
          >
            <SymtabTabBar inlineAction={tabInlineAction} actions={tabActions}>
              {tabs ?? (title ? <SymtabTab active>{title}</SymtabTab> : null)}
            </SymtabTabBar>
          </m.div>
        ) : null}

        <m.div
          className="absolute inset-y-0 right-0 z-20 min-w-0"
          initial={false}
          animate={{ width: rightChromeWidth }}
          transition={layoutTransition}
          style={{ backgroundColor: chromeColor }}
        >
          <div className="absolute inset-y-0 left-2 flex min-w-0 items-center gap-1">
            <div
              className={cn(
                "symtab-window-no-drag flex min-w-0 items-center gap-0.5",
                !rightVisible && "pointer-events-none"
              )}
              aria-hidden={!rightVisible}
              inert={!rightVisible}
              style={{ opacity: rightVisible ? 1 : 0 }}
            >
              {rightSidebarHeader}
            </div>
            {rightVisible ? (
              <div className="symtab-window-no-drag min-w-0">{titlebarTrailing}</div>
            ) : null}
          </div>
          {hasRightSidebar ? (
            <div className="absolute inset-y-0 right-1 flex items-center">
              <SidebarToggle
                side="right"
                collapsed={!rightVisible}
                controls={rightId}
                onToggle={() => toggle("right")}
              />
            </div>
          ) : null}
        </m.div>

        {leftVisible ? (
          <m.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-30 w-px -translate-x-1/2 bg-[var(--layout-separator)]"
            initial={false}
            animate={{ left: leftFootprint, opacity: windowActive ? 0 : 1 }}
            transition={layoutTransition}
          />
        ) : null}

        {rightVisible ? (
          <m.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-30 w-px translate-x-1/2 bg-[var(--layout-separator)]"
            initial={false}
            animate={{ right: rightFootprint, opacity: windowActive ? 0 : 1 }}
            transition={layoutTransition}
          />
        ) : null}
      </header>

      <m.div
        className="relative grid min-h-0 min-w-0"
        initial={false}
        animate={{ gridTemplateColumns: contentColumns }}
        transition={layoutTransition}
      >
        {!windowActive ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--layout-separator)]"
          />
        ) : null}
        <aside className="col-start-1 min-h-0 overflow-hidden bg-transparent text-sidebar-foreground">
          {stickySidebar}
        </aside>

        <m.aside
          id={leftId}
          data-state={leftVisible ? "expanded" : "collapsed"}
          inert={!leftVisible}
          aria-hidden={!leftVisible}
          className={cn(
            "symtab-surface col-start-2 m-1 min-h-0 overflow-hidden rounded-lg bg-sidebar text-sidebar-foreground",
            !windowActive &&
              "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-[var(--layout-separator)]",
            !leftVisible && "pointer-events-none"
          )}
          initial={false}
          animate={{ x: leftVisible ? 0 : -8, opacity: leftVisible ? 1 : 0 }}
          transition={layoutTransition}
        >
          {leftSidebar}
        </m.aside>
        {leftVisible ? (
          <ResizeHandle
            side="left"
            panelId={leftId}
            width={state.left.width}
            minWidth={constraints.left.minWidth}
            maxWidth={constraints.left.maxWidth}
            collapsePressure={constraints.left.collapsePressure}
            onResize={resize}
            onDragChange={setResizingSide}
          />
        ) : (
          <div className="col-start-3" />
        )}

        <main className="symtab-surface col-start-4 m-1 min-h-0 min-w-0 overflow-auto rounded-lg bg-background">
          {mainExtendsIntoTitlebar ? null : main}
        </main>

        {rightVisible ? (
          <ResizeHandle
            side="right"
            panelId={rightId}
            width={state.right.width}
            minWidth={constraints.right.minWidth}
            maxWidth={constraints.right.maxWidth}
            collapsePressure={constraints.right.collapsePressure}
            onResize={resize}
            onDragChange={setResizingSide}
          />
        ) : (
          <div className="col-start-5" />
        )}
        <m.aside
          id={rightId}
          data-state={rightVisible ? "expanded" : "collapsed"}
          inert={!rightVisible}
          aria-hidden={!rightVisible}
          className={cn(
            "symtab-surface col-start-6 m-1 min-h-0 overflow-hidden rounded-lg bg-sidebar text-sidebar-foreground",
            !windowActive &&
              "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-[var(--layout-separator)]",
            !rightVisible && "pointer-events-none"
          )}
          initial={false}
          animate={{ x: rightVisible ? 0 : 8, opacity: rightVisible ? 1 : 0 }}
          transition={layoutTransition}
        >
          {rightSidebar}
        </m.aside>
      </m.div>

      {mainExtendsIntoTitlebar ? (
        <m.main
          className="absolute bottom-7 top-0 z-10 min-h-0 min-w-0 overflow-hidden bg-transparent"
          initial={false}
          animate={{ left: leftFootprint, right: rightFootprint }}
          transition={layoutTransition}
        >
          {main}
        </m.main>
      ) : null}

      <footer
        className="relative z-30 min-w-0 px-2 text-xs text-muted-foreground"
        style={{ backgroundColor: chromeColor }}
      >
        {footer}
      </footer>
    </div>
  );
}
