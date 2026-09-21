#!/usr/bin/env node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  watch,
} from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPlugin, packPlugin, packageChecksum, readManifest } from "./index.js";

export function isEntrypoint(moduleUrl: string, executablePath: string | undefined): boolean {
  if (!executablePath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(executablePath);
  } catch {
    return false;
  }
}

type DaemonDescriptor = { origin: string; token: string };

export function daemonDescriptorPath(appData = process.env.FLUX_APP_DATA_DIR): string {
  if (appData) return join(appData, "runtime", "daemon.json");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Symtab", "runtime", "daemon.json");
  if (platform() === "win32") return join(process.env.APPDATA ?? homedir(), "Symtab", "runtime", "daemon.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Symtab", "runtime", "daemon.json");
}

async function pushDevelopmentBuild(directory: string): Promise<void> {
  const root = resolve(directory);
  const build = spawnSync("bun", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error("plugin build failed");
  const temporary = mkdtempSync(join(tmpdir(), "flux-plugin-dev-"));
  try {
    const archive = packPlugin(root, join(temporary, `${basename(root)}.flux-plugin`));
    const descriptor = JSON.parse(
      readFileSync(daemonDescriptorPath(), "utf8")
    ) as DaemonDescriptor;
    if (!descriptor.origin || !descriptor.token) throw new Error("Symtab desktop runtime descriptor is invalid");
    const bytes = readFileSync(archive);
    const response = await fetch(`${descriptor.origin}/api/v1/plugins/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flux-Desktop-Token": descriptor.token,
      },
      body: JSON.stringify({
        packageBase64: bytes.toString("base64"),
        sha256: packageChecksum(archive),
        development: true,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Symtab returned ${response.status}`);
    }
    console.log(`Reloaded ${readManifest(root).name ?? basename(root)}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, path = ".", ...rest] = args;
  if (!command || command === "help" || command === "--help") {
    console.log(
      "Usage: create-flux-plugin <directory> | flux-plugin validate [directory] | flux-plugin pack [directory] [--out file] | flux-plugin dev [directory]"
    );
    return;
  }
  if (command === "validate") {
    readManifest(path);
    console.log("Valid Symtab plugin manifest");
    return;
  }
  if (command === "pack") {
    const outIndex = rest.indexOf("--out");
    const output = outIndex >= 0 ? rest[outIndex + 1] : undefined;
    if (outIndex >= 0 && !output) throw new Error("--out requires a file path");
    const packed = packPlugin(path, output);
    console.log(`${packed}\nSHA256 ${packageChecksum(packed)}`);
    return;
  }
  if (command === "dev") {
    const root = resolve(path);
    if (!existsSync(join(root, "flux.plugin.json"))) throw new Error("flux.plugin.json not found");
    let running = false;
    let queued = false;
    let timer: NodeJS.Timeout | undefined;
    const rebuild = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        await pushDevelopmentBuild(root);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
        if (queued) {
          queued = false;
          void rebuild();
        }
      }
    };
    await rebuild();
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 150);
    };
    watch(join(root, "src"), { recursive: true }, schedule);
    watch(root, (_event, filename) => {
      if (filename === "flux.plugin.json") schedule();
    });
    console.log("Watching src and flux.plugin.json. Ctrl+C to stop.");
    return;
  }
  if (command === "create") {
    console.log(createPlugin(path));
    return;
  }
  console.log(createPlugin(command));
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
