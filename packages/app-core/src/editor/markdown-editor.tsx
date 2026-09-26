import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDown,
  FilePenLine,
  FolderInput,
  History,
  Eye,
  ListPlus,
  Merge,
  Network,
  PanelBottomOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { minimalSetup } from "codemirror";
import { startCompletion } from "@codemirror/autocomplete";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
} from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { bracketMatching, indentOnInput, indentUnit, syntaxTree } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { EditorView, keymap, type Command, Decoration, type DecorationSet } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuSub as CossMenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "@flux/shared-ui/components/ui/menu";
import { Spinner } from "@flux/shared-ui/components/spinner";
import { splitFrontmatter } from "./frontmatter";
import { markdownAssist } from "./editor-assist";
import { livePreview } from "./live-preview";
import { isMarkdownListLine, listIndentWidth, nestedOrderedMarkerEdit } from "./markdown-list";
import { obsidianMarkdownExtensions } from "./obsidian-markdown";
import { showRenderError } from "./render-feedback";
import { linkedMentionsFor, resolverFor, unlinkedMentionsFor } from "./link-index";

const ReadingView = lazy(() => import("./reading-view"));

function RenderingState() {
  return (
    <div className="mx-auto flex max-w-[760px] items-center gap-2 px-9 pt-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      <span>Rendering…</span>
    </div>
  );
}

class ReadingViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    showRenderError("Reading view", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function changeListIndent(view: EditorView, outdent: boolean) {
  const unit = view.state.facet(indentUnit) || "  ";
  const lines = new Map<number, { from: number; to: number; text: string; number: number }>();
  for (const range of view.state.selection.ranges) {
    let position = range.from;
    const end =
      range.to > range.from && view.state.doc.lineAt(range.to).from === range.to
        ? range.to - 1
        : range.to;
    while (position <= end) {
      const line = view.state.doc.lineAt(position);
      if (isMarkdownListLine(line.text)) lines.set(line.from, line);
      if (line.to >= end) break;
      position = line.to + 1;
    }
  }
  if (!lines.size) return false;

  const previousLines = (number: number) => ({
    *[Symbol.iterator]() {
      for (let previous = number - 1; previous >= 1; previous--) {
        yield view.state.doc.line(previous).text;
      }
    },
  });
  const changes = [...lines.values()].flatMap((line) => {
    const width = listIndentWidth(line.text, previousLines(line.number), unit.length, outdent);
    const indentChange = outdent
      ? { from: line.from, to: line.from + width, insert: "" }
      : { from: line.from, to: line.from, insert: " ".repeat(width) };
    const marker = !outdent && lines.size === 1 ? nestedOrderedMarkerEdit(line.text) : null;
    return marker
      ? [
          indentChange,
          { from: line.from + marker.from, to: line.from + marker.to, insert: marker.insert },
        ]
      : [indentChange];
  });
  if (outdent && changes.every((change) => change.from === change.to)) return false;
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
}

const indentMarkdownList: Command = (view) => changeListIndent(view, false);
const outdentMarkdownList: Command = (view) => changeListIndent(view, true);

export interface DemoDocument {
  title: string;
  content: string;
  path?: string;
  contentHash?: string;
}

export type MarkdownMode = "live" | "source" | "read";

export const DEMO_DOCUMENT: DemoDocument = {
  title: "Symtab editor demo",
  content: `---
tags: [symtab, editor, demo]
status: draft
priority: 2
---

# A fast, local-first writing surface

Symtab keeps **plain Markdown** underneath, so your notes stay portable. Use [[Backlinks]] to connect ideas without reorganizing folders.

> The editor and reading view share one document. Nothing is converted into a private block format.

## What this demo covers

- [x] Markdown editing with CodeMirror 6
- [x] YAML properties remain in the file, outside the writing surface
- [x] Live-rendered diagrams and math, with source one click away
- [ ] Persistence and collaboration come after the interaction is solid

![A connected path](data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%20800%20240%27%3E%3Crect%20width=%27800%27%20height=%27240%27%20rx=%2718%27%20fill=%27%2322242a%27/%3E%3Cpath%20d=%27M80%20170L220%2080L340%20145L510%2055L720%20170%27%20fill=%27none%27%20stroke=%27%23d8dbe5%27%20stroke-width=%2710%27/%3E%3C/svg%3E)

\`\`\`mermaid
flowchart LR
  Capture --> Connect
  Connect --> Create
\`\`\`

Inline math stays compact: $E = mc^2$.

$$
\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`ts
const note = await symtab.open("Symtab editor demo")
note.link("Performance")
\`\`\`

| Mode | Best for |
| --- | --- |
| Live Preview | Writing with semantic formatting |
| Source | Precise Markdown control |
| Read | Reviewing rendered notes |
`,
};

const SYNTAX_LAB = [
  "# Heading 1",
  "## Heading 2",
  "### Heading 3",
  "",
  "Plain paragraph with **bold**, *italic*, ***bold italic***, ~~strikethrough~~, ==highlight==, \\*escaped\\*, and `inline code`.",
  "",
  "External [OpenAI](https://openai.com), wiki [[test1|aliased link]], tag #syntax-lab, and footnote[^1].",
  "",
  "> Blockquote",
  "",
  "> [!note] Callout title",
  "> Callout body with **formatting**.",
  "",
  "- Bullet item",
  "  - Nested bullet",
  "1. Ordered item",
  "2. Second item",
  "- [x] Completed task",
  "- [ ] Open task",
  "",
  "| Feature | Live | Read |",
  "|:---|:---:|---:|",
  "| Table | yes | yes |",
  "| Alignment | left | right |",
  "",
  "---",
  "",
  "```typescript",
  "const answer: number = 42;",
  "console.log(answer);",
  "```",
  "",
  "Inline math $E = mc^2$.",
  "",
  "$$",
  "\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}",
  "$$",
  "",
  "```mermaid",
  "flowchart LR",
  "  Capture --> Connect",
  "  Connect --> Create",
  "```",
  "",
  "![Remote image](https://picsum.photos/640/240)",
  "",
  "![[test1]]",
  "",
  "%% Hidden comment %%",
  "Visible block reference ^syntax-lab",
  "",
  "[^1]: Footnote content.",
].join("\n");

export const REFERENCE_DOCUMENTS: DemoDocument[] = [
  {
    title: "Performance notes",
    content: `---\ntags: [performance]\nstatus: active\n---\n\n# Performance notes\n\nKeep [[Symtab editor demo]] responsive while rendering large notes.`,
  },
  {
    title: "Project plan",
    content: `---\ntags: [planning]\nstatus: draft\n---\n\n# Project plan\n\nTrack editor work in [[Symtab editor demo]] and [[Performance notes]].`,
  },
  { title: "Syntax lab", content: SYNTAX_LAB },
  {
    title: "test1",
    content: "# Embedded note\n\nThis content is transcluded from `test1`.",
  },
];

const addHighlight = StateEffect.define<{ from: number; to: number }>();
const removeHighlight = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(highlights, tr) {
    highlights = highlights.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addHighlight)) {
        highlights = highlights.update({
          add: [
            Decoration.mark({
              class:
                "bg-yellow-400/30 dark:bg-yellow-500/20 ring-2 ring-yellow-400/60 dark:ring-yellow-500/40 rounded-sm",
            }).range(e.value.from, e.value.to),
          ],
        });
      } else if (e.is(removeHighlight)) {
        highlights = Decoration.none;
      }
    }
    return highlights;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function MarkdownSource({
  value,
  live,
  documents,
  findRequest,
  revealRequest,
  onChange,
  documentPath,
  frontmatterLines = 0,
  onOpenUrl,
}: {
  value: string;
  live: boolean;
  documents: DemoDocument[];
  findRequest: number;
  revealRequest?: { line: number; request: number };
  onChange: (value: string) => void;
  documentPath?: string;
  frontmatterLines?: number;
  onOpenUrl?: (url: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const documentsRef = useRef(documents);
  const initialValueRef = useRef(value);
  const initialLiveRef = useRef(live);
  const initialDocumentsRef = useRef(documents);
  const onOpenUrlRef = useRef(onOpenUrl);

  const frontmatterLinesRef = useRef(frontmatterLines);
  useEffect(() => {
    frontmatterLinesRef.current = frontmatterLines;
  }, [frontmatterLines]);

  const documentPathRef = useRef(documentPath);
  useEffect(() => {
    documentPathRef.current = documentPath;
  }, [documentPath]);

  useEffect(() => {
    let active = true;
    const handleNavigate = (
      event: CustomEvent<{ path: string; line: number; excerpt?: string }>
    ) => {
      const targetPath = event.detail.path;
      if (documentPathRef.current === targetPath) {
        const view = viewRef.current;
        if (!view) return;

        // Calculate body line number (1-based)
        const totalLineNum = event.detail.line;
        const bodyLineNum = Math.max(1, totalLineNum - frontmatterLinesRef.current);
        const lineLimit = view.state.doc.lines;
        const lineIndex = Math.min(bodyLineNum, lineLimit);

        const line = view.state.doc.line(lineIndex);
        let anchor = line.from;
        let head = line.to;

        if (event.detail.excerpt) {
          // Find target match in the line if excerpt is provided
          const text = line.text;
          const cleanExcerpt = event.detail.excerpt.trim();
          const index = text.toLowerCase().indexOf(cleanExcerpt.toLowerCase());
          if (index !== -1) {
            anchor = line.from + index;
            head = anchor + cleanExcerpt.length;
          }
        }

        view.focus();

        // Dispatch highlight effect and update selection
        view.dispatch({
          selection: { anchor, head },
          scrollIntoView: true,
          effects: [addHighlight.of({ from: anchor, to: head })],
        });

        setTimeout(() => {
          if (active) {
            view.dispatch({
              effects: [removeHighlight.of(null)],
            });
          }
        }, 1500);
      }
    };

    window.addEventListener("flux-navigate-editor", handleNavigate as EventListener);
    return () => {
      active = false;
      window.removeEventListener("flux-navigate-editor", handleNavigate as EventListener);
    };
  }, []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onOpenUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          minimalSetup,
          markdown({ extensions: [...GFM, ...obsidianMarkdownExtensions] }),
          bracketMatching(),
          indentOnInput(),
          highlightSelectionMatches(),
          markdownAssist(() => documentsRef.current),
          initialLiveRef.current ? livePreview(initialDocumentsRef.current) : [],
          highlightField,
          keymap.of([
            ...searchKeymap,
            { key: "Enter", run: insertNewlineContinueMarkup },
            { key: "Backspace", run: deleteMarkupBackward },
            { key: "Tab", run: indentMarkdownList },
            { key: "Shift-Tab", run: outdentMarkdownList },
            indentWithTab,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": initialLiveRef.current
              ? "Markdown editor, Live Preview"
              : "Markdown editor, Source mode",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onChangeRef.current(update.state.doc.toString());
            const cursor = update.state.selection.main.head;
            const line = update.state.doc.lineAt(cursor);
            const beforeCursor = update.state.doc.sliceString(line.from, cursor);
            if (/^\s*\/[\w -]*$/.test(beforeCursor) || /\[\[[^\]\n]*$/.test(beforeCursor)) {
              window.requestAnimationFrame(() => startCompletion(update.view));
            }
          }),
          EditorView.domEventHandlers({
            click: (event, view) => {
              const target = event.target as HTMLElement;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) {
                const tree = syntaxTree(view.state);
                let extractedUrl: string | null = null;
                tree.iterate({
                  from: pos,
                  to: pos,
                  enter: (node: any) => {
                    if (node.type.name === "Link") {
                      const linkText = view.state.doc.sliceString(node.from, node.to);
                      const urlMatch = linkText.match(/\[([^\]]*)\]\(([^)]+)\)/);
                      if (urlMatch && urlMatch[2]) {
                        extractedUrl = urlMatch[2] as string;
                      }
                      return false;
                    }
                    if (node.type.name === "URL") {
                      extractedUrl = view.state.doc.sliceString(node.from, node.to);
                      return false;
                    }
                    return true;
                  },
                });
                if (extractedUrl && (extractedUrl.startsWith("http://") || extractedUrl.startsWith("https://"))) {
                  event.preventDefault();
                  onOpenUrlRef.current?.(extractedUrl);
                  return true;
                }
              }
              const link = target.closest("a");
              if (link) {
                const href = link.getAttribute("href");
                if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
                  event.preventDefault();
                  onOpenUrlRef.current?.(href);
                  return true;
                }
              }
              return false;
            },
          }),
          EditorView.theme({
            "&": { height: "auto", backgroundColor: "transparent", color: "var(--foreground)" },
            ".cm-scroller": {
              overflow: "visible",
              fontFamily: "var(--font-sans)",
              lineHeight: "1.7",
            },
            ".cm-content": { maxWidth: "760px", margin: "0 auto", padding: "8px 36px 96px" },
            ".cm-line": { padding: "0" },
            ".cm-gutters": { display: "none" },
            ".cm-activeLine": { backgroundColor: "transparent" },
            ".cm-activeLineGutter": { backgroundColor: "transparent" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--foreground) 18%, transparent) !important",
            },
            ".cm-focused": { outline: "none" },
            ".cm-live-heading": {
              fontWeight: "650",
              textDecoration: "none",
              letterSpacing: "-0.02em",
            },
            ".cm-live-h1": {
              fontSize: "1.7rem",
              lineHeight: "1.35",
            },
            ".cm-live-h2": { fontSize: "1.35rem", lineHeight: "1.4" },
            ".cm-live-h3": { fontSize: "1.1rem", lineHeight: "1.45" },
            ".cm-live-h4, .cm-live-h5, .cm-live-h6": { fontSize: "1rem", lineHeight: "1.5" },
            ".cm-line.cm-live-heading-line": { paddingTop: "0.55em" },
            ".cm-line.cm-live-h1-line": { paddingTop: "0.8em" },
            ".cm-live-heading *": { textDecoration: "none !important" },
            ".cm-live-strong": { fontWeight: "700" },
            ".cm-live-emphasis": { fontStyle: "italic" },
            ".cm-live-code": {
              backgroundColor: "var(--muted)",
              borderRadius: "0.3rem",
              padding: "0 0.2em",
            },
            ".cm-live-link": { textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
            ".tok-link, .tok-url": { cursor: "pointer" },
            ".cm-live-strike": { textDecoration: "line-through" },
            ".cm-live-highlight": {
              borderRadius: "0.15rem",
              backgroundColor: "color-mix(in oklab, #e7c75c 42%, transparent)",
            },
            ".cm-live-tag": {
              borderRadius: "0.3rem",
              backgroundColor: "var(--muted)",
              padding: "0.05rem 0.3rem",
            },
            ".cm-live-task": {
              width: "0.85rem",
              height: "0.85rem",
              margin: "0 0.3rem 0 0",
              verticalAlign: "-0.08rem",
              accentColor: "var(--foreground)",
              opacity: "0.8",
            },
            ".cm-live-list-bullet": {
              display: "inline-block",
              width: "1.35rem",
              color: "var(--foreground)",
              textAlign: "center",
            },
            ".cm-live-list-number": {
              display: "inline-block",
              minWidth: "1.35rem",
              paddingRight: "0.25rem",
              color: "var(--muted-foreground)",
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            },
            ".cm-line.cm-live-list-line": { paddingLeft: "0" },
            ".cm-line.cm-live-list-depth-1": {
              paddingLeft: "1.5rem",
              backgroundImage: "linear-gradient(var(--layout-separator), var(--layout-separator))",
              backgroundPosition: "0.72rem 0",
              backgroundSize: "1px 100%",
              backgroundRepeat: "no-repeat",
            },
            ".cm-line.cm-live-list-depth-2": {
              paddingLeft: "3rem",
              backgroundImage:
                "linear-gradient(var(--layout-separator), var(--layout-separator)), linear-gradient(var(--layout-separator), var(--layout-separator))",
              backgroundPosition: "0.72rem 0, 2.22rem 0",
              backgroundSize: "1px 100%",
              backgroundRepeat: "no-repeat",
            },
            ".cm-line.cm-live-list-depth-3": {
              paddingLeft: "4.5rem",
              backgroundImage:
                "linear-gradient(var(--layout-separator), var(--layout-separator)), linear-gradient(var(--layout-separator), var(--layout-separator)), linear-gradient(var(--layout-separator), var(--layout-separator))",
              backgroundPosition: "0.72rem 0, 2.22rem 0, 3.72rem 0",
              backgroundSize: "1px 100%",
              backgroundRepeat: "no-repeat",
            },
            ".cm-line.cm-live-list-depth-4": { paddingLeft: "6rem" },
            ".cm-line.cm-live-list-depth-5": { paddingLeft: "7.5rem" },
            ".cm-line.cm-live-list-depth-6": { paddingLeft: "9rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-0": { paddingLeft: "1.15rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-1": { paddingLeft: "2.65rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-2": { paddingLeft: "4.15rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-3": { paddingLeft: "5.65rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-4": { paddingLeft: "7.15rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-5": { paddingLeft: "8.65rem" },
            ".cm-line.cm-live-callout.cm-live-list-depth-6": { paddingLeft: "10.15rem" },
            ".cm-live-image-wrap": { display: "inline-block", maxWidth: "100%" },
            ".cm-live-image-block": { display: "block", margin: "0.65rem 0" },
            ".cm-live-image": {
              display: "block",
              maxWidth: "100%",
              height: "auto",
              borderRadius: "0.4rem",
            },
            ".cm-live-image-error": {
              border: "1px solid var(--layout-separator)",
              borderRadius: "0.4rem",
              padding: "0.8rem",
              color: "var(--muted-foreground)",
              fontSize: "0.9em",
            },
            ".cm-live-inline": { cursor: "text" },
            ".cm-live-horizontal-rule": {
              display: "inline-block",
              width: "100%",
              borderTop: "1px solid var(--layout-separator)",
              verticalAlign: "middle",
            },
            ".cm-live-wikilink": {
              color: "var(--foreground)",
              textDecoration: "underline",
              textDecorationColor: "color-mix(in oklab, var(--foreground) 35%, transparent)",
              textUnderlineOffset: "3px",
            },
            ".cm-live-embed": {
              display: "inline-flex",
              border: "1px solid var(--layout-separator)",
              borderRadius: "0.35rem",
              backgroundColor: "var(--card)",
              padding: "0.05rem 0.4rem",
            },
            ".cm-live-embed-block": {
              display: "block",
              margin: "0.75rem 0",
              border: "1px solid var(--layout-separator)",
              borderRadius: "0.45rem",
              backgroundColor: "var(--card)",
              padding: "0.85rem 1rem",
              cursor: "text",
            },
            ".cm-live-embed-block::before": {
              content: "attr(data-embed-title)",
              display: "block",
              marginBottom: "0.55rem",
              color: "var(--muted-foreground)",
              fontSize: "0.75rem",
              fontWeight: "600",
            },
            ".cm-live-embed-content > :first-child": { marginTop: "0" },
            ".cm-live-embed-content > :last-child": { marginBottom: "0" },
            ".cm-live-embed-missing": {
              borderRadius: "0.3rem",
              backgroundColor: "var(--muted)",
              padding: "0.08rem 0.35rem",
              color: "var(--muted-foreground)",
            },
            ".cm-live-footnote": { fontSize: "0.75em", verticalAlign: "super" },
            ".cm-live-math": { padding: "0 0.08em" },
            ".cm-live-block": {
              display: "block",
              boxSizing: "border-box",
              width: "100%",
              margin: "0.25rem 0", // Reduced vertical spacing
              cursor: "default",
              userSelect: "none",
            },
            ".cm-live-block > :first-child": { marginTop: "0" },
            ".cm-live-block > :last-child": { marginBottom: "0" },
            ".cm-live-code-block pre": {
              margin: "0",
              overflowX: "auto",
              border: "1px solid var(--layout-separator)",
              borderRadius: "0.45rem",
              backgroundColor: "var(--card)",
              padding: "0.9rem 1rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.9em",
              lineHeight: "1.6",
            },
            ".cm-live-code-block .tok-keyword, .cm-live-code-block .tok-operator, .cm-live-code-block .tok-bool":
              {
                color: "#c678dd",
              },
            ".cm-live-code-block .tok-string, .cm-live-code-block .tok-function": {
              color: "#98c379",
            },
            ".cm-live-code-block .tok-number, .cm-live-code-block .tok-typeName": {
              color: "#d19a66",
            },
            ".cm-live-code-block .tok-comment": {
              color: "var(--muted-foreground)",
              fontStyle: "italic",
            },
            ".cm-live-math-block": {
              overflowX: "auto",
              padding: "0.65rem 0",
              textAlign: "center",
            },
            ".cm-live-mermaid-block": {
              minHeight: "8rem",
              border: "1px solid var(--layout-separator)",
              borderRadius: "0.45rem",
              backgroundColor: "var(--card)",
              padding: "1rem",
              color: "var(--muted-foreground)",
              textAlign: "center",
            },
            ".cm-live-mermaid-block svg": { display: "block", maxWidth: "100%", margin: "auto" },
            ".cm-live-table-block": { overflowX: "auto" },
            ".cm-live-table": {
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.95em",
            },
            ".cm-live-table th, .cm-live-table td": {
              border: "1px solid var(--layout-separator)",
              padding: "0.38rem 0.55rem",
              verticalAlign: "top",
            },
            ".cm-live-table th": {
              backgroundColor: "color-mix(in oklab, var(--muted) 65%, transparent)",
              fontWeight: "600",
            },
            ".cm-tooltip-autocomplete": {
              overflow: "hidden",
              border: "1px solid var(--border) !important",
              borderRadius: "0.5rem !important",
              backgroundColor: "var(--popover) !important",
              color: "var(--popover-foreground) !important",
              boxShadow: "0 8px 24px color-mix(in oklab, black 40%, transparent)",
              padding: "0.5rem 0.6rem",
              minWidth: "28rem",
              maxHeight: "20rem !important",
            },
            ".cm-tooltip-autocomplete > ul": {
              maxHeight: "20rem !important",
              fontFamily: "var(--font-sans)",
            },
            ".cm-tooltip-autocomplete > ul > li": {
              borderRadius: "0.35rem",
              padding: "0.85rem 0.75rem",
              lineHeight: "1.5",
              marginBottom: "0.6rem",
            },
            ".cm-tooltip-autocomplete > ul > li:last-child": {
              marginBottom: "0",
            },
            ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
              backgroundColor: "var(--muted)",
              color: "var(--foreground)",
            },
            ".cm-completionLabel": {
              display: "block",
              fontSize: "0.85rem",
              fontWeight: "400",
            },
            ".cm-completionDetail": {
              display: "block",
              color: "var(--muted-foreground)",
              fontStyle: "normal",
              fontSize: "0.65rem",
              marginTop: "0.2rem",
              marginLeft: "0",
            },
            ".cm-line.cm-live-codeblock": {
              backgroundColor: "var(--card)",
              borderLeft: "1px solid var(--layout-separator)",
              borderRight: "1px solid var(--layout-separator)",
              paddingLeft: "0.9rem",
              paddingRight: "0.9rem",
            },
            ".cm-live-quote": {
              borderLeft: "2px solid var(--border)",
              color: "var(--muted-foreground)",
              paddingLeft: "0.8rem",
            },
            ".cm-line.cm-live-callout": {
              "--callout-color": "#4b91ff",
              borderLeft: "2px solid color-mix(in oklab, var(--callout-color) 78%, transparent)",
              borderRight: "1px solid color-mix(in oklab, var(--callout-color) 20%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--callout-color) 10%, var(--background))",
              color: "var(--foreground)",
              paddingLeft: "1.15rem",
              paddingRight: "0.8rem",
            },
            ".cm-line.cm-live-callout-abstract, .cm-line.cm-live-callout-summary, .cm-line.cm-live-callout-tldr":
              { "--callout-color": "#00a6a6" },
            ".cm-line.cm-live-callout-tip, .cm-line.cm-live-callout-hint, .cm-line.cm-live-callout-important":
              { "--callout-color": "#00a88f" },
            ".cm-line.cm-live-callout-success, .cm-line.cm-live-callout-check, .cm-line.cm-live-callout-done":
              { "--callout-color": "#3ca65a" },
            ".cm-line.cm-live-callout-question, .cm-line.cm-live-callout-help, .cm-line.cm-live-callout-faq":
              { "--callout-color": "#d6a11d" },
            ".cm-line.cm-live-callout-warning, .cm-line.cm-live-callout-caution, .cm-line.cm-live-callout-attention":
              { "--callout-color": "#e68a2e" },
            ".cm-line.cm-live-callout-failure, .cm-line.cm-live-callout-fail, .cm-line.cm-live-callout-missing, .cm-line.cm-live-callout-danger, .cm-line.cm-live-callout-error, .cm-line.cm-live-callout-bug":
              { "--callout-color": "#df4f5f" },
            ".cm-line.cm-live-callout-example": { "--callout-color": "#8b6bd6" },
            ".cm-line.cm-live-callout-quote, .cm-line.cm-live-callout-cite": {
              "--callout-color": "#7d8794",
            },
            ".cm-line.cm-live-callout-title": {
              borderTop: "1px solid color-mix(in oklab, var(--callout-color) 20%, transparent)",
              borderRadius: "0.4rem 0.4rem 0 0",
              paddingTop: "0.55rem",
              color: "color-mix(in oklab, var(--callout-color) 82%, var(--foreground))",
              fontWeight: "650",
            },
            ".cm-line.cm-live-callout-end": {
              borderBottom: "1px solid color-mix(in oklab, var(--callout-color) 20%, transparent)",
              borderRadius: "0 0 0.4rem 0.4rem",
              paddingBottom: "0.55rem",
            },
            ".cm-line.cm-live-callout-title.cm-live-callout-end": {
              borderRadius: "0.4rem",
            },
            ".cm-live-callout-icon": {
              display: "inline-block",
              width: "1.1rem",
              marginRight: "0.3rem",
              color: "inherit",
              fontSize: "0.8rem",
              textAlign: "center",
            },
            ".cm-heading-fold, .cm-list-fold": {
              display: "inline-grid",
              height: "1.25rem",
              placeItems: "center",
              border: "0",
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              padding: "0",
              opacity: "0",
            },
            ".cm-heading-fold": {
              width: "1.25rem",
              marginLeft: "-1.5rem",
              marginRight: "0.25rem",
              verticalAlign: "-0.12em",
            },
            ".cm-heading-fold svg, .cm-list-fold svg": {
              transform: "rotate(90deg)",
            },
            ".cm-heading-fold svg": { width: "0.95rem", height: "0.95rem" },
            ".cm-list-fold": {
              width: "1rem",
              marginLeft: "-1rem",
              verticalAlign: "-0.1em",
            },
            ".cm-list-fold svg": { width: "0.8rem", height: "0.8rem" },
            ".cm-heading-fold[aria-expanded='false'] svg, .cm-list-fold[aria-expanded='false'] svg":
              { transform: "rotate(0deg)" },
            ".cm-foldPlaceholder": {
              marginLeft: "0.25rem",
              border: "0",
              backgroundColor: "transparent",
              padding: "0",
              color: "var(--muted-foreground)",
            },
            ".cm-line:hover > .cm-heading-fold, .cm-heading-fold:hover, .cm-heading-fold:focus-visible, .cm-heading-fold[aria-expanded='false'], .cm-line:hover > .cm-list-fold, .cm-list-fold:hover, .cm-list-fold:focus-visible, .cm-list-fold[aria-expanded='false']":
              {
                opacity: "0.72",
              },
            ".cm-live-comment": {
              borderRadius: "0.2rem",
              backgroundColor: "color-mix(in oklab, #8b6bd6 16%, transparent)",
              color: "color-mix(in oklab, #8b6bd6 72%, var(--foreground))",
            },
            ".cm-live-block-ref": { color: "var(--muted-foreground)", fontSize: "0.85em" },
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!findRequest || !view) return;
    openSearchPanel(view);
    view.focus();
  }, [findRequest]);

  useEffect(() => {
    const view = viewRef.current;
    if (!revealRequest || !view) return;
    const line = view.state.doc.line(
      Math.max(1, Math.min(revealRequest.line, view.state.doc.lines))
    );
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }, [revealRequest]);

  return <div ref={hostRef} />;
}

export function MarkdownEditor({
  document,
  mode,
  onChange,
  onTitleChange,
  onTitleCommit,
  showBacklinks,
  findRequest,
  revealRequest,
  onDropDocument,
  onOpenDocument,
  onOpenUrl,
  documents = [],
}: {
  document: DemoDocument;
  mode: MarkdownMode;
  onChange: (value: string) => void;
  onTitleChange: (title: string) => void;
  onTitleCommit?: (title: string) => void;
  showBacklinks: boolean;
  findRequest: number;
  revealRequest?: {
    heading: string;
    line: number;
    request: number;
    absolute?: boolean;
  };
  onDropDocument?: (title: string) => void;
  onOpenDocument?: (identifier: string, inPlace?: boolean) => void;
  onOpenUrl?: (url: string) => void;
  documents?: DemoDocument[];
}) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const { frontmatter, body: rawBody } = splitFrontmatter(document.content);
  const activeTitle = document.path ?? document.title;
  const linkedMentions = useMemo(
    () => (showBacklinks ? linkedMentionsFor(documents, activeTitle) : []),
    [activeTitle, documents, showBacklinks]
  );
  const unlinkedMentions = useMemo(
    () => (showBacklinks ? unlinkedMentionsFor(documents, activeTitle) : []),
    [activeTitle, documents, showBacklinks]
  );
  const isDailyNote = useMemo(() => {
    return document.path?.includes("Daily/") || /^\d{4}-\d{2}-\d{2}$/.test(document.title);
  }, [document.path, document.title]);

  const { body, strippedPrefix } = useMemo(() => {
    if (!isDailyNote) return { body: rawBody, strippedPrefix: "" };
    const heading = `# ${document.title}`;
    const match = rawBody.match(/^([ \t]*)/);
    const leadingWhitespace = match ? match[1] : "";
    const trimmed = rawBody.slice(leadingWhitespace.length);
    if (
      trimmed.startsWith(heading) &&
      (trimmed.length === heading.length || trimmed[heading.length] === "\n")
    ) {
      const prefixEnd = leadingWhitespace.length + heading.length;
      const afterHeading = rawBody[prefixEnd] === "\n" ? prefixEnd + 1 : prefixEnd;
      return { body: rawBody.slice(afterHeading), strippedPrefix: rawBody.slice(0, afterHeading) };
    }
    return { body: rawBody, strippedPrefix: "" };
  }, [rawBody, isDailyNote, document.title]);

  const groupMentions = (mentions: ReturnType<typeof linkedMentionsFor>) => {
    const grouped = new Map<string, typeof mentions>();
    for (const mention of mentions) {
      const group = grouped.get(mention.source) ?? [];
      group.push(mention);
      grouped.set(mention.source, group);
    }
    return [...grouped];
  };

  const linkedGroups = useMemo(() => groupMentions(linkedMentions), [linkedMentions]);
  const unlinkedGroups = useMemo(() => groupMentions(unlinkedMentions), [unlinkedMentions]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [linkedExpanded, setLinkedExpanded] = useState(true);
  const [unlinkedExpanded, setUnlinkedExpanded] = useState(false);

  const toggleGroup = (key: string, isCurrentlyExpanded: boolean) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !isCurrentlyExpanded,
    }));
  };

  const titleFromPath = (path: string) => {
    return (
      path
        .split("/")
        .pop()
        ?.replace(/\.(md|markdown)$/i, "") ?? path
    );
  };

  const highlightQuery = (text: string, query: string) => {
    if (!text) return null;
    const cleanTarget =
      query
        .split("/")
        .pop()
        ?.replace(/\.(md|markdown)$/i, "") ?? query;
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const targetEsc = escapeRegExp(cleanTarget);

    const linkPattern = new RegExp(
      `(\\[\\[[^\\]]*${targetEsc}[^\\]]*\\]\\]|\\[[^\\]]+\\]\\([^)]*${targetEsc}[^)]*\\)|${targetEsc})`,
      "gi"
    );

    const parts = text.split(linkPattern);

    return (
      <span>
        {parts.map((part, idx) =>
          linkPattern.test(part) ? (
            <mark
              key={idx}
              className="inline rounded border border-[#a68a26]/60 bg-[#685512]/40 px-1 py-0.5 font-mono text-[11px] font-medium text-[#ffe57f] shadow-xs"
            >
              {part}
            </mark>
          ) : (
            <span key={idx}>{part}</span>
          )
        )}
      </span>
    );
  };

  const renderGroupList = (
    groups: Array<[string, ReturnType<typeof linkedMentionsFor>]>,
    defaultExpanded: boolean = false,
    type: "linked" | "unlinked"
  ) => (
    <div className="space-y-3">
      {groups.map(([source, mentions]) => {
        const key = `${type}::${activeTitle}::${source}`;
        const stored = expandedGroups[key];
        const isExpanded = stored !== undefined ? stored : defaultExpanded;
        return (
          <div key={source} className="space-y-1.5">
            <button
              type="button"
              onClick={() => toggleGroup(key, isExpanded)}
              className="flex w-full items-center justify-between text-left text-xs font-semibold text-foreground outline-none group py-0.5"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <ChevronRight
                  className={`size-3.5 shrink-0 transition-transform text-muted-foreground ${isExpanded ? "rotate-90" : ""}`}
                />
                <span className="truncate">{titleFromPath(source)}</span>
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">{mentions.length}</span>
            </button>
            {isExpanded && (
              <div className="space-y-2">
                {mentions.map((mention, idx) => (
                  <button
                    key={`${mention.line}-${idx}`}
                    type="button"
                    onClick={() => {
                      onOpenDocument?.(source);
                      const detail = { path: source, line: mention.line, excerpt: mention.excerpt };
                      const dispatch = () =>
                        window.dispatchEvent(new CustomEvent("flux-navigate-editor", { detail }));
                      dispatch();
                      setTimeout(dispatch, 30);
                      setTimeout(dispatch, 100);
                      setTimeout(dispatch, 250);
                    }}
                    className="w-full text-left rounded-md border border-[var(--layout-separator)] bg-muted/20 p-2.5 hover:bg-accent/40 transition-colors outline-none block shadow-xs"
                  >
                    <div className="text-[11px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap break-words">
                      {highlightQuery(mention.excerpt, document.title)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const handleNavigate = (target: string) => {
    const resolve = resolverFor(documents);
    const resolvedPath = resolve(target, document);
    if (resolvedPath) {
      onOpenDocument?.(resolvedPath, true);
    } else {
      onOpenDocument?.(target, true);
    }
  };

  useEffect(() => {
    if (!revealRequest || mode !== "read" || !editorRootRef.current) return;
    const heading = [...editorRootRef.current.querySelectorAll("h1,h2,h3,h4,h5,h6")].find(
      (element) => element.textContent?.trim() === revealRequest.heading.trim()
    );
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [mode, revealRequest]);

  return (
    <div
      ref={editorRootRef}
      className="flux-editor-scroll h-full min-h-0 overflow-y-auto overscroll-contain"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const title = event.dataTransfer.getData("text/plain").trim();
        if (title) onDropDocument?.(title);
      }}
    >
      <div className="mx-auto flex w-full max-w-[760px] items-start px-9 pb-3 pt-6">
        <input
          aria-label="Document title"
          value={document.title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={(event) => onTitleCommit?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] outline-none placeholder:text-muted-foreground"
          placeholder="Untitled"
        />
      </div>
      {mode !== "read" ? (
        <MarkdownSource
          key={mode}
          value={body}
          live={mode === "live"}
          documents={documents}
          findRequest={findRequest}
          revealRequest={
            revealRequest
              ? {
                  ...revealRequest,
                  line: revealRequest.absolute
                    ? Math.max(1, revealRequest.line - (frontmatter.split(/\r?\n/).length - 1))
                    : revealRequest.line,
                }
              : undefined
          }
          onChange={(value) => onChange(frontmatter + strippedPrefix + value)}
          documentPath={document.path ?? document.title}
          frontmatterLines={frontmatter ? frontmatter.split("\n").length - 1 : 0}
          onOpenUrl={onOpenUrl}
        />
      ) : (
        <ReadingViewBoundary key={`${document.title}:${body}`}>
          <Suspense fallback={<RenderingState />}>
            <ReadingView value={body} documents={documents} onNavigate={handleNavigate} onOpenUrl={onOpenUrl} />
          </Suspense>
        </ReadingViewBoundary>
      )}
      {showBacklinks ? (
        <section className="mx-auto max-w-[760px] border-t px-9 py-6 space-y-6 [border-color:var(--layout-separator)]">
          {/* Linked Mentions Section */}
          {/* Linked Mentions Section */}
          <div className="mb-6">
            <button
              className="flex w-full items-center justify-between py-1 font-medium text-foreground/80 mb-2 outline-none group hover:text-foreground transition-colors"
              onClick={() => setLinkedExpanded((prev) => !prev)}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <ChevronRight
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${linkedExpanded ? "rotate-90 text-foreground" : "group-hover:text-foreground"}`}
                />
                <span className="text-[13px]">Linked mentions</span>
              </div>
              <span className="text-[12px] text-muted-foreground opacity-60">
                {linkedMentions.length}
              </span>
            </button>
            {linkedExpanded &&
              (linkedGroups.length ? (
                renderGroupList(linkedGroups, true, "linked")
              ) : (
                <p className="text-[11px] text-muted-foreground opacity-60 px-5">
                  No backlinks found.
                </p>
              ))}
          </div>

          {/* Unlinked Mentions Section */}
          <div>
            <button
              className="flex w-full items-center justify-between py-1 font-medium text-foreground/80 mb-2 outline-none group hover:text-foreground transition-colors"
              onClick={() => setUnlinkedExpanded((prev) => !prev)}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <ChevronRight
                  className={`size-3.5 shrink-0 transition-transform ${unlinkedExpanded ? "rotate-90 text-foreground" : "group-hover:text-foreground"}`}
                />
                <span className="text-[13px]">Unlinked mentions</span>
              </div>
              <span className="text-[12px] text-muted-foreground opacity-60">
                {unlinkedMentions.length}
              </span>
            </button>
            {unlinkedExpanded &&
              (unlinkedGroups.length ? (
                renderGroupList(unlinkedGroups, false, "unlinked")
              ) : (
                <p className="text-[11px] text-muted-foreground px-5">
                  No unlinked mentions found.
                </p>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const menuItemClassName =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 pr-7 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
function MenuCheck() {
  return <Check className="absolute right-2 size-3.5" />;
}

function DisabledItem({ children }: { children: ReactNode }) {
  return (
    <MenuItem className={menuItemClassName} disabled>
      {children}
    </MenuItem>
  );
}

function MenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <CossMenuSub>
      <MenuSubTrigger className={menuItemClassName}>
        {icon}
        {label}
      </MenuSubTrigger>
      <MenuSubPopup sideOffset={4} className="z-[120] min-w-56">
        {children}
      </MenuSubPopup>
    </CossMenuSub>
  );
}

export function MarkdownDocumentMenu({
  mode,
  showBacklinks,
  bookmarked,
  onModeChange,
  onBacklinksChange,
  onBookmarkChange,
  onRename,
  onAddProperty,
  onFind,
  onDelete,
  onMerge,
  onOpenLinkedView,
  onVersionHistory,
  onRevealInNavigation,
  onMoveToNewWindow,
  onSplitRight,
  onSplitDown,
  onExportPdf,
  title,
}: {
  mode: MarkdownMode;
  showBacklinks: boolean;
  bookmarked: boolean;
  onModeChange: (mode: MarkdownMode) => void;
  onBacklinksChange: (show: boolean) => void;
  onBookmarkChange: (bookmarked: boolean) => void;
  onRename: () => void;
  onAddProperty: () => void;
  onFind: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onOpenLinkedView: (view: "graph" | "backlinks" | "outgoing" | "properties" | "outline") => void;
  onVersionHistory: () => void;
  onRevealInNavigation: () => void;
  onMoveToNewWindow: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onExportPdf: () => void;
  title: string;
}) {
  const copy = (value: string) => void navigator.clipboard.writeText(value);
  const fileName = `${title || "Untitled"}.md`;

  return (
    <MenuGroup>
      <MenuCheckboxItem checked={showBacklinks} onCheckedChange={onBacklinksChange}>
        Backlinks in document
      </MenuCheckboxItem>
      <MenuItem className={menuItemClassName} onClick={() => onModeChange("read")}>
        <BookOpen className="size-4 text-muted-foreground" />
        Reading view{mode === "read" ? <MenuCheck /> : null}
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={() => onModeChange("live")}>
        <Eye className="size-4 text-muted-foreground" />
        Live Preview{mode === "live" ? <MenuCheck /> : null}
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={() => onModeChange("source")}>
        <Pencil className="size-4 text-muted-foreground" />
        Source mode{mode === "source" ? <MenuCheck /> : null}
      </MenuItem>
      <MenuSeparator />
      <MenuItem className={menuItemClassName} onClick={onSplitRight}>
        <PanelRightOpen className="size-4" />
        Split right
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onSplitDown}>
        <PanelBottomOpen className="size-4" />
        Split down
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onMoveToNewWindow}>
        <ExternalLink className="size-4" />
        Open in new window
      </MenuItem>
      <MenuSeparator />
      <MenuItem className={menuItemClassName} onClick={onRename}>
        <FilePenLine className="size-4 text-muted-foreground" />
        Rename…
      </MenuItem>
      <DisabledItem>
        <FolderInput className="size-4" />
        Move file to…
      </DisabledItem>
      <MenuItem className={menuItemClassName} onClick={() => onBookmarkChange(true)}>
        <Bookmark className="size-4 text-muted-foreground" />
        Bookmark…
        {bookmarked ? <MenuCheck /> : null}
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onMerge}>
        <Merge className="size-4" />
        Merge entire file with…
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onAddProperty}>
        <ListPlus className="size-4 text-muted-foreground" />
        Add file property
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onExportPdf}>
        <FileDown className="size-4 text-muted-foreground" />
        Export to PDF…
      </MenuItem>
      <MenuSeparator />
      <MenuItem className={menuItemClassName} onClick={onFind}>
        <Search className="size-4 text-muted-foreground" />
        Find…
      </MenuItem>
      <MenuItem className={menuItemClassName} onClick={onFind}>
        <Pencil className="size-4 text-muted-foreground" />
        Replace…
      </MenuItem>
      <MenuSub label="Copy path" icon={<Copy className="size-4 text-muted-foreground" />}>
        <MenuItem
          className={menuItemClassName}
          onClick={() => copy(`flux://open?file=${encodeURIComponent(fileName)}`)}
        >
          as Symtab URL
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => copy(`Personal vault/${fileName}`)}>
          from vault folder
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => copy(`/Personal vault/${fileName}`)}>
          from system root
        </MenuItem>
      </MenuSub>
      <MenuItem className={menuItemClassName} onClick={onVersionHistory}>
        <History className="size-4" />
        Open version history
      </MenuItem>
      <MenuSub label="Open linked view" icon={<Network className="size-4 text-muted-foreground" />}>
        <MenuItem className={menuItemClassName} onClick={() => onOpenLinkedView("graph")}>
          Open local graph
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => onOpenLinkedView("backlinks")}>
          Open backlinks
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => onOpenLinkedView("outgoing")}>
          Open outgoing links
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => onOpenLinkedView("properties")}>
          Open file properties
        </MenuItem>
        <MenuItem className={menuItemClassName} onClick={() => onOpenLinkedView("outline")}>
          Open outline
        </MenuItem>
      </MenuSub>
      <MenuSeparator />
      <DisabledItem>
        <ExternalLink className="size-4" />
        Open in default app
      </DisabledItem>
      <DisabledItem>
        <FolderInput className="size-4" />
        Reveal in Finder
      </DisabledItem>
      <MenuItem className={menuItemClassName} onClick={onRevealInNavigation}>
        <FolderInput className="size-4" />
        Reveal file in navigation
      </MenuItem>
      <MenuItem className={menuItemClassName} variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" />
        Delete file
      </MenuItem>
      <DisabledItem>
        <Plus className="size-4" />
        New drawing
      </DisabledItem>
    </MenuGroup>
  );
}

export function MarkdownViewToggle({
  mode,
  onModeChange,
}: {
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
}) {
  return (
    <button
      type="button"
      aria-label={mode === "read" ? "Open Live Preview" : "Open reading view"}
      title={mode === "read" ? "Live Preview" : "Reading view"}
      onClick={() => onModeChange(mode === "read" ? "live" : "read")}
      className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
    >
      {mode === "read" ? <Pencil className="size-4" /> : <BookOpen className="size-4" />}
    </button>
  );
}
