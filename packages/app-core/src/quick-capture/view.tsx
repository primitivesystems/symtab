import { useEffect, useRef, useState } from "react";
import type { RecentVault } from "@flux/bridge-contract";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Input } from "@flux/shared-ui/components/ui/input";
import { Textarea } from "@flux/shared-ui/components/ui/textarea";
import { ThemeProvider, type Theme } from "@flux/shared-ui/components/theme-provider";
import { errorMessage } from "../app/helpers";
import {
  dateKeyInTimeZone,
  loadDailyNoteConfig,
  noteFileName,
  noteTemplate,
} from "../daily-notes/config";
import { quickCaptureInboxPath } from "./path";
import type { FluxRuntime } from "../App";

export function QuickCapture({ runtime }: { runtime: FluxRuntime }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [vaults, setVaults] = useState<RecentVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [target, setTarget] = useState<"inbox" | "daily">("inbox");
  const [fileName, setFileName] = useState("Quick note.md");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const vaultSelectRef = useRef<HTMLSelectElement>(null);
  const fileNameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = "Quick Capture";
    void runtime
      .connect()
      .then(async () => {
        if (!runtime.client) return;
        const [recent, settings] = await Promise.all([
          runtime.client.listRecentVaults(),
          runtime.client.getAppSettings(),
        ]);
        const savedTheme = settings["workbench.theme"] ?? settings.theme;
        if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system") {
          setTheme(savedTheme);
        }
        setVaults(recent);
        const configured = String(settings.quickCaptureVaultId ?? "");
        const draft =
          settings.quickCaptureDraft && typeof settings.quickCaptureDraft === "object"
            ? (settings.quickCaptureDraft as Record<string, unknown>)
            : undefined;
        const draftVaultId = typeof draft?.vaultId === "string" ? draft.vaultId : "";
        setVaultId(
          recent.some((item) => item.vaultId === draftVaultId)
            ? draftVaultId
            : recent.some((item) => item.vaultId === configured)
              ? configured
              : (recent[0]?.vaultId ?? "")
        );
        if (typeof draft?.content === "string") setContent(draft.content);
        if (typeof draft?.fileName === "string") setFileName(draft.fileName);
        if (draft?.target === "inbox" || draft?.target === "daily") setTarget(draft.target);
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [runtime]);

  useEffect(() => {
    if (!runtime.client || !content.trim() || saving) return;
    const timer = window.setTimeout(() => {
      void runtime.client
        ?.putAppSetting("quickCaptureDraft", {
          vaultId,
          target,
          fileName,
          content,
        })
        .catch((cause) => setError(errorMessage(cause)));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [runtime.client, vaultId, target, fileName, content, saving]);

  const save = async () => {
    if (saving) return;
    if (!runtime.client) {
      setError("Unable to connect to Symtab. Try again.");
      return;
    }
    if (!vaultId) {
      setError("Choose a vault.");
      vaultSelectRef.current?.focus();
      return;
    }
    if (!content.trim()) {
      setError("Write something to capture.");
      contentRef.current?.focus();
      return;
    }
    const inboxFilePath = target === "inbox" ? quickCaptureInboxPath("", fileName) : null;
    if (target === "inbox" && !inboxFilePath) {
      setError("Enter a filename without folders.");
      fileNameRef.current?.focus();
      return;
    }
    const selected = vaults.find((item) => item.vaultId === vaultId);
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const vault = await runtime.client.openVault({ path: selected.path });
      const config = await loadDailyNoteConfig(runtime.client, vault.id);
      const date = dateKeyInTimeZone(new Date(), config.timeZone);
      const path =
        target === "inbox"
          ? quickCaptureInboxPath(config.inboxPath, fileName)!
          : `${config.dailyFolder}/${noteFileName(date, config.dailyFormat)}`;
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent) await runtime.client.createDirectory(vault.id, parent);
      const addition = `\n\n${content.trim()}\n`;
      const initial =
        target === "daily"
          ? await noteTemplate(runtime.client, vault.id, config.dailyTemplate, `# ${date}\n`, {
              date,
            })
          : "";
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        const existing = await runtime.client.getFileMetadata(vault.id, path);
        if (!existing) {
          try {
            await runtime.client.createFile({
              vaultId: vault.id,
              path,
              content: initial ? initial.replace(/\s*$/, "") + addition : content.trim() + "\n",
            });
            saved = true;
          } catch {
            // Another writer may have created it; reread and append.
          }
          continue;
        }
        const document = await runtime.client.readFile(vault.id, path);
        try {
          await runtime.client.saveFile({
            vaultId: vault.id,
            path,
            content: document.content.replace(/\s*$/, "") + addition,
            expectedHash: document.contentHash,
          });
          saved = true;
        } catch {
          // Conflict: bounded reread and retry.
        }
      }
      if (!saved) throw new Error("File changed repeatedly. Capture remains available.");
      await runtime.client.putAppSetting("quickCaptureVaultId", vaultId);
      await runtime.client.putAppSetting("quickCaptureDraft", null);
      setContent("");
      await runtime.hideWindow?.();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <main className="flex h-screen flex-col bg-sidebar text-foreground">
        <header className="flex h-11 shrink-0 items-center border-b ps-[76px] pe-4 [border-color:var(--layout-separator)] [-webkit-app-region:drag]">
          <h1 className="text-sm font-medium tracking-[-0.01em]">Quick capture</h1>
          <span className="ms-auto text-[11px] text-foreground/70">⌘↵ to save</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2.5">
            <label className="grid min-w-0 gap-1 text-[11px] font-medium text-foreground/70">
              Vault
              <select
                ref={vaultSelectRef}
                value={vaultId}
                aria-invalid={Boolean(error && !vaultId)}
                aria-describedby={error ? "quick-capture-error" : undefined}
                onChange={(event) => {
                  setVaultId(event.target.value);
                  setError("");
                }}
                className="h-8 min-w-0 rounded-md border bg-popover px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
              >
                <option value="">Choose vault…</option>
                {vaults.map((item) => (
                  <option key={item.vaultId} value={item.vaultId}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-foreground/70">
              Save to
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value as "inbox" | "daily")}
                className="h-8 rounded-md border bg-popover px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
              >
                <option value="inbox">Inbox</option>
                <option value="daily">Today</option>
              </select>
            </label>
          </div>
          {target === "inbox" ? (
            <label className="grid gap-1 text-[11px] font-medium text-foreground/70">
              Filename
              <Input
                ref={fileNameRef}
                value={fileName}
                aria-invalid={Boolean(error && !quickCaptureInboxPath("", fileName))}
                aria-describedby={error ? "quick-capture-error" : undefined}
                onChange={(event) => {
                  setFileName(event.target.value);
                  setError("");
                }}
                placeholder="Quick note.md"
                className="h-8"
              />
            </label>
          ) : null}
          <label className="flex min-h-0 flex-1 flex-col gap-1 text-[11px] font-medium text-foreground/70">
            Note
            <Textarea
              ref={contentRef}
              autoFocus
              value={content}
              aria-invalid={Boolean(error && !content.trim())}
              aria-describedby={error ? "quick-capture-error" : undefined}
              onChange={(event) => {
                setContent(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void save();
              }}
              placeholder="Write a note…"
              className="min-h-0 flex-1 resize-none field-sizing-fixed font-normal leading-6"
            />
          </label>
          <div className="flex min-h-8 items-center justify-between gap-3">
            <p
              id="quick-capture-error"
              role="status"
              className="min-w-0 text-xs leading-4 text-destructive"
            >
              {error}
            </p>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              className="shadow-none before:shadow-none"
            >
              {saving ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      </main>
    </ThemeProvider>
  );
}
