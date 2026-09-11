import { LoaderCircleIcon, PaletteIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs";
import type { WorkbenchTheme, WorkbenchUpdate } from "../types";

export function WorkbenchSettingsDialog({
  accountSettings,
  open,
  theme,
  update,
  checking,
  canCheckForUpdates,
  onOpenChange,
  onThemeChange,
  onCheckForUpdates,
}: {
  accountSettings?: import("react").ReactNode;
  open: boolean;
  theme: WorkbenchTheme;
  update?: WorkbenchUpdate;
  checking: boolean;
  canCheckForUpdates: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onCheckForUpdates: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader>
          <div className="px-6 pt-6">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Configure Flux on this device.</DialogDescription>
          </div>
        </DialogHeader>
        <Tabs defaultValue="appearance" orientation="vertical" className="min-h-80 gap-0">
          <TabsList
            variant="line"
            aria-label="Settings sections"
            className="w-40 shrink-0 items-stretch justify-start px-3 py-4"
          >
            {accountSettings && <TabsTrigger value="account" className="after:hidden">Account</TabsTrigger>}
            <TabsTrigger value="appearance" className="after:hidden">
              <PaletteIcon />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="updates" className="after:hidden">
              <RefreshCwIcon />
              Updates
            </TabsTrigger>
          </TabsList>
          <div className="min-w-0 flex-1 px-6 py-5">
            {accountSettings && <TabsContent value="account">{accountSettings}</TabsContent>}
            <TabsContent value="appearance" className="space-y-5">
              <div>
                <h3 className="font-medium">Appearance</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose the editor color theme.</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  onClick={() => onThemeChange("light")}
                >
                  Light
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  onClick={() => onThemeChange("dark")}
                >
                  Dark
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="updates" className="space-y-5">
              <div>
                <h3 className="font-medium">Software update</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {update?.currentVersion
                    ? `Flux ${update.currentVersion} is installed.`
                    : "Version information unavailable."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!canCheckForUpdates || checking}
                onClick={onCheckForUpdates}
              >
                {checking ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
                {checking ? "Checking…" : "Check for updates"}
              </Button>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
