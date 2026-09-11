import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Input } from "@flux/shared-ui/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@flux/shared-ui/components/ui/field";
import { authRequest, type AuthStatus, type Credential } from "./client";

export function AccountSettings({
  status,
  beforeSignOut,
  onSignOut,
}: {
  status: AuthStatus;
  beforeSignOut: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return authRequest<Credential[]>("/credentials").then(setCredentials);
  }, []);

  useEffect(() => {
    void load().catch((cause) => setError(String(cause)));
  }, [status.sessionId, load]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const createToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name"));
    void run(async () => {
      const result = await authRequest<{ token: string }>("/tokens", "POST", { name });
      setToken(result.token);
      form.reset();
      await load();
    });
  };
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-medium">Account</h3>
        <p className="text-sm text-muted-foreground">Signed in as {status.username}.</p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await beforeSignOut();
              await authRequest("/logout", "POST");
              onSignOut();
            })
          }
        >
          Sign out
        </Button>
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form onSubmit={createToken}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="token-name">API token</FieldLabel>
            <FieldDescription>
              Full access to this instance's API. Expires after 90 days. Store it securely.
            </FieldDescription>
            <Input
              id="token-name"
              name="name"
              placeholder="Token name"
              required
              maxLength={80}
              disabled={busy}
            />
          </Field>
          <Button size="sm" type="submit" disabled={busy}>
            Create token
          </Button>
          {token && (
            <Field>
              <FieldLabel htmlFor="new-token">Copy your token</FieldLabel>
              <Input
                id="new-token"
                value={token}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <FieldDescription>Shown only now. It cannot be retrieved later.</FieldDescription>
              <Button size="sm" variant="outline" type="button" onClick={() => setToken("")}>
                Done
              </Button>
            </Field>
          )}
        </FieldGroup>
      </form>
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Sessions and tokens</h3>
        <p className="text-sm text-muted-foreground">
          Sessions expire after 30 minutes idle or 7 days.
        </p>
        <ul className="space-y-3">
          {credentials.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <p className="truncate">
                  {entry.name}
                  {entry.id === status.sessionId ? " (this session)" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(entry.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (entry.id === status.sessionId) await beforeSignOut();
                    await authRequest(`/credentials/${encodeURIComponent(entry.id)}`, "DELETE");
                    if (entry.id === status.sessionId) onSignOut();
                    else await load();
                  })
                }
              >
                Revoke<span className="sr-only"> {entry.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            await beforeSignOut();
            await authRequest("/password", "POST", {
              currentPassword: data.get("currentPassword"),
              newPassword: data.get("newPassword"),
            });
            onSignOut();
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
              disabled={busy}
            />
            <FieldDescription>
              Changing your password revokes all sessions and API tokens.
            </FieldDescription>
          </Field>
          <Button type="submit" size="sm" disabled={busy}>
            Change password
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
