import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { formatReleaseNotes } from "../src/main/update-notes";
import { isDownloadedMacInstaller } from "../src/main/downloaded-installer";

describe("formatReleaseNotes", () => {
  test("normalizes updater strings and versioned note lists", () => {
    expect(formatReleaseNotes("Fixed sync")).toBe("Fixed sync");
    expect(
      formatReleaseNotes([
        { version: "0.2.0", note: "Added notifications" },
        { version: "0.1.1", note: "Fixed startup" },
      ])
    ).toBe("## 0.2.0\n\nAdded notifications\n\n## 0.1.1\n\nFixed startup");
    expect(formatReleaseNotes({ note: "ignored" })).toBeUndefined();
  });
});

test("only FLUX updater DMGs qualify for post-install cleanup", () => {
  expect(isDownloadedMacInstaller("FLUX-0.0.2-arm64.dmg")).toBe(true);
  expect(isDownloadedMacInstaller("FLUX-1.2.3-beta.1-x64.dmg")).toBe(true);
  expect(isDownloadedMacInstaller("family-photos.dmg")).toBe(false);
  expect(isDownloadedMacInstaller("FLUX-0.0.2-arm64.dmg.part")).toBe(false);
});

test("desktop releases ship DMGs and expose a verified install path", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    build: {
      publish: { provider: string; owner: string; repo: string };
      mac: { target: string[]; identity: null };
    };
  };
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../src/main/installer.ts", import.meta.url), "utf8");
  const serverMain = readFileSync(new URL("../../../server/main.go", import.meta.url), "utf8");

  expect(packageJson.build.publish).toMatchObject({
    provider: "github",
    owner: "wizaye",
    repo: "project-flux",
  });
  expect(packageJson.build.mac.target).toEqual(["dmg"]);
  expect(packageJson.build.mac.identity).toBeNull();
  expect(main).toContain('ipcMain.handle("install-update"');
  expect(main).toContain("autoUpdater.quitAndInstall(false, true)");
  expect(main).toContain("FLUX_VERSION: app.getVersion()");
  expect(main).toContain('autoUpdater.on("download-progress"');
  expect(main).toContain('autoUpdater.on("update-downloaded"');
  expect(installer).toContain('createHash("sha256")');
  expect(installer).toContain("transferred !== asset.size");
  expect(installer).toContain("openMacInstaller");
  expect(serverMain).toContain('os.Getenv("FLUX_VERSION")');
});
