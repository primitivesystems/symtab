import { describe, expect, mock, test } from "bun:test";
import type { SymtabClient } from "@symtab/bridge-contract";

import { createClientStatePersistence } from "../src/app/client-state-persistence";

describe("client state persistence", () => {
  test("restores last window vault and validates workspace state", async () => {
    const client = {
      getBootstrap: mock(async () => ({
        recentVaults: [
          {
            vaultId: "other",
            path: "/vaults/other",
            displayName: "Other",
            lastOpenedAt: "2026-07-20T00:00:00Z",
          },
          {
            vaultId: "notes",
            path: "/vaults/notes",
            displayName: "Notes",
            lastOpenedAt: "2026-07-19T00:00:00Z",
          },
        ],
        workspace: {
          windowId: "main",
          vaultId: "notes",
          state: {},
          updatedAt: "2026-07-21T00:00:00Z",
        },
        settings: {},
      })),
      getWorkspace: mock(async () => ({
        windowId: "main",
        vaultId: "notes",
        state: { version: 999 },
        updatedAt: "2026-07-21T00:00:00Z",
      })),
    } as unknown as SymtabClient;
    const persistence = createClientStatePersistence(client);

    await expect(persistence.loadBootstrap("main")).resolves.toEqual({
      lastVaultPath: "/vaults/notes",
    });
    await expect(persistence.loadWorkspaceSession("main", "notes")).resolves.toBeNull();
  });

  test("serializes app setting writes", async () => {
    const calls: string[] = [];
    let releaseFirst = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const client = {
      putAppSetting: mock(async (_key: string, value: unknown) => {
        calls.push(`start:${String(value)}`);
        if (value === "dark") await firstGate;
        calls.push(`finish:${String(value)}`);
      }),
    } as unknown as SymtabClient;
    const persistence = createClientStatePersistence(client);

    const first = persistence.saveAppSetting("theme", "dark");
    const second = persistence.saveAppSetting("theme", "light");
    await Promise.resolve();
    expect(calls).toEqual(["start:dark"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(["start:dark", "finish:dark", "start:light", "finish:light"]);
  });

  test("does not let a delayed bootstrap replace a newer remembered vault", async () => {
    let releaseBootstrap = () => undefined;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const forgotten: string[] = [];
    const client = {
      getBootstrap: mock(async () => {
        await bootstrapGate;
        return {
          recentVaults: [
            {
              vaultId: "old",
              path: "/vaults/old",
              displayName: "Old",
              lastOpenedAt: "2026-07-20T00:00:00Z",
            },
          ],
          workspace: null,
          settings: {},
        };
      }),
      rememberVault: mock(async () => undefined),
      forgetVault: mock(async (vaultId: string) => {
        forgotten.push(vaultId);
      }),
    } as unknown as SymtabClient;
    const persistence = createClientStatePersistence(client);

    const bootstrap = persistence.loadBootstrap("main");
    await persistence.rememberVault({ id: "new", name: "New", path: "/vaults/new" });
    releaseBootstrap();
    await bootstrap;
    await persistence.forgetLastVault();

    expect(forgotten).toEqual(["new"]);
  });
});
