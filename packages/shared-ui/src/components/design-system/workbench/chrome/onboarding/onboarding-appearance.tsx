import { ArrowLeftIcon, ArrowRightIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@flux/shared-ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@flux/shared-ui/components/ui/field";
import type { WorkbenchTheme } from "#workbench/types";

export function OnboardingAppearance({ theme, onThemeChange, onContinue, onBack }: {
  theme: WorkbenchTheme;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return <section className="w-full max-w-sm" aria-labelledby="appearance-title">
    <Button variant="ghost" onClick={onBack} className="mb-8 -ms-2 text-muted-foreground"><ArrowLeftIcon />Back</Button>
    <header className="mb-8">
      <p className="mb-3 text-sm text-muted-foreground">Step 1 of 2 · Appearance</p>
      <h1 id="appearance-title" className="text-2xl font-semibold tracking-tight">Make Flux feel like you.</h1>
      <p className="mt-2 text-sm text-muted-foreground">Choose your theme. You can change it later in Settings.</p>
    </header>
    <form onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
      <FieldGroup>
        <FieldSet>
          <FieldLegend className="sr-only">Theme</FieldLegend>
          <Field className="grid grid-cols-2 gap-3">
            {(["light", "dark"] as const).map((value) => <Button key={value} type="button" variant={theme === value ? "secondary" : "outline"} aria-pressed={theme === value} onClick={() => onThemeChange(value)} className="h-24 flex-col gap-3 rounded-lg aria-pressed:ring-2 aria-pressed:ring-foreground">
              {value === "light" ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
              {value === "light" ? "Light" : "Dark"}
            </Button>)}
          </Field>
          <FieldDescription role="status">{theme === "light" ? "Light" : "Dark"} theme selected.</FieldDescription>
        </FieldSet>
        <Field><Button type="submit" className="h-11 rounded-lg border-0 bg-linear-to-b from-blue-500 to-blue-700 text-white shadow-sm ring-1 ring-inset ring-white/20 hover:brightness-110">Continue<ArrowRightIcon /></Button></Field>
      </FieldGroup>
    </form>
  </section>;
}
