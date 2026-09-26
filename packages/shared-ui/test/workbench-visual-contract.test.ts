import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { getWorkbenchTheme } from "../src/components/design-system/workbench/workbench-theme";

describe("workbench visual contract", () => {
  test("search, tags, and backlinks reuse the explorer panel surface", () => {
    const source = readFileSync(
      new URL("../src/components/design-system/workbench.tsx", import.meta.url),
      "utf8"
    );
    for (const label of ["Search", "Tags", "Backlinks"]) {
      expect(source).toContain(`<WorkbenchPanel aria-label="${label}"`);
    }
  });
  test("standalone windows and portals inherit a semantic separator", () => {
    const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/:root\s*\{[^}]*--layout-separator:\s*var\(--border\)/);
  });
  test("packaged Electron views load the bundled in-app logo relatively", () => {
    const onboarding = readFileSync(
      new URL(
        "../src/components/design-system/workbench/chrome/onboarding-page.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const editor = readFileSync(
      new URL(
        "../src/components/design-system/workbench/editor/editor-surface.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(onboarding).toContain('src="./logo.png"');
    expect(editor).toContain('src="./logo.png"');
  });
  test("sidebar toggles preserve the editor and use the v1 knowledge pane, not AI", () => {
    const source = readFileSync(
      new URL("../src/components/design-system/workbench.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("key={panelLayoutKey}");
    expect(source).toContain('id="workbench-panes"');
    expect(source).toContain("panelRef={editorPanel}");
    expect(source).toContain("panelRef={secondaryPanel}");
    expect(source).toContain("{renderSecondary(");
    expect(source).not.toContain("<SecondarySidebar");
    expect(source).toContain("activityItems.some(({ id }) => id === shell.activeActivity)");
  });
  test("footer constrains popover triggers as well as regular buttons to the bar height", () => {
    const source = readFileSync(
      new URL(
        "../src/components/design-system/workbench/chrome/workbench-footer.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toContain("[&_button]:h-[22px]");
    expect(source).toContain("minmax(max-content,1fr)");
  });
  test("active tabs separate from their strip in both themes", () => {
    const dark = getWorkbenchTheme("dark") as Record<string, string>;
    const light = getWorkbenchTheme("light") as Record<string, string>;

    expect(dark["--workbench-tab-bar"]).toBe("#181818");
    expect(dark["--workbench-tab-active"]).toBe("#2b2b2b");
    expect(light["--workbench-tab-bar"]).toBe("#ffffff");
    expect(light["--workbench-tab-active"]).toBe("#e8e8e8");
  });

  test("workbench scrollbars and PDF printing have scoped CSS", () => {
    const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("[data-workbench]");
    expect(css).toContain("--workbench-scrollbar-thumb");
    expect(css).toContain(".symtab-print-document");
    expect(css).toContain("@media print");
    expect(css).toContain("white-space: pre-wrap");
    expect(css).toContain("body > :not(.symtab-print-document)");
    expect(css).toContain("height: auto !important");
    expect(css).toContain("var(--symtab-print-margin, 18mm)");
  });

  test("updater keeps its blue staged-action treatment", () => {
    const source = readFileSync(
      new URL("../src/components/design-system/button-with-dropdown.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("from-blue-500");
    expect(source).toContain("to-blue-700");
    expect(source).toContain("Downloaded");
    expect(source).toContain("Verifying package…");
    expect(source).toContain("Click to install");
  });

  test("shared buttons animate only properties they change", () => {
    const source = readFileSync(
      new URL("../src/components/ui/button.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("transition-all");
    expect(source).toContain("active:not-aria-[haspopup]:scale-[0.96]");
    expect(source).toContain("motion-reduce:transition-none");
  });

  test("single-file editor avoids a redundant breadcrumb row", () => {
    const source = readFileSync(
      new URL(
        "../src/components/design-system/workbench/editor/editor-surface.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toContain("breadcrumbs.length > 1");
  });

  test("settings expose selected navigation and theme state", () => {
    const source = readFileSync(
      new URL(
        "../src/components/design-system/workbench/chrome/workbench-settings-dialog.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toContain('aria-current={page === id ? "page" : undefined}');
    expect(source).toContain("aria-pressed={selected}");
    expect(source).toContain("motion-reduce:active:scale-100");
  });
});
