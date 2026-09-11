import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LoginForm } from "@flux/shared-ui/components/design-system/auth/login-form";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@flux/shared-ui/components/ui/dialog";
import { authRequest, resumeAuthentication, type AuthStatus } from "./client";

export function AuthGate({
  children,
}: {
  children: (status: AuthStatus, signOut: () => void) => ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus>();
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);

  const refresh = useCallback(() => {
    const currentEpoch = epoch.current;
    return authRequest<AuthStatus>("/status")
      .then((next) => {
        if (currentEpoch !== epoch.current) return;
        setStatus(next);
        setError("");
        if (!next.enabled || next.authenticated) {
          setEntered(true);
          resumeAuthentication();
        }
      })
      .catch((cause) => {
        if (currentEpoch !== epoch.current) return;
        setError(cause instanceof Error ? cause.message : "Could not connect");
      });
  }, []);

  const handleExpired = useCallback(() => {
    epoch.current++;
    setStatus((current) => current && { ...current, authenticated: false });
  }, []);

  const handleSignOut = useCallback(() => {
    epoch.current++;
    setEntered(false);
    setStatus((current) => current && { ...current, authenticated: false });
  }, []);

  useEffect(() => {
    void refresh();
    const expired = () => void handleExpired();
    window.addEventListener("flux-session-expired", expired);
    const interval = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("flux-session-expired", expired);
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [refresh, handleExpired]);
  if (!status)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p role="status">{error || "Connecting to Flux…"}</p>
        {error && <Button onClick={() => void refresh()}>Retry</Button>}
      </main>
    );
  const locked = status.enabled && !status.authenticated;
  const login = (
    <LoginForm
      setup={Boolean(status.setupRequired)}
      onSubmit={async (values) => {
        epoch.current++;
        await authRequest(status.setupRequired ? "/setup" : "/login", "POST", values);
        // Fetch errors must leave the login form recoverable, not silently succeed.
        const next = await authRequest<AuthStatus>("/status");
        if (!next.authenticated)
          throw Error(
            "Session cookie was not accepted. Check the server's public URL and HTTPS configuration."
          );
        setStatus(next);
        setEntered(true);
        resumeAuthentication();
      }}
    />
  );
  return (
    <>
      {entered && (
        <div hidden={locked} inert={locked}>
          {/* The render prop forwards this callback to a button; it does not invoke it. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {children(status, handleSignOut)}
        </div>
      )}
      {locked &&
        (entered ? (
          <Dialog open onOpenChange={() => {}}>
            <DialogContent
              showCloseButton={false}
              aria-describedby={undefined}
              className="inset-0 z-[100] block h-dvh max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-0 ring-0 sm:max-w-none"
            >
              <DialogTitle className="sr-only">Session expired. Sign in to continue.</DialogTitle>
              {login}
            </DialogContent>
          </Dialog>
        ) : (
          login
        ))}
    </>
  );
}
