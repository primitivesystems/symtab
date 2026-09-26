import { useEffect, useRef, useState } from "react";
import { ChevronDown, Minus, PanelLeft, Plus, Rows3 } from "lucide-react";
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

function demoPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 144 >>\nstream\nBT\n/F1 25 Tf\n72 700 Td\n(Symtab PDF viewer) Tj\n0 -44 Td\n/F1 12 Tf\n(PDF.js renders this document in the same workspace leaf.) Tj\n0 -24 Td\n(Zoom, page navigation, thumbnails, and split panes stay local.) Tj\nET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const encoder = new TextEncoder();
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(content).length);
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = encoder.encode(content).length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(content);
}

function outputScale() {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

function PdfThumbnail({
  document,
  page,
  active,
  onSelect,
}: {
  document: PDFDocumentProxy;
  page: number;
  active: boolean;
  onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void document.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = 104 / base.width;
      const ratio = Math.min(2, outputScale());
      const cssViewport = pdfPage.getViewport({ scale: cssScale });
      const renderViewport = pdfPage.getViewport({ scale: cssScale * ratio });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport: renderViewport });
      void renderTask.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, page]);

  return (
    <button
      type="button"
      aria-label={`Open PDF page ${page}`}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={`flex w-full flex-col items-center gap-1 rounded-md border p-2 text-[10px] ${
        active ? "border-primary bg-accent" : "border-transparent hover:bg-accent/60"
      }`}
    >
      <canvas ref={canvasRef} className="bg-white shadow-sm" />
      <span>{page}</span>
    </button>
  );
}

export function PdfViewer({
  title = "Symtab PDF demo",
  data,
}: {
  title?: string;
  data?: ArrayBuffer;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: data ? new Uint8Array(data.slice(0)) : demoPdf() });
    void task.promise
      .then((pdf) => {
        if (!cancelled) setDocument(pdf);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "PDF failed to load");
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!document || !canvasRef.current || !pageRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvasRef.current || !pageRef.current || !textLayerRef.current) return;
        const cssViewport = pdfPage.getViewport({ scale: scale * 1.25 });
        const ratio = outputScale();
        const renderViewport = pdfPage.getViewport({ scale: scale * 1.25 * ratio });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;
        pageRef.current.style.width = `${cssViewport.width}px`;
        pageRef.current.style.height = `${cssViewport.height}px`;
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport: renderViewport });

        const textContainer = textLayerRef.current;
        textContainer.replaceChildren();
        textContainer.style.setProperty("--total-scale-factor", String(cssViewport.scale));
        textLayer = new TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: textContainer,
          viewport: cssViewport,
        });
        await Promise.all([renderTask.promise, textLayer.render()]);
      })
      .catch((reason: unknown) => {
        if (!cancelled && (reason as { name?: string }).name !== "RenderingCancelledException") {
          setError(reason instanceof Error ? reason.message : "PDF page failed to render");
        }
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, page, scale]);

  return (
    <section
      className="flex h-full max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
      aria-label={`PDF viewer: ${title}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 [border-color:var(--layout-separator)]">
        <button
          type="button"
          aria-label="Toggle PDF sidebar"
          className="grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => setSidebar((open) => !open)}
        >
          <PanelLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="PDF sidebar options"
          className="grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => setSidebar(true)}
        >
          <ChevronDown className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom PDF out"
          className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-12 text-center text-[11px] text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom PDF in"
          className="grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => setScale((value) => Math.min(3, value + 0.1))}
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Reset PDF zoom"
          title="Reset zoom"
          className="grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => setScale(1)}
        >
          <Rows3 className="size-4" />
        </button>
        <input
          aria-label="PDF page"
          type="number"
          min={1}
          max={document?.numPages ?? 1}
          value={page}
          onChange={(event) =>
            setPage(Math.max(1, Math.min(document?.numPages ?? 1, Number(event.target.value))))
          }
          className="h-7 w-12 rounded-md border bg-muted/40 px-2 text-center text-xs [border-color:var(--layout-separator)]"
        />
        <span className="text-xs text-muted-foreground">of {document?.numPages ?? "–"}</span>
      </div>
      <div className="flex h-0 min-h-0 min-w-0 flex-1 overflow-hidden">
        {sidebar && document ? (
          <aside className="symtab-editor-scroll h-full min-h-0 w-36 shrink-0 overflow-y-auto border-r bg-sidebar p-2 [border-color:var(--layout-separator)]">
            {Array.from({ length: document.numPages }, (_, index) => (
              <PdfThumbnail
                key={index + 1}
                document={document}
                page={index + 1}
                active={page === index + 1}
                onSelect={() => setPage(index + 1)}
              />
            ))}
          </aside>
        ) : null}
        <div className="symtab-editor-scroll h-full min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-muted/30 p-5">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <div ref={pageRef} className="relative mx-auto bg-white shadow-md">
              <canvas ref={canvasRef} className="absolute inset-0 block bg-white" />
              <div ref={textLayerRef} className="symtab-pdf-text-layer textLayer" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
