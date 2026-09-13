import { describe, expect, test } from "bun:test";
import { isNewerVersion, parseMacRelease } from "../src/main/github-release";

const asset = {
  name: "Symtab-0.0.2-arm64.dmg",
  browser_download_url:
    "https://github.com/wizaye/project-flux/releases/download/v0.0.2/Symtab-0.0.2-arm64.dmg",
  digest: `sha256:${"a".repeat(64)}`,
  size: 123,
};
describe("DMG-only updates", () => {
  test("selects only the matching architecture and checks versions numerically", () => {
    const release = parseMacRelease({ tag_name: "v0.0.2", assets: [asset] }, "arm64");
    expect(release.asset.sha256).toBe("a".repeat(64));
    expect(isNewerVersion(release.version, "0.0.1")).toBe(true);
    expect(isNewerVersion("0.0.2", "0.0.2")).toBe(false);
    expect(isNewerVersion("0.0.10", "0.0.2")).toBe(true);
    expect(() => parseMacRelease({ tag_name: "v0.0.2", assets: [asset] }, "x64")).toThrow();
  });
  test("fails closed without a checksum or with a foreign download URL", () => {
    for (const patch of [
      { digest: null },
      { size: 0 },
      { browser_download_url: "https://evil.invalid/update.dmg" },
    ]) {
      expect(() =>
        parseMacRelease({ tag_name: "v0.0.2", assets: [{ ...asset, ...patch }] }, "arm64")
      ).toThrow();
    }
  });
});
