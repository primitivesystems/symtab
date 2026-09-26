import { createClientStatePersistence, SymtabApp, type SymtabRuntime } from "@symtab/app-core";
import { WebSymtabClient } from "@symtab/client-web";

const client = new WebSymtabClient();
const statePersistence = createClientStatePersistence(client);
const webRuntime: SymtabRuntime = {
  label: "Web",
  client,
  vaultAccess: "registry",
  statePersistence,
  getWindowId: async () => {
    const key = "symtab-window-id";
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
  return <SymtabApp runtime={webRuntime} windowControlsInset={0} />;
}
