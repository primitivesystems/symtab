import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { Button } from "@symtab/shared-ui/components/ui/button";

export type InitializationPhase = "starting" | "vault" | "cache" | "workspace";

const INITIALIZATION_PHASES: Array<{ id: InitializationPhase; label: string }> = [
  { id: "starting", label: "Starting Symtab" },
  { id: "vault", label: "Loading vault" },
  { id: "cache", label: "Loading cache" },
  { id: "workspace", label: "Restoring workspace" },
];

export function InitializationOverlay({
  phase,
  label,
}: {
  phase: InitializationPhase;
  label: string;
}) {
  const phaseIndex = INITIALIZATION_PHASES.findIndex((candidate) => candidate.id === phase);
  return (
    <div className="fixed inset-0 z-[190] grid place-items-center bg-background">
      <div
        role="status"
        aria-live="polite"
        className="flex w-72 flex-col items-center gap-4 text-center"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none"
        />
        <div className="w-full">
          <p className="text-sm font-medium">{INITIALIZATION_PHASES[phaseIndex].label}</p>
          <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{label}</p>
          <div className="mt-4 grid grid-cols-4 gap-1" aria-hidden="true">
            {INITIALIZATION_PHASES.map((candidate, index) => (
              <span
                key={candidate.id}
                className={`h-0.5 rounded-full ${index <= phaseIndex ? "bg-foreground/70" : "bg-muted-foreground/20"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DegradedBanner({ onRebuild }: { onRebuild: () => void }) {
  return (
    <div
      role="status"
      className="mx-2 mt-2 flex shrink-0 items-center gap-3 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground [border-color:var(--layout-separator)]"
    >
      <span className="min-w-0 flex-1 truncate">
        Vault services degraded. Notes remain editable.
      </span>
      <Button size="xs" variant="outline" onClick={onRebuild} className="shrink-0">
        Rebuild index
      </Button>
    </div>
  );
}

export function EditorPathBreadcrumb({
  path,
  onReveal,
  onRename,
  onClearReveal,
}: {
  path: string;
  onReveal: (path: string, file: boolean) => void;
  onRename?: (path: string, name: string) => void;
  onClearReveal?: () => void;
}) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  const fileLabel = fileName.replace(/\.[^./]+$/, "");
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(fileLabel);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);

  useEffect(() => {
    if (isFocused) inputRef.current?.focus();
  }, [isFocused]);

  const commitRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    setIsFocused(false);
    const next = draft.trim();
    if (next && next !== fileLabel) onRename?.(path, next);
    else setDraft(fileLabel);
  };

  return (
    <m.nav
      layout
      aria-label="File path"
      title={path}
      className="mx-auto flex min-w-0 max-w-full items-center justify-center overflow-hidden h-8"
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
    >
      <LayoutGroup id="breadcrumb-nav-group">
        {segments.map((segment, index) => {
          const currentPath = segments.slice(0, index + 1).join("/");
          const file = index === segments.length - 1;
          return (
            <m.span
              layout
              key={currentPath}
              className="flex min-w-0 items-center"
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            >
              {!file ? (
                <AnimatePresence initial={false}>
                  {!isFocused && (
                    <m.span
                      layout
                      initial={{ opacity: 0, width: 0, scale: 0.8 }}
                      animate={{ opacity: 1, width: "auto", scale: 1 }}
                      exit={{ opacity: 0, width: 0, scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 150, damping: 22 }}
                      className="flex items-center min-w-0 overflow-hidden"
                    >
                      {index ? (
                        <span className="select-none text-muted-foreground/35 mx-[3px] font-normal text-xs">
                          /
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Reveal ${segment}`}
                        onClick={() => onReveal(currentPath, false)}
                        className="min-w-0 truncate rounded-sm px-[3px] py-0.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring text-muted-foreground"
                      >
                        {segment}
                      </button>
                    </m.span>
                  )}
                </AnimatePresence>
              ) : (
                <m.span
                  layout
                  className="flex items-center min-w-0"
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                >
                  {index && !isFocused ? (
                    <m.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      className="select-none text-muted-foreground/35 mx-[3px] font-normal text-xs"
                    >
                      /
                    </m.span>
                  ) : null}
                  {isFocused ? (
                    <m.input
                      layout
                      ref={inputRef}
                      type="text"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          cancelRenameRef.current = true;
                          setDraft(fileLabel);
                          setIsFocused(false);
                        }
                      }}
                      className="min-w-24 max-w-64 bg-transparent border-none text-center font-medium text-foreground outline-none focus:outline-none focus:ring-0 px-[3px] py-0.5"
                      style={{ font: "inherit" }}
                    />
                  ) : (
                    <m.button
                      layout
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsFocused(true);
                        onClearReveal?.();
                      }}
                      className="min-w-0 truncate rounded-sm px-[3px] py-0.5 outline-none font-medium text-foreground cursor-pointer"
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    >
                      {fileLabel}
                    </m.button>
                  )}
                </m.span>
              )}
            </m.span>
          );
        })}
      </LayoutGroup>
    </m.nav>
  );
}
