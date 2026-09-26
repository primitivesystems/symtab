import "ses";
import type { SymtabPlugin } from "@symtab/plugin-sdk";

let locked = false;

function lockRealm(): void {
  if (locked) return;
  lockdown({ errorTaming: "safe", stackFiltering: "concise" });
  locked = true;
}

function isPlugin(value: unknown): value is SymtabPlugin {
  return !!value && typeof value === "object" && typeof (value as SymtabPlugin).activate === "function";
}

/** Loads a self-contained registration bundle in its own hardened JavaScript compartment. */
export async function loadPlugin(source: string, pluginId: string): Promise<SymtabPlugin> {
  lockRealm();
  let plugin: SymtabPlugin | undefined;
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
    { __symtabRegisterPlugin: register, console: pluginConsole },
    {},
    { name: `symtab-plugin:${pluginId}` }
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
