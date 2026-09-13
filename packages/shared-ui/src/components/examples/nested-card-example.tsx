import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

export function NestedCardExample({
  detectedVersion = "0.0.1",
  onInstall,
}: {
  detectedVersion?: string;
  onInstall?: () => void;
}) {
  return (
    <Card size="sm" className="w-full max-w-md gap-0 p-1">
      <CardContent className="rounded-lg border bg-background p-6">
        <CardHeader className="px-5 py-4">
          <CardTitle>Version detected</CardTitle>
          <CardDescription>
            Symtab found version {detectedVersion} on your system. Install it to continue.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Detected version</span>
            <span className="truncate font-mono text-sm">Symtab {detectedVersion}</span>
          </div>
          <Button type="button" size="sm" onClick={onInstall} className="w-full">
            Install Symtab
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
