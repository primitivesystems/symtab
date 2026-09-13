import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingPage } from "../src/components/design-system/workbench/chrome/onboarding-page";
import { OnboardingWorkspaceForm } from "../src/components/design-system/workbench/chrome/onboarding-workspace-form";
import { OnboardingAppearance } from "../src/components/design-system/workbench/chrome/onboarding-appearance";

test("welcome has one Get started action and no vault or theme shortcuts", () => {
  const render = (ready: boolean) =>
    renderToStaticMarkup(
      <OnboardingPage
        theme="dark"
        ready={ready}
        onThemeChange={() => {}}
        onOpenVault={async () => {}}
        onCreateWorkspace={async () => {}}
      />
    );
  const html = render(true);
  expect(html).toContain("Get started");
  expect(html).not.toContain("Open existing vault");
  expect(html).toContain("A home for your thoughts.");
  expect(html).not.toContain("Browse available vaults");
  expect(html).not.toContain("No account needed");
  expect(html).not.toContain("Switch to light theme");
  expect(html).not.toContain("Switch to dark theme");
  expect(html).not.toContain("Step 1");
  expect(html).not.toContain('disabled=""');
  expect(render(false).match(/ disabled=""/g)).toHaveLength(1);
});

test("appearance is a setup step with an explicit selection and Continue action", () => {
  for (const theme of ["light", "dark"] as const) {
    const html = renderToStaticMarkup(
      <OnboardingAppearance
        theme={theme}
        onThemeChange={() => {}}
        onContinue={() => {}}
        onBack={() => {}}
      />
    );
    expect(html).toContain("Step 1 of 2");
    expect(html).toContain("Continue");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain(`${theme === "light" ? "Light" : "Dark"} theme selected.`);
  }
});

test("workspace step owns creation and the existing-vault alternative", () => {
  const render = (managed: boolean) =>
    renderToStaticMarkup(
      <OnboardingWorkspaceForm
        ready
        managed={managed}
        onSelectLocation={async () => null}
        onCreate={async () => {}}
        onOpenVault={async () => {}}
        onBack={() => {}}
      />
    );
  expect(render(false)).toContain("Workspace name");
  expect(render(false)).toContain("Save location");
  expect(render(false)).toContain("Create workspace");
  expect(render(false)).toContain("Open existing vault");
  expect(render(true)).not.toContain("Save location");
  expect(render(true)).toContain("connected Symtab server");
});
