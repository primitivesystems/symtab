import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the native capture query reaches the capture view rather than the workspace", () => {
  const entry = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  expect(main).toContain('url.searchParams.set("quickCapture", "1")');
  expect(entry).toContain(
    'new URLSearchParams(window.location.search).get("quickCapture") === "1"'
  );
  expect(entry).toContain("<QuickCapture runtime={desktopRuntime} />");
});

test("hiding Quick Capture releases its renderer", () => {
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  expect(main).toContain("if (!window) return;");
  expect(main).toContain("if (window === quickCaptureWindow) window.destroy();");
});
