export const pluginCapabilities = [
  "vault.read",
  "vault.write",
  "vault.move",
  "vault.delete",
  "vault.search",
  "documents.parse",
  "tasks.query",
  "tasks.update",
  "ui.command",
  "ui.view",
  "ui.external",
  "network.fetch",
  "background.run",
  "git.status",
  "git.init",
  "git.stage",
  "git.unstage",
  "git.commit",
  "git.pull",
  "git.push",
  "git.fetch",
  "git.remote.set",
  "git.remote.remove",
  "git.diff",
  "git.discard",
  "git.branches",
  "git.checkout",
  "git.branch.create",
  "git.history",
  "git.resolve",
  "ai.providers",
  "ai.chat",
] as const;

export type PluginCapability = (typeof pluginCapabilities)[number];

export type PluginActivationEvent = "onVaultOpen" | `onCommand:${string}` | `onFileType:${string}`;

export interface PluginCommandContribution {
  id: string;
  title: string;
}

export const pluginViewLocations = [
  "modal",
  "left-sidebar",
  "right-sidebar",
  "workspace",
] as const;

export type PluginViewLocation = (typeof pluginViewLocations)[number];

export const pluginViewIcons = [
  "puzzle",
  "sparkles",
  "panel-left",
  "panel-right",
  "layout-dashboard",
  "calendar",
  "list",
  "git-branch",
] as const;

export type PluginViewIcon = (typeof pluginViewIcons)[number];

export interface PluginViewContribution {
  id: string;
  title: string;
  entry: string;
  /** Host surface. Omitted manifests open in a modal for backward compatibility. */
  location?: PluginViewLocation;
  /** Safe host-rendered icon name. Arbitrary SVG/HTML is not accepted. */
  icon?: PluginViewIcon;
  /** Optional packaged SVG, for example `dist/icon.svg`. Takes precedence over `icon`. */
  iconPath?: string;
}

export type PluginSettingContribution =
  | { id: string; title: string; description?: string; type: "string"; default?: string }
  | { id: string; title: string; description?: string; type: "number"; default?: number }
  | { id: string; title: string; description?: string; type: "boolean"; default?: boolean };

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  publisher?: string;
  entry: string;
  activationEvents?: PluginActivationEvent[];
  requiredPermissions?: PluginCapability[];
  optionalPermissions?: PluginCapability[];
  contributes?: {
    commands?: PluginCommandContribution[];
    views?: PluginViewContribution[];
    settings?: PluginSettingContribution[];
  };
}

export interface CapabilityDefinitions {
  "vault.read": {
    input: { path: string };
    output: { path: string; content: string; contentHash: string };
  };
  "vault.write": {
    input: { path: string; content: string; expectedHash?: string };
    output: { path: string; contentHash: string };
  };
  "vault.move": {
    input: { from: string; to: string; expectedHash?: string };
    output: { path: string };
  };
  "vault.delete": {
    input: { path: string; expectedHash?: string };
    output: { path: string };
  };
  "vault.search": {
    input: { query: string; limit?: number };
    output: { results: Array<{ path: string; title: string; excerpt: string }> };
  };
  "documents.parse": { input: { path: string }; output: unknown };
  "tasks.query": { input: { query?: string }; output: unknown };
  "tasks.update": { input: unknown; output: unknown };
  "ui.command": { input: unknown; output: unknown };
  "ui.view": { input: unknown; output: unknown };
  "ui.external": { input: { url: string }; output: { opened: boolean } };
  "network.fetch": {
    input: { url: string; method?: string; headers?: Record<string, string>; body?: string };
    output: { status: number; headers: Record<string, string>; body: string };
  };
  "background.run": { input: unknown; output: unknown };
  "git.status": {
    input: Record<string, never>;
    output: {
      available: boolean;
      initialized: boolean;
      branch?: string;
      upstream?: string;
      origin?: string;
      remotes: Array<{ name: string; url: string }>;
      ahead: number;
      behind: number;
      changes: Array<{
        path: string;
        originalPath?: string;
        indexStatus: string;
        worktreeStatus: string;
      }>;
    };
  };
  "git.init": { input: Record<string, never>; output: { enabled: boolean } };
  "git.stage": { input: { paths?: string[] }; output: { updated: boolean } };
  "git.unstage": { input: { paths?: string[] }; output: { updated: boolean } };
  "git.commit": { input: { message: string; paths?: string[] }; output: { committed: boolean } };
  "git.pull": { input: Record<string, never>; output: { updated: boolean } };
  "git.push": { input: { remote?: string }; output: { updated: boolean } };
  "git.fetch": { input: Record<string, never>; output: { updated: boolean } };
  "git.remote.set": { input: { name: string; url: string }; output: { updated: boolean } };
  "git.remote.remove": { input: { name: string }; output: { updated: boolean } };
  "git.diff": { input: { path: string; staged?: boolean }; output: { path: string; staged: boolean; content: string } };
  "git.discard": { input: { paths: string[] }; output: { updated: boolean } };
  "git.branches": { input: Record<string, never>; output: { branches: Array<{ name: string; current: boolean }> } };
  "git.checkout": { input: { branch: string }; output: { updated: boolean } };
  "git.branch.create": { input: { branch: string }; output: { updated: boolean } };
  "git.history": { input: { limit?: number }; output: { commits: Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }> } };
  "git.resolve": { input: { path: string; strategy: "ours" | "theirs" }; output: { updated: boolean } };
  "ai.providers": {
    input: Record<string, never>;
    output: Array<{
      id: string;
      type: string;
      name: string;
      enabled: boolean;
      available: boolean;
      models?: string[];
      capabilities: string[];
    }>;
  };
  "ai.chat": {
    input: {
      provider: string;
      model?: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      stream?: boolean;
    } | { streamId: string };
    output: { reply: string; streamId?: string; done?: boolean; error?: string };
  };
}

export interface PluginCapabilityClient {
  has(capability: PluginCapability): boolean;
  invoke<K extends keyof CapabilityDefinitions>(
    capability: K,
    input: CapabilityDefinitions[K]["input"]
  ): Promise<CapabilityDefinitions[K]["output"]>;
}

export interface PluginSettings {
  get<T = unknown>(id: string): T | undefined;
  all(): Readonly<Record<string, unknown>>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly vaultId: string;
  readonly signal: AbortSignal;
  readonly capabilities: PluginCapabilityClient;
  readonly settings: PluginSettings;
  on(event: string, listener: (payload: unknown) => void | Promise<void>): () => void;
}

export interface SymtabPlugin {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export function definePlugin<T extends SymtabPlugin>(plugin: T): T {
  const register = (
    globalThis as typeof globalThis & {
      __symtabRegisterPlugin?: (candidate: SymtabPlugin) => void;
    }
  ).__symtabRegisterPlugin;
  if (typeof register === "function") register(plugin);
  return plugin;
}
