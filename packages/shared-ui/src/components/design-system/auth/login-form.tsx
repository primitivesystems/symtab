import { useState, type FormEvent } from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../../ui/field";

export function LoginForm({
  setup,
  onSubmit,
}: {
  setup: boolean;
  onSubmit: (values: { username: string; password: string; setupKey: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        username: String(data.get("username")),
        password: String(data.get("password")),
        setupKey: String(data.get("setupKey") ?? ""),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm"
        aria-label={setup ? "Set up owner account" : "Sign in to Flux"}
      >
        <FieldGroup>
          <header className="space-y-2 text-center">
            <p className="text-sm font-medium">Flux</p>
            <h1 className="text-xl font-semibold">{setup ? "Make it yours" : "Welcome back"}</h1>
            <FieldDescription>
              {setup ? "Create the owner account for this instance." : "Sign in to your workspace."}
            </FieldDescription>
          </header>
          {setup && (
            <Field>
              <FieldLabel htmlFor="setup-key">Setup key</FieldLabel>
              <Input
                id="setup-key"
                name="setupKey"
                type="password"
                autoComplete="off"
                required
                disabled={busy}
              />
              <FieldDescription>Use the FLUX_SETUP_KEY configured on your server.</FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="username">Username</FieldLabel>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9_.@\-]+"
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              required
              minLength={setup ? 15 : undefined}
              maxLength={128}
              disabled={busy}
            />
            {setup && <FieldDescription>Use at least 15 characters.</FieldDescription>}
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create account" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </main>
  );
}
