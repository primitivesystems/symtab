import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, FolderOpenIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Input } from "@flux/shared-ui/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@flux/shared-ui/components/ui/field";

export type WorkspaceSetup = { name: string; location: string };

export function OnboardingWorkspaceForm({
  ready,
  managed,
  onSelectLocation,
  onCreate,
  onOpenVault,
  onBack,
  hidden = false,
}: {
  hidden?: boolean;
  ready: boolean;
  managed: boolean;
  onSelectLocation?: () => Promise<string | null>;
  onCreate: (workspace: WorkspaceSetup) => Promise<void>;
  onOpenVault: () => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!hidden) nameInput.current?.focus(); }, [hidden]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const disabled = busy || selecting || opening;

  async function openExisting() {
    if (disabled || !ready) return;
    setOpening(true);
    setError(undefined);
    try { await onOpenVault(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : managed ? "Could not open your workspace. Try again." : "Could not open the vault. Try again."); }
    finally { setOpening(false); }
  }

  async function selectLocation() {
    setSelecting(true);
    setError(undefined);
    try {
      const selected = await onSelectLocation?.();
      if (selected) setLocation(selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not choose a location."); }
    finally { setSelecting(false); }
  }

  async function create() {
    if (disabled || !ready) return;
    setBusy(true);
    setError(undefined);
    try { await onCreate({ name: name.trim(), location }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create your workspace. Try again."); }
    finally { setBusy(false); }
  }

  return <section hidden={hidden} className="w-full max-w-sm" aria-labelledby="workspace-setup-title">
    <Button variant="ghost" disabled={disabled} onClick={onBack} className="mb-8 -ms-2 text-muted-foreground"><ArrowLeftIcon />Back</Button>
    <header className="mb-8">
      <p className="mb-3 text-sm text-muted-foreground">Step 2 of 2 · Workspace</p>
      <h1 id="workspace-setup-title" className="text-2xl font-semibold tracking-tight">Make room for your ideas.</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Give your workspace a name. Your notes, journals, and linked ideas will live here.</p>
    </header>
    <form onSubmit={(event) => { event.preventDefault(); void create(); }} aria-busy={disabled}>
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
          <Input ref={nameInput} id="workspace-name" autoComplete="off" placeholder="e.g. Personal, Research, Studio" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} disabled={disabled} className="h-11" />
        </Field>
        {managed ? <FieldDescription>This workspace will be stored on your connected Flux server.</FieldDescription> : <Field>
          <FieldLabel htmlFor="workspace-location">Save location</FieldLabel>
          {onSelectLocation ? <Button id="workspace-location" type="button" variant="outline" disabled={disabled} onClick={() => void selectLocation()} className="h-auto min-h-11 justify-start whitespace-normal py-2 text-start">
            <FolderOpenIcon className="shrink-0" /><span className="min-w-0 break-all">{location || "Choose a location"}</span>
          </Button> : <Input id="workspace-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Absolute path on your Flux server" required disabled={disabled} className="h-11" />}
          <FieldDescription className="break-words">{name.trim() ? `A new "${name.trim()}" folder will be created here.` : "Choose the parent folder. Flux will create a separate folder for this workspace."}</FieldDescription>
        </Field>}
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        {!ready ? <FieldDescription role="status">Connecting to your workspace…</FieldDescription> : null}
        <Field>
          <Button type="submit" disabled={!ready || disabled || !name.trim() || (!managed && !location)} className="h-11 rounded-lg border-0 bg-linear-to-b from-blue-500 to-blue-700 text-white shadow-sm ring-1 ring-inset ring-white/20 hover:brightness-110">
            {busy ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : null}
            {busy ? "Creating workspace…" : "Create workspace"}
            {!busy ? <ArrowRightIcon /> : null}
          </Button>
          <Button type="button" variant="ghost" disabled={!ready || disabled} onClick={() => void openExisting()}>
            {opening ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <FolderOpenIcon />}
            {opening
              ? managed
                ? "Opening workspace…"
                : "Opening vault…"
              : managed
                ? "Choose existing workspace"
                : "Open existing vault"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  </section>;
}