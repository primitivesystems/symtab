import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("workbench has no fake workspace files or preview content", () => {
  const source = read("../src/components/design-system/workbench.tsx");
  const explorer = read("../src/components/design-system/workbench/sidebar/primary-sidebar.tsx");
  expect(source).not.toContain("function previewFor");
  expect(explorer).not.toContain("const FILES");
});

test("available updates notify first and only show header action after download starts", () => {
  const source = read("../src/components/design-system/workbench.tsx");
  const center = read("../src/components/design-system/workbench/chrome/notification-center.tsx");
  expect(source).toContain('downloadStatus !== "available"');
  expect(source).toContain("notifications={notifications}");
  expect(center).toContain("setOpen(true)");
});

test("v1 workbench trims non-core activity entries", () => {
  const source = read("../src/components/design-system/workbench.tsx");
  expect(source).toContain('{ id: "explorer", label: "Explorer", icon: "files" }');
  expect(source).toContain('{ id: "search", label: "Search", icon: "search" }');
  expect(source).toContain('{ id: "graph", label: "Graph", icon: "type-hierarchy" }');
  expect(source).not.toContain('label: "Source Control"');
  expect(source).not.toContain('label: "Run and Debug"');
  expect(source).not.toContain('label: "Extensions"');
  expect(source).not.toContain('label: "Journal"');
});

test("right sidebar keeps chat optional and reference views separate", () => {
  const source = read("../src/components/design-system/workbench/sidebar/secondary-sidebar.tsx");
  const header = read("../src/components/design-system/workbench/chrome/workbench-header.tsx");
  const workbench = read("../src/components/design-system/workbench.tsx");
  for (const view of ["Chat", "Backlinks", "Outgoing links", "Tags", "Properties", "Outline"])
    expect(source).toContain(view);
  expect(source).toContain('view === "chat"');
  expect(header).toContain('showAI ? (');
  expect(workbench).toContain('showAI={supportsChat}');
});

test("explorer renames inline and offers archive separately from trash", () => {
  const source = read("../src/components/design-system/workbench/sidebar/primary-sidebar.tsx");
  expect(source).toContain("InlineRename");
  expect(source).toContain("Move to archive");
  expect(source).toContain("Move to trash");
  expect(source).not.toContain('{ kind: "rename"');
  expect(source).toContain("cancelled.current = true");
});

test("onboarding only completes from its final action", () => {
  const page = read(
    "../src/components/design-system/workbench/chrome/onboarding/onboarding-page.tsx"
  );
  const workspaceForm = read(
    "../src/components/design-system/workbench/chrome/onboarding/onboarding-workspace-form.tsx"
  );
  expect(page).toContain("onCreateWorkspace");
  expect(workspaceForm).toContain("onCreate");
  expect(workspaceForm).toContain("onOpenVault");
  expect(workspaceForm).toContain("Choose existing workspace");
});
