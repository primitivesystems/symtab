import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogContent,
  DialogTitle,
} from "@symtab/shared-ui/components/ui/dialog";
import ReadingView from "../editor/reading-view";
import { splitFrontmatter } from "../editor/frontmatter";
import type { DemoDocument } from "../editor/markdown-editor";
import type { PdfExportOptions } from "../App";

type PageSize = "A4" | "Letter";
type MarginSize = "compact" | "default" | "wide";

interface PdfExportDialogProps {
  document: DemoDocument | null;
  documents: DemoDocument[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport?: (options: PdfExportOptions) => Promise<string | null>;
}

const marginMillimetres: Record<MarginSize, number> = {
  compact: 10,
  default: 18,
  wide: 28,
};

export function PdfExportDialog({
  document,
  documents,
  open,
  onOpenChange,
  onExport,
}: PdfExportDialogProps) {
  const [includeTitle, setIncludeTitle] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState<MarginSize>("default");
  const [scale, setScale] = useState(100);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const finish = () => onOpenChange(false);
    window.addEventListener("afterprint", finish);
    return () => window.removeEventListener("afterprint", finish);
  }, [onOpenChange]);

  if (!document) return null;

  const print = async () => {
    setError("");
    setExporting(true);
    onOpenChange(false);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    try {
      if (onExport) {
        await onExport({
          title: document.title,
          pageSize,
          landscape,
          marginMillimetres: marginMillimetres[margin],
          scale: scale / 100,
        });
      } else {
        window.print();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF export failed");
      onOpenChange(true);
    } finally {
      setExporting(false);
    }
  };
  const body = splitFrontmatter(document.content).body;
  const pageRule = `${pageSize} ${landscape ? "landscape" : "portrait"}`;
  const printDocument = (
    <>
      <style media="print">{`@page { size: ${pageRule}; margin: 0; }`}</style>
      <div
        className="symtab-print-document"
        style={{
          "--symtab-print-scale": `${onExport ? 1 : scale / 100}`,
          "--symtab-print-margin": `${marginMillimetres[margin]}mm`,
        } as React.CSSProperties}
        aria-hidden="true"
      >
        {includeTitle ? <h1 className="symtab-print-title">{document.title}</h1> : null}
        <ReadingView value={body} documents={documents} />
      </div>
    </>
  );

  return (
    <>
      {typeof window === "undefined" ? null : createPortal(printDocument, window.document.body)}
      <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            showCloseButton={false}
            className="w-[min(500px,calc(100vw-2rem))] rounded-xl p-5"
          >
            <DialogTitle className="text-lg font-semibold">Export to PDF</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Export “{document.title}” as a clean, selectable-text document.
            </DialogDescription>
            <div className="mt-5 divide-y [border-color:var(--layout-separator)] [&>*]:border-[var(--layout-separator)]">
              <label className="flex items-center justify-between border-b py-3 text-sm">
                Include file name as title
                <input
                  type="checkbox"
                  checked={includeTitle}
                  onChange={(event) => setIncludeTitle(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between border-b py-3 text-sm">
                Page size
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(event.target.value as PageSize)}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm [border-color:var(--layout-separator)]"
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                </select>
              </label>
              <label className="flex items-center justify-between border-b py-3 text-sm">
                Landscape
                <input
                  type="checkbox"
                  checked={landscape}
                  onChange={(event) => setLandscape(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between border-b py-3 text-sm">
                Margin
                <select
                  value={margin}
                  onChange={(event) => setMargin(event.target.value as MarginSize)}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm capitalize [border-color:var(--layout-separator)]"
                >
                  <option value="compact">Compact</option>
                  <option value="default">Default</option>
                  <option value="wide">Wide</option>
                </select>
              </label>
              <label className="block py-3 text-sm">
                <span className="flex justify-between">
                  Downscale percent <span className="text-muted-foreground">{scale}%</span>
                </span>
                <input
                  aria-label="Downscale percent"
                  className="mt-2 w-full"
                  type="range"
                  min="60"
                  max="100"
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {error ? (
                <p className="mr-auto self-center text-xs text-destructive">{error}</p>
              ) : null}
              <DialogClose className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                Cancel
              </DialogClose>
              <button
                type="button"
                onClick={print}
                disabled={exporting}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {exporting ? "Exporting…" : "Export to PDF"}
              </button>
            </div>
          </DialogContent>
      </Dialog>
    </>
  );
}
