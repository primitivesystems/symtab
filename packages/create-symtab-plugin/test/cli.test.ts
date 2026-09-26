import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "bun:test";
import { daemonDescriptorPath, isEntrypoint } from "../src/cli";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recognizes a linked executable as the CLI entrypoint", () => {
  const root = mkdtempSync(join(tmpdir(), "symtab-plugin-cli-"));
  roots.push(root);
  const target = join(root, "cli.js");
  const link = join(root, "symtab-plugin");
  writeFileSync(target, "#!/usr/bin/env node\n");
  symlinkSync(target, link);

  expect(isEntrypoint(pathToFileURL(target).href, link)).toBe(true);
});

test("uses explicit app data for the daemon descriptor", () => {
  expect(daemonDescriptorPath("/tmp/symtab-test")).toBe("/tmp/symtab-test/runtime/daemon.json");
});
