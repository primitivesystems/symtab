const repository = "primitivesystems/project-flux";

export type MacRelease = {
  version: string;
  releaseName: string;
  releaseNotes: string;
  asset: { name: string; url: string; size: number; sha256: string };
};

export function parseMacRelease(value: unknown, arch: string): MacRelease {
  if (!value || typeof value !== "object") throw new Error("Invalid release response");
  const release = value as Record<string, unknown>;
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
  if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease) {
    throw new Error("Expected a published stable release");
  }
  const name = `Symtab-${version}-${arch}.dmg`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item: Record<string, unknown>) => item?.name === name)
    : undefined;
  const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  if (
    !asset ||
    asset.browser_download_url !== url ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error(`Release has no valid ${arch} DMG`);
  }
  if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error("GitHub did not supply the DMG checksum; download refused");
  }
  return {
    version,
    releaseName: typeof release.name === "string" ? release.name : version,
    releaseNotes: typeof release.body === "string" ? release.body : "",
    asset: { name, url, size: asset.size, sha256: asset.digest.slice(7) },
  };
}

export function isNewerVersion(candidate: string, current: string) {
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error("Invalid installed version");
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

export async function fetchMacRelease(arch: string): Promise<MacRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  return parseMacRelease(await response.json(), arch);
}
