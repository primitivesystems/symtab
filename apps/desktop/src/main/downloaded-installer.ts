export function isDownloadedMacInstaller(name: string) {
  return /^FLUX-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:arm64|x64)\.dmg$/.test(name);
}
