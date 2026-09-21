import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../../../lib/utils";

import type { EditorTab } from "./editor-model";
import { workbenchEditorTheme } from "./editor-theme";
import { WorkbenchIcon } from "../shared/workbench-icon";

export type EditorRenderer = (
  tab: EditorTab,
  update: (changes: Partial<Omit<EditorTab, "id">>) => void,
  onOpenDocument?: (path: string) => void
) => ReactNode;

type EditorSurfaceProps = {
  tab?: EditorTab;
  active?: boolean;
  onChange?: (content: string) => void;
  onUpdate?: (changes: Partial<Omit<EditorTab, "id">>) => void;
  renderEditor?: EditorRenderer;
};

export function EditorSurface({
  tab,
  active = true,
  onChange,
  onUpdate,
  renderEditor,
}: EditorSurfaceProps) {
  if (!tab) return <EmptyEditor />;
  if (tab.id.startsWith("workbench:"))
    return renderEditor?.(tab, onUpdate ?? (() => undefined)) ?? null;

  const segments = tab.id.startsWith("file:")
    ? tab.id.slice(5).split("/").filter(Boolean)
    : ["flux", tab.title];
  const breadcrumbs =
    segments[segments.length - 1] === tab.title ? segments : [...segments, tab.title];
  const content = tab.content ?? "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--workbench-editor)]">
      {breadcrumbs.length > 1 ? (
        <nav
          aria-label="File breadcrumbs"
          className="flex h-[23px] shrink-0 items-center overflow-hidden border-b border-[var(--workbench-border)] px-2 text-[12px] text-[var(--workbench-muted)]"
        >
          {breadcrumbs.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex min-w-0 items-center">
              {index > 0 ? <WorkbenchIcon name="chevron-right" size={14} /> : null}
              <span
                className={cn(
                  "truncate",
                  index === breadcrumbs.length - 1 && "text-[var(--workbench-fg)]"
                )}
              >
                {segment}
              </span>
            </span>
          ))}
        </nav>
      ) : null}

      {renderEditor?.(tab, onUpdate ?? (() => undefined)) ?? (
        <CodeEditor
          title={tab.title}
          value={content}
          active={active}
          readOnly={tab.readOnly}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function CodeEditor({
  title,
  value,
  active,
  readOnly = false,
  onChange,
}: {
  title: string;
  value: string;
  active: boolean;
  readOnly?: boolean;
  onChange?: (content: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialTitleRef = useRef(title);
  const initialValueRef = useRef(value);
  const initialReadOnlyRef = useRef(readOnly);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) return;
    const language = new Compartment();
    let destroyed = false;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          minimalSetup,
          language.of(languageFor(initialTitleRef.current)),
          ...(initialReadOnlyRef.current
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : []),
          EditorView.contentAttributes.of({ "aria-label": `${initialTitleRef.current} editor` }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
          workbenchEditorTheme,
        ],
      }),
    });
    viewRef.current = view;
    const fileName = initialTitleRef.current;
    const extension = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
      : "";
    const description = languages.find(
      (candidate) => candidate.filename?.test(fileName) || candidate.extensions.includes(extension)
    );
    if (description) {
      void description.load().then((support) => {
        if (!destroyed) view.dispatch({ effects: language.reconfigure(support) });
      });
    }
    return () => {
      destroyed = true;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    if (active) viewRef.current?.requestMeasure();
  }, [active]);

  return <div ref={hostRef} className="flux-code-editor min-h-0 min-w-0 flex-1 overflow-hidden" />;
}

function languageFor(title: string): Extension {
  if (title.endsWith(".md")) return markdown();
  if (title.endsWith(".ts") || title.endsWith(".tsx"))
    return javascript({ typescript: true, jsx: title.endsWith(".tsx") });
  if (title.endsWith(".js") || title.endsWith(".jsx") || title.endsWith(".json"))
    return javascript({ jsx: title.endsWith(".jsx") });
  return [];
}

function EmptyEditor() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto">
      <div className="flex select-none flex-col items-center gap-7 px-8 text-[var(--workbench-muted)]">
        <img src="./logo.png" alt="" className="size-20 object-contain opacity-20 grayscale" />
        <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-2 whitespace-nowrap text-[13px] opacity-70">
          <dt>Show All Commands</dt>
          <dd className="text-right font-mono">⇧⌘P</dd>
          <dt>Go to File</dt>
          <dd className="text-right font-mono">⌘P</dd>
          <dt>Find in Files</dt>
          <dd className="text-right font-mono">⇧⌘F</dd>
        </dl>
      </div>
    </div>
  );
}

export function fileIconName(title: string) {
  if (title.endsWith(".md")) return "markdown";
  if (title.endsWith(".json")) return "json";
  if (title.endsWith(".css")) return "symbol-color";
  if (title.endsWith(".tsx") || title.endsWith(".ts")) return "symbol-method";
  return "file-code";
}
