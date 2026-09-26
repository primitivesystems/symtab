import { CheckIcon, LoaderCircleIcon, MoonIcon, RefreshCwIcon, SunIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../ui/dialog";
import type { WorkbenchTheme, WorkbenchUpdate } from "../types";

type SettingsPage = "appearance" | "updates";

const pages = [
  { id: "appearance", label: "Appearance" },
  { id: "updates", label: "Updates" },
] as const;

export function WorkbenchSettingsDialog({
  open,
  theme,
  update,
  checking,
  canCheckForUpdates,
  onOpenChange,
  onThemeChange,
  onCheckForUpdates,
}: {
  open: boolean;
  theme: WorkbenchTheme;
  update?: WorkbenchUpdate;
  checking: boolean;
  canCheckForUpdates: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onCheckForUpdates: () => void;
}) {
  const [page, setPage] = useState<SettingsPage>("appearance");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(560px,calc(100vh-2rem))] w-[min(760px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none"
      >
        <aside className="flex w-48 shrink-0 flex-col bg-sidebar p-3 text-sidebar-foreground">
          <div className="px-2 pb-4 pt-1">
            <DialogTitle className="text-sm font-semibold">Settings</DialogTitle>
            <DialogDescription className="mt-1 text-xs">Personalize Symtab.</DialogDescription>
          </div>
          <nav aria-label="Settings" className="space-y-1">
            {pages.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(id)}
                className={cn(
                  "flex h-8 w-full items-center rounded-md px-2 text-left text-sm transition-[background-color,color] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                  page === id
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <p className="mt-auto px-2 text-[11px] text-muted-foreground">
            Symtab {update?.currentVersion ?? ""}
          </p>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-8 pb-10 pt-7">
          <DialogClose
            aria-label="Close settings"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-100 hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </DialogClose>

          {page === "appearance" ? (
            <section aria-labelledby="appearance-settings" className="max-w-xl">
              <header className="mb-8 pe-10">
                <h2 id="appearance-settings" className="text-xl font-semibold tracking-tight">
                  Appearance
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose how Symtab looks on this device.
                </p>
              </header>

              <div>
                <h3 className="text-sm font-medium">Color scheme</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Applied immediately across every workspace.
                </p>
                <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
                  <ThemeChoice
                    label="Light"
                    selected={theme === "light"}
                    icon={<SunIcon className="size-4" aria-hidden="true" />}
                    preview="light"
                    onClick={() => onThemeChange("light")}
                  />
                  <ThemeChoice
                    label="Dark"
                    selected={theme === "dark"}
                    icon={<MoonIcon className="size-4" aria-hidden="true" />}
                    preview="dark"
                    onClick={() => onThemeChange("dark")}
                  />
                </div>
              </div>
            </section>
          ) : (
            <section aria-labelledby="update-settings" className="max-w-xl">
              <header className="mb-8 pe-10">
                <h2 id="update-settings" className="text-xl font-semibold tracking-tight">
                  Updates
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep Symtab current and secure.
                </p>
              </header>

              <div className="flex items-center justify-between gap-6 rounded-lg bg-muted/50 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Symtab desktop</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {update?.currentVersion
                      ? `Version ${update.currentVersion} is installed.`
                      : "Version information is unavailable."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canCheckForUpdates || checking}
                  onClick={onCheckForUpdates}
                >
                  {checking ? (
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <RefreshCwIcon />
                  )}
                  {checking ? "Checking…" : "Check for updates"}
                </Button>
              </div>
            </section>
          )}
        </main>
      </DialogContent>
    </Dialog>
  );
}

function ThemeChoice({
  label,
  selected,
  icon,
  preview,
  onClick,
}: {
  label: string;
  selected: boolean;
  icon: ReactNode;
  preview: WorkbenchTheme;
  onClick: () => void;
}) {
  const dark = preview === "dark";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "group relative rounded-lg p-2 text-left ring-1 transition-[background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100",
        selected
          ? "bg-accent ring-foreground/30"
          : "bg-background ring-border hover:bg-muted/60 hover:ring-foreground/20"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-20 overflow-hidden rounded-[5px] ring-1 ring-black/10 dark:ring-white/10",
          dark ? "bg-[#181818]" : "bg-white"
        )}
      >
        <span className={cn("block h-3 border-b", dark ? "border-white/10" : "border-black/10")} />
        <span className="flex h-full">
          <span className={cn("w-1/3", dark ? "bg-[#202020]" : "bg-[#f5f5f5]")} />
          <span className="flex-1 p-2">
            <span
              className={cn("block h-1.5 w-2/3 rounded-full", dark ? "bg-white/35" : "bg-black/25")}
            />
            <span
              className={cn(
                "mt-2 block h-1 w-full rounded-full",
                dark ? "bg-white/15" : "bg-black/10"
              )}
            />
            <span
              className={cn(
                "mt-1 block h-1 w-4/5 rounded-full",
                dark ? "bg-white/15" : "bg-black/10"
              )}
            />
          </span>
        </span>
      </span>
      <span className="mt-2 flex items-center gap-2 px-0.5 text-sm font-medium">
        {icon}
        {label}
        {selected ? <CheckIcon className="ms-auto size-4" aria-hidden="true" /> : null}
      </span>
    </button>
  );
}
