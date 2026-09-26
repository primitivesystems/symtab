import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createPlugin,
  packPlugin,
  packageChecksum,
  readManifest,
  validateManifest,
} from "../src/index";

const roots: string[] = [];

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "symtab-plugin-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plugin tooling", () => {
  test("scaffolds a valid external plugin", () => {
    const root = join(temporary(), "hello-symtab");
    createPlugin(root);
    expect(readManifest(root).id).toBe("hello-symtab");
    const source = readFileSync(join(root, "src/main.ts"), "utf8");
    expect(source).toContain("definePlugin");
    expect(source).not.toContain("console.");
    const packageJSON = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(packageJSON.scripts.build).toContain("--format iife");
  });

  test("rejects invalid permissions", () => {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        id: "bad-plugin",
        name: "Bad",
        version: "1.0.0",
        apiVersion: "1",
        entry: "dist/main.js",
        requiredPermissions: ["Shell exec"],
      })
    ).toThrow("invalid capability");
  });

  test("validates scoped UI contributions", () => {
    const manifest = {
      schemaVersion: 1,
      id: "example.plugin",
      name: "Example",
      version: "1.0.0",
      apiVersion: "1",
      entry: "dist/main.js",
      contributes: {
        commands: [{ id: "example.plugin.open", title: "Open" }],
        views: [
          {
            id: "example.plugin.panel",
            title: "Panel",
            entry: "dist/panel.html",
            location: "right-sidebar",
            icon: "panel-right",
            iconPath: "dist/icon.svg",
          },
        ],
        settings: [{ id: "example.plugin.limit", title: "Limit", type: "number", default: 10 }],
      },
    };
    expect(validateManifest(manifest)).toBe(manifest);
    manifest.contributes.commands[0]!.id = "other.open";
    expect(() => validateManifest(manifest)).toThrow("must be scoped");
  });

  test("rejects unsafe view locations and icons", () => {
    const view = {
      id: "example.plugin.panel",
      title: "Panel",
      entry: "dist/panel.html",
      location: "right-sidebar",
      icon: "panel-right",
    };
    const manifest = {
      schemaVersion: 1,
      id: "example.plugin",
      name: "Example",
      version: "1.0.0",
      apiVersion: "1",
      entry: "dist/main.js",
      contributes: { views: [view] },
    };
    view.location = "host-dom";
    expect(() => validateManifest(manifest)).toThrow("location must be");
    view.location = "modal";
    view.icon = "<svg>";
    expect(() => validateManifest(manifest)).toThrow("supported built-in icon");
    view.icon = "panel-right";
    view.iconPath = "../icon.svg";
    expect(() => validateManifest(manifest)).toThrow("clean relative .svg path");
  });

  test("packs built files as a checksumed ZIP", () => {
    const root = join(temporary(), "packed-plugin");
    createPlugin(root);
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/main.js"), "export default {};\n");
    const output = packPlugin(root);
    expect(packPlugin(root)).toBe(output);
    const bundle = readFileSync(output);
    expect(bundle.readUInt32LE(0)).toBe(0x04034b50);
    expect(packageChecksum(output)).toMatch(/^[a-f0-9]{64}$/);
  });
});
