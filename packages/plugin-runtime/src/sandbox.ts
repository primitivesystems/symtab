import "ses";
import type { FluxPlugin } from "@flux/plugin-sdk";

let locked = false;

function lockRealm(): void {
  if (locked) return;
  lockdown({ errorTaming: "safe", stackFiltering: "concise" });
  locked = true;
}

function isPlugin(value: unknown): value is FluxPlugin {
  return !!value && typeof value === "object" && typeof (value as FluxPlugin).activate === "function";
}

/** Loads a self-contained registration bundle in its own hardened JavaScript compartment. */
export async function loadPlugin(source: string, pluginId: string): Promise<FluxPlugin> {
  lockRealm();
  let plugin: FluxPlugin | undefined;
  const pluginConsole = harden({
    debug: console.debug.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  });
  const register = harden((candidate: unknown) => {
    if (plugin !== undefined) throw new Error("plugin entry registered more than once");
    if (!isPlugin(candidate)) throw new Error("plugin entry registered an invalid plugin");
    plugin = candidate;
  });
  const compartment = new Compartment(
    { __fluxRegisterPlugin: register, console: pluginConsole },
    {},
    { name: `flux-plugin:${pluginId}` }
  );
  try {
    compartment.evaluate(source);
  } catch (error) {
    throw new Error(
      `plugin entry must be a self-contained IIFE bundle: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  if (plugin === undefined) throw new Error("plugin entry did not register a Symtab plugin");
  return plugin;
}
