import { describe, expect, test } from "bun:test";
import { loadPlugin } from "../src/sandbox";

describe("plugin sandbox", () => {
  test("loads the SDK's generated IIFE bundle contract", async () => {
    const build = await Bun.build({
      entrypoints: [new URL("./fixture-plugin.ts", import.meta.url).pathname],
      format: "iife",
      target: "browser",
    });
    expect(build.success).toBe(true);
    const plugin = await loadPlugin(await build.outputs[0]!.text(), "built.plugin");
    await plugin.activate({
      capabilities: { has: () => true },
    } as never);
  });

  test("loads a self-contained default export without ambient authority", async () => {
    const plugin = await loadPlugin(
      `__symtabRegisterPlugin({
        activate(context) {
          context.probe({
            fetch: typeof fetch,
            websocket: typeof WebSocket,
            process: typeof process,
            require: typeof require
          });
        }
      })`,
      "safe.plugin"
    );
    let probe: unknown;
    await plugin.activate({ probe: (value: unknown) => (probe = value) } as never);
    expect(probe).toEqual({
      fetch: "undefined",
      websocket: "undefined",
      process: "undefined",
      require: "undefined",
    });
  });

  test("provides safe console logging", async () => {
    const plugin = await loadPlugin(
      `__symtabRegisterPlugin({ activate() { console.info("plugin ready"); } })`,
      "logging.plugin"
    );
    expect(() => plugin.activate({} as never)).not.toThrow();
  });

  test("rejects bundles with imports", async () => {
    await expect(
      loadPlugin(`import value from "outside"; export default value;`, "unsafe.plugin")
    ).rejects.toThrow("self-contained IIFE");
  });

  test("gives each plugin a private compartment global", async () => {
    const first = await loadPlugin(
      `globalThis.privateValue = "first";
       __symtabRegisterPlugin({ activate(context) { context.probe(globalThis.privateValue); } });`,
      "first.plugin"
    );
    const second = await loadPlugin(
      `__symtabRegisterPlugin({ activate(context) { context.probe(globalThis.privateValue); } });`,
      "second.plugin"
    );
    const values: unknown[] = [];
    await first.activate({ probe: (value: unknown) => values.push(value) } as never);
    await second.activate({ probe: (value: unknown) => values.push(value) } as never);
    expect(values).toEqual(["first", undefined]);
  });
});
