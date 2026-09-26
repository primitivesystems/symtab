import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  SymtabClient,
  MarketplacePlugin,
  PluginCatalogEntry,
  VaultInfo,
  VaultPlugin,
} from "@symtab/bridge-contract";
import { VaultPluginHost, type PluginBundle } from "@symtab/plugin-runtime";
import type { PluginCapability } from "@symtab/plugin-sdk";
import { toast } from "@symtab/shared-ui/components/sonner";
import type { OpenPluginView, PluginViewLocation } from "./surface";

export function usePlugins({
  client,
  vault,
  openWindow,
  flushPendingSaves,
}: {
  client: SymtabClient | null;
  vault: VaultInfo | null;
  openWindow?: (url: string) => Promise<void>;
  flushPendingSaves: (vaultId?: string) => Promise<void>;
}) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplacePlugin[]>([]);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [section, setSection] = useState<"marketplace" | "installed">("marketplace");
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [vaultPlugins, setVaultPlugins] = useState<VaultPlugin[]>([]);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<OpenPluginView>();
  const [query, setQuery] = useState("");
  const hostRef = useRef<VaultPluginHost | null>(null);

  const refresh = async () => {
    if (!client) return;
    const [nextCatalog, enabled] = await Promise.all([
      client.listPlugins(),
      vault ? client.listVaultPlugins(vault.id) : Promise.resolve([]),
    ]);
    setCatalog(nextCatalog);
    setVaultPlugins(enabled);
    if (vault) {
      const nextSettings = await Promise.all(
        nextCatalog
          .filter((entry) => entry.active && entry.manifest.contributes?.settings?.length)
          .map(
            async (entry) =>
              [
                entry.manifest.id,
                await client.getPluginSettings(vault.id, entry.manifest.id),
              ] as const
          )
      );
      setSettings(Object.fromEntries(nextSettings));
    } else {
      setSettings({});
    }
    try {
      const result = await client.getMarketplace();
      setMarketplace(result.plugins);
      setMarketplaceError("");
    } catch (error) {
      setMarketplace([]);
      setMarketplaceError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!client) return;
    let active = true;
    void Promise.all([
      client.listPlugins(),
      vault ? client.listVaultPlugins(vault.id) : Promise.resolve([]),
    ])
      .then(([nextCatalog, enabled]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setVaultPlugins(enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, vault]);

  const openManager = () => {
    setManagerOpen(true);
    void refresh().catch((error) =>
      toast.error("Could not load plugins", {
        description: error instanceof Error ? error.message : String(error),
      })
    );
  };

  const openView = useCallback(
    async (
      pluginId: string,
      contribution: { id: string; title: string; location?: PluginViewLocation }
    ) => {
      if (!client || !vault) return;
      try {
        const result = await client.getPluginView(vault.id, pluginId, contribution.id);
        setView({ ...result, pluginId, viewId: contribution.id });
        setManagerOpen(false);
      } catch (error) {
        toast.error(`${contribution.title} failed`, {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, vault]
  );

  const openPluginId = view?.pluginId;
  const openPluginViewId = view?.viewId;
  const developmentViewOpen = catalog.some(
    (entry) => entry.active && entry.manifest.id === openPluginId && entry.plugin.development
  );
  useEffect(() => {
    if (!developmentViewOpen || !client || !vault || !openPluginId || !openPluginViewId) return;
    let active = true;
    const reload = async () => {
      const next = await client.getPluginView(vault.id, openPluginId, openPluginViewId);
      if (!active) return;
      setView((current) => {
        if (
          !current ||
          current.pluginId !== openPluginId ||
          current.viewId !== openPluginViewId ||
          current.html === next.html
        )
          return current;
        setRevision((value) => value + 1);
        return { ...current, ...next };
      });
    };
    void reload().catch(() => undefined);
    const timer = window.setInterval(() => void reload().catch(() => undefined), 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, developmentViewOpen, openPluginId, openPluginViewId, vault]);

  const ribbonItems = useMemo(
    () =>
      catalog.flatMap((entry) => {
        const state = vaultPlugins.find((candidate) => candidate.pluginId === entry.manifest.id);
        if (!entry.active || !state?.enabled) return [];
        return (entry.manifest.contributes?.views ?? []).map((contribution) => {
          const active = view?.pluginId === entry.manifest.id && view.viewId === contribution.id;
          return {
            id: `${entry.manifest.id}:${contribution.id}`,
            label: contribution.title,
            icon: contribution.icon,
            iconSrc: entry.viewIcons?.[contribution.id],
            active,
            onClick: () =>
              active ? setView(undefined) : void openView(entry.manifest.id, contribution),
          };
        });
      }),
    [catalog, openView, vaultPlugins, view]
  );

  const location = useMemo<PluginViewLocation>(() => {
    if (!view) return "modal";
    return (
      catalog
        .find((entry) => entry.manifest.id === view.pluginId)
        ?.manifest.contributes?.views?.find((candidate) => candidate.id === view.viewId)
        ?.location ?? "modal"
    );
  }, [catalog, view]);

  const installFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const installed = await client.installPlugin(bytes, sha256);
      const reloaded = installed.plugin.status === "active";
      toast.success(`${installed.manifest.name} ${reloaded ? "reloaded" : "staged"}`, {
        description: reloaded
          ? installed.plugin.development
            ? "Development build is live."
            : "Installed build is live."
          : "Review permissions, then activate it.",
      });
      await refresh();
      if (reloaded) setRevision((value) => value + 1);
    } catch (error) {
      toast.error("Plugin install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const installMarketplace = async (plugin: MarketplacePlugin) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.installMarketplacePlugin(plugin.manifest.id);
      await refresh();
      setSection("installed");
      toast.success(`${plugin.manifest.name} staged`, {
        description: "Review permissions, then activate it.",
      });
    } catch (error) {
      toast.error("Marketplace install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveSetting = async (pluginId: string, settingId: string, value: unknown) => {
    if (!client || !vault) return;
    const values = { ...(settings[pluginId] ?? {}), [settingId]: value };
    setSettings((current) => ({ ...current, [pluginId]: values }));
    try {
      await client.putPluginSettings(vault.id, pluginId, values);
      setRevision((current) => current + 1);
    } catch (error) {
      toast.error("Setting was not saved", {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
    }
  };

  const update = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await refresh();
      setRevision((current) => current + 1);
    } catch (error) {
      toast.error("Plugin action failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!client || !vault) return;
    let disposed = false;
    const host = new VaultPluginHost({
      vaultId: vault.id,
      capabilityHandler: (pluginId, capability, input) =>
        client.invokePluginCapability(vault.id, pluginId, capability, input),
      onDisabled: ({ pluginId, reason }) => {
        void client.disableVaultPlugin(vault.id, pluginId);
        toast.error(`${pluginId} disabled`, { description: reason });
      },
    });
    hostRef.current?.dispose();
    hostRef.current = host;
    void client
      .listPluginBundles(vault.id)
      .then(async (bundles) => {
        for (const bundle of bundles) {
          if (disposed) return;
          try {
            await host.activate({
              ...bundle,
              manifest: bundle.manifest as PluginBundle["manifest"],
              grantedCapabilities: bundle.grantedCapabilities as PluginCapability[],
            });
          } catch (error) {
            toast.error(`${bundle.manifest.name} failed to start`, {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
      .catch((error) =>
        toast.error("Plugins unavailable", {
          description: error instanceof Error ? error.message : String(error),
        })
      );
    return () => {
      disposed = true;
      host.dispose();
      if (hostRef.current === host) hostRef.current = null;
    };
  }, [client, revision, vault]);

  const invokeCapability = async (
    pluginId: string,
    capability: PluginCapability,
    input: unknown
  ) => {
    if (!client || !vault) throw new Error("No vault is open");
    const permissions = vaultPlugins.find((item) => item.pluginId === pluginId)?.grantedPermissions;
    if (!permissions?.includes(capability))
      throw new Error(`capability not granted: ${capability}`);
    if (capability === "ui.external") {
      const url = new URL(String((input as { url?: unknown })?.url ?? ""));
      if (url.protocol !== "https:") throw new Error("only HTTPS links can be opened");
      if (!openWindow) throw new Error("external links are unavailable");
      await openWindow(url.href);
      return { opened: true };
    }
    if (
      ["git.pull", "git.checkout", "git.branch.create", "git.discard", "git.resolve"].includes(
        capability
      )
    ) {
      await flushPendingSaves(vault.id);
    }
    return client.invokePluginCapability(vault.id, pluginId, capability, input);
  };

  return {
    managerOpen,
    setManagerOpen,
    catalog,
    marketplace,
    marketplaceError,
    section,
    setSection,
    settings,
    vaultPlugins,
    busy,
    revision,
    view,
    setView,
    query,
    setQuery,
    hostRef,
    openManager,
    openView,
    ribbonItems,
    location,
    installFile,
    installMarketplace,
    saveSetting,
    update,
    invokeCapability,
  };
}
