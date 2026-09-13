import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("v1 desktop does not expose quick capture", () => {
  const entry = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  expect(main).not.toContain('url.searchParams.set("quickCapture", "1")');
  expect(entry).not.toContain("<QuickCapture runtime={desktopRuntime} />");
});
