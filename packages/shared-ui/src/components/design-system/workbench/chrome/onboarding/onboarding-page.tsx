import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Field, FieldDescription, FieldGroup } from "@flux/shared-ui/components/ui/field";
import type { WorkbenchTheme } from "#workbench/types";
import { OnboardingWorkspaceForm, type WorkspaceSetup } from "./onboarding-workspace-form";
import { OnboardingAppearance } from "./onboarding-appearance";

export function OnboardingPage({
  theme,
  onThemeChange,
  onOpenVault,
  onCreateWorkspace,
  onSelectLocation,
  managed = false,
  ready,
}: {
  theme: WorkbenchTheme;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onOpenVault: () => Promise<void>;
  onCreateWorkspace: (workspace: WorkspaceSetup) => Promise<void>;
  onSelectLocation?: () => Promise<string | null>;
  managed?: boolean;
  ready: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<"welcome" | "appearance" | "workspace">("welcome");
  const reveal = (delay: number) => ({
    initial: reducedMotion ? false as const : { opacity: 0, y: 10, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: reducedMotion ? 0 : 0.55, delay: reducedMotion ? 0 : delay, ease: "easeOut" as const },
  });
  return (
    <main aria-label="Set up Flux" className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-20 text-foreground">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-9 [-webkit-app-region:drag]" />
      {step === "appearance" ? <OnboardingAppearance theme={theme} onThemeChange={onThemeChange} onContinue={() => setStep("workspace")} onBack={() => setStep("welcome")} /> : null}
      {step !== "welcome" ? <OnboardingWorkspaceForm hidden={step !== "workspace"} ready={ready} managed={managed} onSelectLocation={onSelectLocation} onCreate={onCreateWorkspace} onOpenVault={onOpenVault} onBack={() => setStep("appearance")} /> : <section className="w-full max-w-sm text-center" aria-labelledby="onboarding-title">
        <header className="mb-10">
          <motion.h1 {...reveal(0)} id="onboarding-title" className="text-7xl font-semibold tracking-[-0.065em] sm:text-8xl">Flux</motion.h1>
          <motion.p {...reveal(0.12)} className="mt-5 text-lg tracking-tight text-muted-foreground">A home for your thoughts.</motion.p>
        </header>
        <motion.form {...reveal(0.24)} onSubmit={(event) => { event.preventDefault(); setStep("appearance"); }}>
          <FieldGroup className="gap-5">
            <Field>
              <Button type="submit" disabled={!ready}
                className="h-11 rounded-lg border-0 bg-linear-to-b from-blue-500 to-blue-700 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/20 transition-[filter,scale] hover:brightness-110 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100">
                Get started
                <ArrowRightIcon className="size-4" />
              </Button>
            </Field>
            {!ready ? <FieldDescription role="status">Connecting to your workspace…</FieldDescription> : null}
          </FieldGroup>
        </motion.form>
      </section>}
    </main>
  );
}
