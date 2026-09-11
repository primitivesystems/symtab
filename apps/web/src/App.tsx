import { createClientStatePersistence, FluxApp, type FluxRuntime } from "@flux/app-core";
import { WebFluxClient } from "@flux/client-web";
import { AuthGate } from "./auth/auth-gate";
import { AccountSettings } from "./auth/account-settings";
import { authenticatedFetch } from "./auth/client";

const client = new WebFluxClient("/api/v1", authenticatedFetch);
let flushBeforeSignOut: (() => Promise<void>) | undefined;
const statePersistence = createClientStatePersistence(client);
const webRuntime: FluxRuntime = {
  label: "Web",
  client,
  vaultAccess: "registry",
  statePersistence,
  onBeforeShutdown: (handler) => {
    flushBeforeSignOut = handler;
    return () => {
      if (flushBeforeSignOut === handler) flushBeforeSignOut = undefined;
    };
  },
  getWindowId: async () => {
    const key = "flux-window-id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  },
  connect: async () => {
    try {
      const status = await client.getStatus();
      return status.openVault
        ? `Go backend connected · ${status.openVault.name}`
        : "Go backend connected · no vault open";
    } catch {
      return "Go backend offline · start the server on port 8080";
    }
  },
  selectVaultDirectory: async (mode) => {
    if (mode !== "create") return null;
    const name = window.prompt("Vault name")?.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      return null;
    }
    return name;
  },
};

export default function App() {
  return (
    <AuthGate>
      {(status, signOut) => (
        <FluxApp
          runtime={webRuntime}
          windowControlsInset={0}
          accountSettings={
            status.enabled ? (
              <AccountSettings
                status={status}
                onSignOut={signOut}
                beforeSignOut={async () => {
                  await flushBeforeSignOut?.();
                }}
              />
            ) : undefined
          }
        />
      )}
    </AuthGate>
  );
}
