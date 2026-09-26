import type { PluginCapability, PluginManifest } from "@symtab/plugin-sdk";

export interface PluginBundle {
  manifest: PluginManifest;
  source: string;
  grantedCapabilities: readonly PluginCapability[];
  settings: Readonly<Record<string, unknown>>;
}

export type HostRequest =
  | { id: number; kind: "activate"; plugin: PluginBundle; vaultId: string }
  | { id: number; kind: "deactivate"; pluginId: string }
  | { id: number; kind: "event"; pluginId: string; event: string; payload: unknown };

export type WorkerMessage =
  | { kind: "result"; id: number; value?: unknown; error?: string }
  | { kind: "fatal"; pluginId: string; error: string }
  | {
      kind: "capability";
      id: number;
      pluginId: string;
      capability: PluginCapability;
      input: unknown;
    };

export type HostMessage =
  | HostRequest
  | { kind: "capability-result"; id: number; value?: unknown; error?: string };
