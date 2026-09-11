import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "../../../ui/field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../ui/dialog";

export interface SelectableVault { key: string; name: string; path: string }

export function VaultManager({ open, canClose, activeVaultId, vaults, recentVaults, query, vaultAccess, canSelectDirectory, onClose, onQueryChange, onOpenVault, onForgetVault, onChooseVault }: {
  open: boolean;
  canClose: boolean;
  activeVaultId: string;
  vaults: SelectableVault[];
  recentVaults: { path: string; vaultId: string }[];
  query: string;
  vaultAccess?: "filesystem" | "registry";
  canSelectDirectory: boolean;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onOpenVault: (vault: SelectableVault) => void | Promise<void>;
  onForgetVault: (vaultId: string) => void | Promise<void>;
  onChooseVault: (mode: "open" | "create") => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    setError(undefined);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open the vault. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && canClose && !busy) { setError(undefined); onClose(); } }}>
      <DialogContent showCloseButton={canClose && !busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vaults</DialogTitle>
          <DialogDescription>{vaultAccess === "registry" ? "Choose a workspace available on this server or create a new one." : "Open a notes folder or create a new vault."}</DialogDescription>
        </DialogHeader>
        <FieldGroup aria-busy={busy}>
          {canSelectDirectory ? <Field className={`grid gap-3 ${vaultAccess === "registry" ? "grid-cols-1" : "grid-cols-2"}`}>
            <Button disabled={busy} onClick={() => void run(() => onChooseVault("create"))}>
              {vaultAccess === "registry" ? "Create workspace" : "Create vault"}
            </Button>
            {vaultAccess !== "registry" ? <Button disabled={busy} variant="outline" onClick={() => void run(() => onChooseVault("open"))}>Open folder</Button> : null}
          </Field> : null}
          <Field>
            <FieldLabel htmlFor="vault-search">Available vaults</FieldLabel>
            <Input id="vault-search" placeholder="Find a vault" value={query} onChange={(event) => onQueryChange(event.target.value)} />
          </Field>
          <ul aria-label="Available vaults" className="max-h-64 space-y-1 overflow-y-auto">
            {vaults.map((item) => {
              const selected = item.key === activeVaultId;
              const recent = recentVaults.find((candidate) => candidate.path === item.path);
              return <li key={item.key} className="flex items-center gap-1">
                <Button disabled={busy} variant={selected ? "secondary" : "ghost"} className="h-auto min-w-0 flex-1 justify-start py-2 text-left" onClick={() => void run(() => onOpenVault(item))}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}{selected ? " · Open" : ""}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground" title={item.path}>{item.path}</span>
                  </span>
                </Button>
                {recent && !selected ? <Button disabled={busy} variant="ghost" size="icon-sm" aria-label={`Forget ${item.name}`} title="Remove from recent vaults" onClick={() => void run(() => onForgetVault(recent.vaultId))}><XIcon /></Button> : null}
              </li>;
            })}
          </ul>
          {!vaults.length ? <FieldDescription>{query ? "No matching vaults." : vaultAccess === "registry" ? "No workspaces yet. Create one to get started." : "No vaults yet. Open a folder to get started."}</FieldDescription> : null}
          <FieldError>{error}</FieldError>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
