/// <reference lib="webworker" />

import type {
  CapabilityDefinitions,
  SymtabPlugin,
  PluginCapability,
  PluginContext,
} from "@symtab/plugin-sdk";
import { loadPlugin } from "./sandbox";
import type { HostMessage, HostRequest, WorkerMessage } from "./protocol";

interface ActivePlugin {
  instance: SymtabPlugin;
  listeners: Map<string, Set<(payload: unknown) => void | Promise<void>>>;
  abort: AbortController;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const plugins = new Map<string, ActivePlugin>();
const capabilityCalls = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
let nextCapabilityCall = 1;
let operations: Promise<void> = Promise.resolve();
let lastPluginId: string | undefined;

function send(message: WorkerMessage): void {
  scope.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invokeCapability(
  pluginId: string,
  capability: PluginCapability,
  input: unknown
): Promise<unknown> {
  const id = nextCapabilityCall++;
  return new Promise((resolve, reject) => {
    capabilityCalls.set(id, { resolve, reject });
    send({ kind: "capability", id, pluginId, capability, input });
  });
}

async function activate(request: Extract<HostRequest, { kind: "activate" }>): Promise<void> {
  const pluginId = request.plugin.manifest.id;
  if (plugins.has(pluginId)) throw new Error(`plugin already active: ${pluginId}`);
  const granted = new Set<PluginCapability>(request.plugin.grantedCapabilities);
  const instance = await loadPlugin(request.plugin.source, pluginId);
  const active: ActivePlugin = {
    instance,
    listeners: new Map(),
    abort: new AbortController(),
  };
  const context: PluginContext = {
    manifest: request.plugin.manifest,
    vaultId: request.vaultId,
    signal: active.abort.signal,
    capabilities: {
      has: (capability) => granted.has(capability),
      invoke: <K extends keyof CapabilityDefinitions>(
        capability: K,
        input: CapabilityDefinitions[K]["input"]
      ) => {
        if (!granted.has(capability)) {
          return Promise.reject(new Error(`capability not granted: ${capability}`));
        }
        return invokeCapability(pluginId, capability, input) as Promise<
          CapabilityDefinitions[K]["output"]
        >;
      },
    },
    settings: {
      get: <T = unknown>(id: string) => request.plugin.settings[id] as T | undefined,
      all: () => Object.freeze({ ...request.plugin.settings }),
    },
    on: (event, listener) => {
      const listeners = active.listeners.get(event) ?? new Set();
      listeners.add(listener);
      active.listeners.set(event, listeners);
      return () => listeners.delete(listener);
    },
  };
  plugins.set(pluginId, active);
  try {
    await instance.activate(context);
  } catch (error) {
    plugins.delete(pluginId);
    active.abort.abort();
    throw error;
  }
}

async function deactivate(pluginId: string): Promise<void> {
  const active = plugins.get(pluginId);
  if (!active) return;
  plugins.delete(pluginId);
  active.abort.abort();
  await active.instance.deactivate?.();
}

async function dispatch(pluginId: string, event: string, payload: unknown): Promise<void> {
  const active = plugins.get(pluginId);
  if (!active) throw new Error(`plugin is not active: ${pluginId}`);
  const listeners = [...(active.listeners.get(event) ?? [])];
  for (const listener of listeners) await listener(payload);
}

async function handleRequest(request: HostRequest): Promise<unknown> {
  switch (request.kind) {
    case "activate":
      return activate(request);
    case "deactivate":
      return deactivate(request.pluginId);
    case "event":
      return dispatch(request.pluginId, request.event, request.payload);
  }
}

scope.onmessage = (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.kind === "capability-result") {
    const pending = capabilityCalls.get(message.id);
    if (!pending) return;
    capabilityCalls.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
    return;
  }
  operations = operations.then(async () => {
    lastPluginId =
      message.kind === "activate" ? message.plugin.manifest.id : message.pluginId;
    try {
      const value = await handleRequest(message);
      send({ kind: "result", id: message.id, value });
    } catch (error) {
      send({ kind: "result", id: message.id, error: errorMessage(error) });
    }
  });
};

scope.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  event.preventDefault();
  if (lastPluginId) {
    send({ kind: "fatal", pluginId: lastPluginId, error: errorMessage(event.reason) });
  }
});
