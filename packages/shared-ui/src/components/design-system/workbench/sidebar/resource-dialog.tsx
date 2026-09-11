import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../../../ui/alert-dialog";
import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import { Input } from "../../../ui/input";
import { Label } from "../../../ui/label";

export type ResourceRequest = { kind: "file" | "folder"; parent?: string };

export function ResourceDialog({
  request,
  onOpenChange,
  onSubmit,
}: {
  request?: ResourceRequest;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(request?.kind === "file" ? "Untitled.md" : "New folder");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const title = request?.kind === "file" ? "New file" : "New folder";
  const valid =
    Boolean(name.trim()) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== "..";

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(name.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${title} failed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {`Create it in ${request?.parent || "the vault root"}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="resource-name">{request?.kind === "file" ? "Note name" : "Name"}</Label>
          <Input
            id="resource-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            aria-invalid={Boolean(error) || !valid}
            autoFocus
          />
          {request?.kind === "file" ? (
            <p className="text-xs text-muted-foreground">
              Flux v1 creates Markdown notes only. A missing <code>.md</code> extension will be added for you.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "Working…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteResourceDialog({
  path,
  onOpenChange,
  onDelete,
}: {
  path?: string;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AlertDialog open={Boolean(path)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AlertTriangle aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Move to trash?</AlertDialogTitle>
          <AlertDialogDescription>
            {path} and its contents can be restored from Trash.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await onDelete();
                onOpenChange(false);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Delete failed.");
                setBusy(false);
              }
            }}
          >
            {busy ? "Moving…" : "Move to trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
