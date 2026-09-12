import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { WorkbenchHeader } from "../src/components/design-system/workbench/chrome/workbench-header";

test("AI and reference sidebar toggles remain separate header controls", () => {
  const html = renderToStaticMarkup(<WorkbenchHeader
    title="Flux" leftPaneOpen rightPaneOpen showAI aiPaneOpen
    onCommand={() => {}} onToggleLeftPane={() => {}} onToggleRightPane={() => {}}
    onToggleAI={() => {}}
  />);
  expect(html).toContain('aria-label="Toggle AI chat"');
  expect(html).toContain('aria-label="Toggle secondary pane"');
  const app = readFileSync(new URL("../../app-core/src/App.tsx", import.meta.url), "utf8");
  expect(app).toContain("const chat = useAgentChat(");
  expect(app).toContain("chat={runtime.client");
});

test("header retains download state and percentage on every progress event", () => {
  for (const progress of [0, 24, 75, 100]) {
    const html = renderToStaticMarkup(<WorkbenchHeader
      title="Flux" leftPaneOpen rightPaneOpen
      onCommand={() => {}} onToggleLeftPane={() => {}} onToggleRightPane={() => {}}
      updateStatus="downloading" updateProgress={progress}
      onDownloadUpdate={() => {}} onOpenReleaseNotes={() => {}}
    />);
    expect(html).toContain(`Downloading ${progress}%`);
    expect(html).not.toContain("Download update");
  }
});

test("changelog binds runtime progress and gives its scrollbar a bounded viewport", () => {
  const dialog = readFileSync(new URL("../src/components/design-system/workbench/chrome/release-notes-dialog.tsx", import.meta.url), "utf8");
  const workbench = readFileSync(new URL("../src/components/design-system/workbench.tsx", import.meta.url), "utf8");
  expect(dialog).toContain('ScrollArea className="h-[min(24rem,45dvh)] min-h-0"');
  expect(dialog).toContain("Math.round(downloadProgress)");
  expect(workbench).toContain("downloadProgress={updateProgress}");
});
