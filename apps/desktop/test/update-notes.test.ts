import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { formatReleaseNotes } from "../src/main/update-notes";

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

test("desktop releases ship DMGs and expose a verified install path", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    build: {
      productName: string;
      publish: { provider: string; owner: string; repo: string };
      mac: { target: string[]; identity: null; icon: string };
      win: { icon: string };
      linux: { icon: string };
    };
  };
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../src/main/installer.ts", import.meta.url), "utf8");
  const serverMain = readFileSync(new URL("../../../server/main.go", import.meta.url), "utf8");

  expect(packageJson.build.publish).toMatchObject({
    provider: "github",
    owner: "primitivesystems",
    repo: "project-flux",
  });
  expect(packageJson.build.productName).toBe("Symtab");
  expect(packageJson.build.mac.icon).toBe("assets/icon.icns");
  expect(packageJson.build.win.icon).toBe("assets/icon.ico");
  expect(packageJson.build.linux.icon).toBe("assets/icon.png");
  expect(packageJson.build.mac.target).toEqual(["dmg"]);
  expect(packageJson.build.mac.identity).toBeNull();
  expect(main).toContain('ipcMain.handle("install-update"');
  expect(main).toContain("autoUpdater.quitAndInstall(false, true)");
  expect(main).toContain("FLUX_VERSION: app.getVersion()");
  expect(main).toContain("existsSync(current) || !existsSync(legacy) ? current : legacy");
  expect(main).toContain('app.setName("Symtab")');
  expect(main).toContain('"dock-icon-dark.png"');
  expect(main).toContain("app.dock?.setIcon(nativeImage.createFromPath(dockIconPath()))");
  expect(main).toContain("nativeImage.createFromPath(menuBarIconPath())");
  expect(main).not.toContain("data:image/png;base64");
  expect(main).toContain('autoUpdater.on("download-progress"');
  expect(main).toContain('autoUpdater.on("update-downloaded"');
  expect(installer).toContain('createHash("sha256")');
  expect(installer).toContain("transferred !== asset.size");
  expect(installer).toContain("openMacInstaller");
  expect(serverMain).toContain('os.Getenv("FLUX_VERSION")');
});
