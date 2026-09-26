import type { SymtabClient } from "@symtab/bridge-contract";

import type { SymtabStatePersistence, PersistedWorkspaceSession, RememberedVault } from "./state";

function persistedWorkspace(value: unknown): PersistedWorkspaceSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<PersistedWorkspaceSession>;
  if (
    session.version !== 1 ||
    typeof session.vaultId !== "string" ||
    !Array.isArray(session.tabs) ||
    !session.workspaceRoot ||
    typeof session.activeLeafId !== "number"
  ) {
    return null;
  }
  return session as PersistedWorkspaceSession;
}

/** Persists UI snapshots through Symtab backend global app storage. */
export function createClientStatePersistence(client: SymtabClient): SymtabStatePersistence {
  let lastVaultId: string | null = null;
  let lastVaultRevision = 0;
  let settingWrites = Promise.resolve();

  return {
    async loadBootstrap(windowId) {
      const revision = lastVaultRevision;
      const bootstrap = await client.getBootstrap(windowId);
      const recent = bootstrap.workspace
        ? bootstrap.recentVaults.find((vault) => vault.vaultId === bootstrap.workspace?.vaultId)
        : bootstrap.recentVaults[0];
      if (revision === lastVaultRevision) lastVaultId = recent?.vaultId ?? null;
      return { lastVaultPath: recent?.path ?? null };
    },
    async loadWorkspaceSession(windowId, vaultId) {
      const session = await client.getWorkspace(windowId, vaultId);
      return persistedWorkspace(session?.state);
    },
    async saveWorkspaceSession(windowId, session) {
      await client.saveWorkspace(windowId, session.vaultId, session);
    },
    loadAppSettings() {
      return client.getAppSettings();
    },
    saveAppSetting(key, value) {
      const write = settingWrites.then(() => client.putAppSetting(key, value));
      settingWrites = write.then(
        () => undefined,
        () => undefined
      );
      return write;
    },
    async rememberVault(vault: RememberedVault) {
      lastVaultRevision++;
      lastVaultId = vault.id;
      await client.rememberVault({
        vaultId: vault.id,
        path: vault.path,
        displayName: vault.name,
      });
    },
    async forgetLastVault() {
      if (!lastVaultId) return;
      lastVaultRevision++;
      const vaultId = lastVaultId;
      lastVaultId = null;
      await client.forgetVault(vaultId);
    },
  };
}
