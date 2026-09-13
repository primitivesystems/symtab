import { app, shell } from "electron";
import type { MacRelease } from "./github-release";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type InstallerPlatform = "darwin" | "win32" | "linux";

export function getPlatformInstaller(): InstallerPlatform {
  if (process.platform === "darwin" || process.platform === "win32" || process.platform === "linux")
    return process.platform;
  throw new Error(`Unsupported platform: ${process.platform}`);
}

export async function downloadMacUpdate(
  info: MacRelease,
  onProgress: (percent: number, transferred: number, total: number) => void
) {
  const { asset } = info;
  const name = asset.name;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`DMG download failed (${response.status})`);

  const directory = path.join(app.getPath("temp"), "symtab-updates");
  const destination = path.join(directory, name);
  const partial = `${destination}.part`;
  const total = asset.size;
  const hash = createHash("sha256");
  let transferred = 0;
  await mkdir(directory, { recursive: true });

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          transferred += chunk.length;
          onProgress(total ? (transferred / total) * 100 : 0, transferred, total);
          callback(null, chunk);
        },
      }),
      createWriteStream(partial)
    );
    if (transferred !== asset.size || hash.digest("hex") !== asset.sha256) {
      throw new Error("DMG checksum or size verification failed");
    }
    await unlink(destination).catch(() => undefined);
    await rename(partial, destination);
    return destination;
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}

export async function openMacInstaller(dmgPath: string) {
  await access(dmgPath);
  const error = await shell.openPath(dmgPath);
  if (error) throw new Error(`Failed to open installer: ${error}`);
  app.quit();
}
