import type { ChangeEvent, RefObject } from "react";
import type {
  SymtabClient,
  MarketplacePlugin,
  PluginCatalogEntry,
  VaultInfo,
  VaultPlugin,
} from "@symtab/bridge-contract";
import { toast } from "@symtab/shared-ui/components/sonner";
import type { VaultPluginHost } from "@symtab/plugin-runtime";
import type { PluginViewLocation } from "./surface";

interface PluginManagerProps {
  open: boolean;
  pluginBusy: boolean;
  pluginCatalog: PluginCatalogEntry[];
  marketplacePlugins: MarketplacePlugin[];
  marketplaceError: string;
  pluginSection: "marketplace" | "installed";
  pluginQuery: string;
  pluginSettings: Record<string, Record<string, unknown>>;
  vault: VaultInfo | null;
  vaultPlugins: VaultPlugin[];
  client: SymtabClient | null;
  pluginHostRef: RefObject<VaultPluginHost | null>;
  onClose: () => void;
  setPluginSection: (section: "marketplace" | "installed") => void;
  setPluginQuery: (query: string) => void;
  installPlugin: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  installMarketplacePlugin: (plugin: MarketplacePlugin) => Promise<void>;
  savePluginSetting: (pluginId: string, settingId: string, value: unknown) => Promise<void>;
  updatePlugin: (operation: () => Promise<void>) => Promise<void>;
  openPluginSurface: (
    pluginId: string,
    view: { id: string; title: string; location?: PluginViewLocation }
  ) => Promise<void>;
}

export function PluginManager({ open, client, onClose, ...props }: PluginManagerProps) {
  if (!open) return null;
  const {
    pluginBusy,
    pluginCatalog,
    marketplacePlugins,
    marketplaceError,
    pluginSection,
    pluginQuery,
    pluginSettings,
    vault,
    vaultPlugins,
    pluginHostRef,
    setPluginSection,
    setPluginQuery,
    installPlugin,
    installMarketplacePlugin,
    savePluginSetting,
    updatePlugin,
    openPluginSurface,
  } = props;
  const runtime = { client };
  const normalizedQuery = pluginQuery.trim().toLocaleLowerCase();
  const filteredPluginCatalog = normalizedQuery
    ? pluginCatalog.filter((entry) =>
        `${entry.manifest.name}\n${entry.manifest.description}\n${entry.manifest.id}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : pluginCatalog;
  const filteredMarketplacePlugins = normalizedQuery
    ? marketplacePlugins.filter((plugin) =>
        `${plugin.manifest.name}\n${plugin.manifest.description}\n${plugin.publisher}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : marketplacePlugins;
  const setPluginManagerOpen = (value: boolean) => {
    if (!value) onClose();
  };
  return (
    <div className="fixed inset-0 z-[190] grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-manager-title"
        className="flex h-[min(46rem,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl [border-color:var(--layout-separator)]"
      >
        <header className="flex items-start justify-between border-b px-5 py-4 [border-color:var(--layout-separator)]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Vault extensions
            </p>
            <h2 id="plugin-manager-title" className="mt-1 text-lg font-semibold">
              Plugins
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Packages stay global. Permissions and state stay with each vault.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPluginManagerOpen(false)}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
          >
            Close
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r bg-muted/20 p-3 [border-color:var(--layout-separator)]">
            <nav aria-label="Plugin sections" className="space-y-1">
              {(["marketplace", "installed"] as const).map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => setPluginSection(section)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs capitalize ${
                    pluginSection === section
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span>{section}</span>
                  <span className="font-mono text-[9px] opacity-60">
                    {section === "marketplace" ? marketplacePlugins.length : pluginCatalog.length}
                  </span>
                </button>
              ))}
            </nav>
            <div className="mt-3 border-t pt-3 [border-color:var(--layout-separator)]">
              <label className="block cursor-pointer rounded-md border px-2.5 py-2 text-center text-xs font-medium hover:bg-accent [border-color:var(--layout-separator)]">
                {pluginBusy ? "Working…" : "Install from file…"}
                <input
                  type="file"
                  accept=".symtab-plugin,.zip"
                  disabled={pluginBusy}
                  onChange={(event) => void installPlugin(event)}
                  className="sr-only"
                />
              </label>
            </div>
            <p className="mt-auto border-t pt-3 text-[10px] leading-4 text-muted-foreground [border-color:var(--layout-separator)]">
              Verified package. Per-vault permissions. Isolated runtime.
            </p>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="border-b p-3 [border-color:var(--layout-separator)]">
              <label className="flex h-8 items-center rounded-md border bg-background px-3 [border-color:var(--layout-separator)]">
                <input
                  aria-label="Search plugins"
                  value={pluginQuery}
                  onChange={(event) => setPluginQuery(event.target.value)}
                  placeholder={`Search ${pluginSection} plugins`}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
            <div className="symtab-editor-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {pluginSection === "marketplace" ? (
                filteredMarketplacePlugins.length ? (
                  filteredMarketplacePlugins.map((plugin) => {
                    const installed = pluginCatalog.some(
                      (entry) =>
                        entry.manifest.id === plugin.manifest.id &&
                        entry.manifest.version === plugin.manifest.version
                    );
                    return (
                      <article
                        key={plugin.manifest.id}
                        className="rounded-lg border bg-card px-4 py-3 [border-color:var(--layout-separator)]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold">{plugin.manifest.name}</h3>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {plugin.manifest.version}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {plugin.manifest.description || plugin.manifest.id}
                            </p>
                            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                              {plugin.publisher} · signed registry
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={pluginBusy || installed}
                            onClick={() => void installMarketplacePlugin(plugin)}
                            className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                          >
                            {installed ? "Installed" : "Install"}
                          </button>
                        </div>
                        {plugin.readme ? (
                          <details className="mt-3 border-t pt-2 [border-color:var(--layout-separator)]">
                            <summary className="cursor-pointer text-xs font-medium">README</summary>
                            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-muted-foreground">
                              {plugin.readme}
                            </pre>
                          </details>
                        ) : null}
                        <a
                          href={plugin.repository}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-[10px] text-muted-foreground underline underline-offset-2"
                        >
                          Publisher repository
                        </a>
                      </article>
                    );
                  })
                ) : (
                  <div className="grid min-h-48 place-items-center rounded-lg border border-dashed px-6 text-center [border-color:var(--layout-separator)]">
                    <div>
                      <p className="text-sm font-medium">Marketplace unavailable</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {marketplaceError || "No plugins published yet."}
                      </p>
                    </div>
                  </div>
                )
              ) : filteredPluginCatalog.length ? (
                filteredPluginCatalog.map((entry) => {
                  const vaultState = vaultPlugins.find(
                    (item) => item.pluginId === entry.manifest.id
                  );
                  const hasPrevious = pluginCatalog.some(
                    (candidate) =>
                      candidate.manifest.id === entry.manifest.id &&
                      candidate.plugin.status === "previous"
                  );
                  const permissions = [
                    ...(entry.manifest.requiredPermissions ?? []),
                    ...(entry.manifest.optionalPermissions ?? []),
                  ];
                  const settings = entry.manifest.contributes?.settings ?? [];
                  return (
                    <article
                      key={`${entry.manifest.id}@${entry.manifest.version}`}
                      className="rounded-lg border bg-card px-4 py-3 [border-color:var(--layout-separator)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold">
                              {entry.manifest.name}
                            </h3>
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {entry.manifest.version}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {entry.active ? "Active" : entry.plugin.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entry.manifest.description || entry.manifest.id}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {permissions.length ? (
                              permissions.map((permission) => (
                                <span
                                  key={permission}
                                  className="rounded-full border px-2 py-0.5 font-mono text-[9px] text-muted-foreground [border-color:var(--layout-separator)]"
                                >
                                  {permission}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                No vault permissions
                              </span>
                            )}
                          </div>
                          {entry.active && vaultState?.enabled ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(entry.manifest.contributes?.commands ?? []).map((command) => (
                                <button
                                  key={command.id}
                                  type="button"
                                  onClick={() =>
                                    void pluginHostRef.current
                                      ?.emit(entry.manifest.id, `command:${command.id}`, {
                                        commandId: command.id,
                                      })
                                      .then(() => toast.success(`${command.title} finished`))
                                      .catch((error) =>
                                        toast.error(`${command.title} failed`, {
                                          description:
                                            error instanceof Error ? error.message : String(error),
                                        })
                                      )
                                  }
                                  className="rounded-md border px-2 py-1 text-[10px] [border-color:var(--layout-separator)]"
                                >
                                  Run {command.title}
                                </button>
                              ))}
                              {(entry.manifest.contributes?.views ?? []).map((view) => (
                                <button
                                  key={view.id}
                                  type="button"
                                  onClick={() => void openPluginSurface(entry.manifest.id, view)}
                                  className="rounded-md border px-2 py-1 text-[10px] [border-color:var(--layout-separator)]"
                                >
                                  Open {view.title}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {entry.active && vault && settings.length ? (
                            <div className="mt-3 space-y-2 border-t pt-3 [border-color:var(--layout-separator)]">
                              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                                Vault settings
                              </p>
                              {settings.map((setting) => {
                                const value =
                                  pluginSettings[entry.manifest.id]?.[setting.id] ??
                                  setting.default;
                                return (
                                  <label
                                    key={`${setting.id}:${String(value)}`}
                                    className="grid gap-1 text-xs"
                                  >
                                    <span className="font-medium">{setting.title}</span>
                                    {setting.type === "boolean" ? (
                                      <input
                                        type="checkbox"
                                        checked={Boolean(value)}
                                        onChange={(event) =>
                                          void savePluginSetting(
                                            entry.manifest.id,
                                            setting.id,
                                            event.target.checked
                                          )
                                        }
                                        className="h-4 w-4 accent-foreground"
                                      />
                                    ) : (
                                      <input
                                        type={setting.type === "number" ? "number" : "text"}
                                        defaultValue={value == null ? "" : String(value)}
                                        onBlur={(event) => {
                                          const nextValue =
                                            setting.type === "number"
                                              ? Number(event.target.value)
                                              : event.target.value;
                                          if (
                                            typeof nextValue !== "number" ||
                                            Number.isFinite(nextValue)
                                          ) {
                                            void savePluginSetting(
                                              entry.manifest.id,
                                              setting.id,
                                              nextValue
                                            );
                                          }
                                        }}
                                        className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [border-color:var(--layout-separator)]"
                                      />
                                    )}
                                    {setting.description ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        {setting.description}
                                      </span>
                                    ) : null}
                                  </label>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          {!entry.active && entry.plugin.status === "staged" ? (
                            <button
                              type="button"
                              disabled={pluginBusy}
                              onClick={() =>
                                void updatePlugin(async () => {
                                  if (vault && vaultState?.enabled) {
                                    await runtime.client!.approvePluginUpdate(
                                      vault.id,
                                      entry.manifest.id,
                                      entry.manifest.version,
                                      permissions
                                    );
                                  }
                                  await runtime.client!.activatePlugin(
                                    entry.manifest.id,
                                    entry.manifest.version
                                  );
                                })
                              }
                              className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background disabled:opacity-50"
                            >
                              Activate
                            </button>
                          ) : null}
                          {entry.active && vault ? (
                            vaultState?.enabled ? (
                              <button
                                type="button"
                                disabled={pluginBusy}
                                onClick={() =>
                                  void updatePlugin(() =>
                                    runtime.client!.disableVaultPlugin(vault.id, entry.manifest.id)
                                  )
                                }
                                className="rounded-md border px-2.5 py-1.5 text-xs [border-color:var(--layout-separator)]"
                              >
                                Disable
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={pluginBusy}
                                onClick={() =>
                                  void updatePlugin(() =>
                                    runtime.client!.enableVaultPlugin(
                                      vault.id,
                                      entry.manifest.id,
                                      entry.manifest.requiredPermissions ?? []
                                    )
                                  )
                                }
                                className="rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"
                              >
                                Enable here
                              </button>
                            )
                          ) : null}
                          {entry.active && hasPrevious ? (
                            <button
                              type="button"
                              disabled={pluginBusy}
                              onClick={() =>
                                void updatePlugin(() =>
                                  runtime.client!.rollbackPlugin(entry.manifest.id)
                                )
                              }
                              className="rounded-md border px-2.5 py-1.5 text-xs [border-color:var(--layout-separator)]"
                            >
                              Roll back
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={pluginBusy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Remove ${entry.manifest.name}? Plugin files will be removed; vault settings stay recoverable.`
                                )
                              )
                                return;
                              void updatePlugin(() =>
                                runtime.client!.uninstallPlugin(
                                  entry.manifest.id,
                                  entry.manifest.version
                                )
                              );
                            }}
                            className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="grid min-h-48 place-items-center rounded-lg border border-dashed text-center [border-color:var(--layout-separator)]">
                  <div>
                    <p className="text-sm font-medium">No plugins installed</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Install a verified .symtab-plugin package to begin.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
