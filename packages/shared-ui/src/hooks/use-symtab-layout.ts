import { useCallback, useEffect, useMemo, useState } from "react";

export type SymtabSidebarSide = "left" | "right";

export interface SymtabSidebarOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsePressure?: number;
  defaultCollapsed?: boolean;
}

export interface SymtabSidebarState {
  width: number;
  collapsed: boolean;
}

export interface SymtabLayoutState {
  left: SymtabSidebarState;
  right: SymtabSidebarState;
}

interface ResolvedSidebarOptions {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsePressure: number;
  defaultCollapsed: boolean;
}

interface UseSymtabLayoutOptions {
  left?: SymtabSidebarOptions;
  right?: SymtabSidebarOptions;
  onStateChange?: (state: SymtabLayoutState) => void;
  initialState?: SymtabLayoutState;
}

const DEFAULT_SIDEBAR: ResolvedSidebarOptions = {
  defaultWidth: 280,
  minWidth: 220,
  maxWidth: 480,
  collapsePressure: 112,
  defaultCollapsed: false,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveOptions(options?: SymtabSidebarOptions): ResolvedSidebarOptions {
  const minWidth = Math.max(120, options?.minWidth ?? DEFAULT_SIDEBAR.minWidth);
  const maxWidth = Math.max(minWidth, options?.maxWidth ?? DEFAULT_SIDEBAR.maxWidth);

  return {
    minWidth,
    maxWidth,
    collapsePressure: Math.max(0, options?.collapsePressure ?? DEFAULT_SIDEBAR.collapsePressure),
    defaultWidth: clamp(options?.defaultWidth ?? DEFAULT_SIDEBAR.defaultWidth, minWidth, maxWidth),
    defaultCollapsed: options?.defaultCollapsed ?? DEFAULT_SIDEBAR.defaultCollapsed,
  };
}

function createInitialState(
  left: ResolvedSidebarOptions,
  right: ResolvedSidebarOptions,
  initialState?: SymtabLayoutState
): SymtabLayoutState {
  const fallback: SymtabLayoutState = {
    left: { width: left.defaultWidth, collapsed: left.defaultCollapsed },
    right: { width: right.defaultWidth, collapsed: right.defaultCollapsed },
  };

  if (initialState) {
    return {
      left: {
        width: clamp(initialState.left.width, left.minWidth, left.maxWidth),
        collapsed: initialState.left.collapsed,
      },
      right: {
        width: clamp(initialState.right.width, right.minWidth, right.maxWidth),
        collapsed: initialState.right.collapsed,
      },
    };
  }
  return fallback;
}

export function useSymtabLayout({
  left: leftOptions,
  right: rightOptions,
  onStateChange,
  initialState,
}: UseSymtabLayoutOptions = {}) {
  const left = useMemo(() => resolveOptions(leftOptions), [leftOptions]);
  const right = useMemo(() => resolveOptions(rightOptions), [rightOptions]);
  const [state, setState] = useState<SymtabLayoutState>(() =>
    createInitialState(left, right, initialState)
  );

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const toggle = useCallback((side: SymtabSidebarSide) => {
    setState((current) => ({
      ...current,
      [side]: { ...current[side], collapsed: !current[side].collapsed },
    }));
  }, []);

  const resize = useCallback(
    (side: SymtabSidebarSide, requestedWidth: number) => {
      const constraints = side === "left" ? left : right;
      setState((current) => {
        if (requestedWidth <= constraints.minWidth - constraints.collapsePressure) {
          return {
            ...current,
            [side]: { ...current[side], collapsed: true },
          };
        }

        return {
          ...current,
          [side]: {
            width: clamp(requestedWidth, constraints.minWidth, constraints.maxWidth),
            collapsed: false,
          },
        };
      });
    },
    [left, right]
  );

  return {
    state,
    constraints: { left, right },
    resize,
    toggle,
  };
}
