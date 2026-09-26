import { toast } from "@symtab/shared-ui/components/sonner";

export function showRenderError(label: string, error: unknown) {
  const details = error instanceof Error ? (error.stack ?? error.message) : String(error);

  toast.error(`${label} failed`, {
    description: error instanceof Error ? error.message : "An unknown rendering error occurred.",
    action: {
      label: "Copy",
      onClick: () => void navigator.clipboard.writeText(details),
    },
  });
}
