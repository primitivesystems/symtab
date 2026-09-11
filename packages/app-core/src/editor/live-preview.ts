import {
  codeFolding,
  foldEffect,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import "katex/dist/katex.min.css";
import { splitFrontmatter } from "./frontmatter";
import { calloutSymbols, wikiLabel } from "./obsidian-markdown";
import type { DemoDocument } from "./markdown-editor";

const HIDDEN_MARKS = new Set([
  "CodeInfo",
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "HighlightMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
  "URL",
  "WikiLinkMark",
]);

let mermaidId = 0;

function reveal(view: EditorView, anchor: number, head?: number) {
  view.dispatch({ selection: { anchor, head: head ?? anchor }, scrollIntoView: true });
  view.focus();
}

async function renderMath(source: string, element: HTMLElement, displayMode = false) {
  try {
    const katex = await import("katex");
    if (element.isConnected) {
      katex.default.render(source, element, { displayMode, throwOnError: false, strict: false });
    }
  } catch {
    element.textContent = source;
  }
}

function renderCode(source: string, language: string, element: HTMLElement) {
  const parser =
    language === "typescript" || language === "ts"
      ? typescriptLanguage.parser
      : language === "javascript" || language === "js"
        ? javascriptLanguage.parser
        : null;
  if (!parser) {
    element.textContent = source;
    return;
  }

  let position = 0;
  highlightTree(parser.parse(source), classHighlighter, (from, to, classes) => {
    if (from > position) element.append(source.slice(position, from));
    const span = document.createElement("span");
    span.className = classes;
    span.textContent = source.slice(from, to);
    element.append(span);
    position = to;
  });
  if (position < source.length) element.append(source.slice(position));
}

class TaskWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private checkboxFrom: number
  ) {
    super();
  }

  eq(widget: TaskWidget) {
    return widget.checked === this.checked && widget.checkboxFrom === this.checkboxFrom;
  }

  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.className = "cm-live-task";
    input.type = "checkbox";
    input.checked = this.checked;
    input.ariaLabel = this.checked ? "Mark task incomplete" : "Mark task complete";
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.checkboxFrom,
          to: this.checkboxFrom + 3,
          insert: input.checked ? "[x]" : "[ ]",
        },
      });
    });
    return input;
  }

  ignoreEvent() {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-live-horizontal-rule";
    return rule;
  }
}

function disclosureIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m9 18 6-6-6-6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "2");
  svg.append(path);
  return svg;
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private label: string,
    private ordered: boolean
  ) {
    super();
  }

  eq(widget: ListMarkerWidget) {
    return widget.label === this.label && widget.ordered === this.ordered;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.ordered ? "cm-live-list-number" : "cm-live-list-bullet";
    marker.textContent = this.label;
    return marker;
  }
}

function listDepthAt(state: EditorState, position: number) {
  let depth = -1;
  let node = syntaxTree(state).resolveInner(position, 1);
  while (true) {
    if (node.name === "ListItem") depth++;
    if (!node.parent) break;
    node = node.parent;
  }
  return Math.max(0, Math.min(depth, 6));
}

function listBullet(depth: number) {
  return ["•", "◦", "▪"][depth % 3];
}

class CalloutIconWidget extends WidgetType {
  constructor(private type: string) {
    super();
  }

  eq(widget: CalloutIconWidget) {
    return widget.type === this.type;
  }

  toDOM() {
    const icon = document.createElement("span");
    icon.className = "cm-live-callout-icon";
    icon.ariaHidden = "true";
    icon.textContent = calloutSymbols[this.type] ?? calloutSymbols.note;
    return icon;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private source: string,
    private alt: string,
    private from: number,
    private standalone: boolean
  ) {
    super();
  }

  eq(widget: ImageWidget) {
    return (
      widget.source === this.source &&
      widget.alt === this.alt &&
      widget.from === this.from &&
      widget.standalone === this.standalone
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = this.standalone
      ? "cm-live-image-wrap cm-live-image-block"
      : "cm-live-image-wrap";
    const image = document.createElement("img");
    image.className = "cm-live-image";
    image.src = this.source;
    image.alt = this.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      wrapper.classList.add("cm-live-image-error");
      wrapper.textContent = this.alt || "Image unavailable";
    });
    wrapper.append(image);
    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      reveal(view, this.from + 2);
    });
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

class InlineWidget extends WidgetType {
  constructor(
    private kind: "embed" | "escape" | "footnote" | "math" | "wikilink",
    private source: string,
    private from: number
  ) {
    super();
  }

  eq(widget: InlineWidget) {
    return widget.kind === this.kind && widget.source === this.source && widget.from === this.from;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("span");
    element.className = `cm-live-inline cm-live-${this.kind}`;
    if (this.kind === "math") {
      element.textContent = this.source;
      void renderMath(this.source, element);
    } else if (this.kind === "footnote") {
      element.textContent = this.source;
    } else {
      element.textContent = this.source;
    }
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      reveal(view, this.from + 1);
    });
    return element;
  }

  ignoreEvent() {
    return true;
  }
}

class EmbedWidget extends WidgetType {
  constructor(
    private target: string,
    private from: number,
    private documents: DemoDocument[]
  ) {
    super();
  }

  eq(widget: EmbedWidget) {
    return (
      widget.target === this.target &&
      widget.from === this.from &&
      widget.documents === this.documents
    );
  }

  toDOM(view: EditorView) {
    const referencedDocument = this.documents.find((item) => item.title === this.target);
    if (!referencedDocument) {
      const missing = window.document.createElement("span");
      missing.className = "cm-live-embed-missing";
      missing.textContent = this.target;
      return missing;
    }

    const embed = window.document.createElement("aside");
    embed.className = "cm-live-embed-block";
    embed.dataset.embedTitle = this.target;
    const content = window.document.createElement("div");
    content.className = "flux-reading-view cm-live-embed-content";
    embed.append(content);
    void import("./reading-view").then(async ({ renderMarkdownHtml }) => {
      if (content.isConnected) {
        content.innerHTML = await renderMarkdownHtml(
          splitFrontmatter(referencedDocument.content).body,
          this.documents
        );
      }
    });
    embed.addEventListener("mousedown", (event) => {
      event.preventDefault();
      reveal(view, this.from + 1);
    });
    return embed;
  }

  ignoreEvent() {
    return true;
  }
}

class BlockWidget extends WidgetType {
  private observer?: MutationObserver;

  constructor(
    private kind: "code" | "math" | "mermaid" | "table" | "html",
    private source: string,
    private from: number,
    private to: number,
    private language = ""
  ) {
    super();
  }

  eq(widget: BlockWidget) {
    return (
      widget.kind === this.kind &&
      widget.source === this.source &&
      widget.from === this.from &&
      widget.to === this.to &&
      widget.language === this.language
    );
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = `cm-live-block cm-live-${this.kind}-block`;
    element.title = "Click to edit source";
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      reveal(view, this.from, this.to);
    });

    if (this.kind === "table") {
      element.append(renderTable(this.source));
    } else if (this.kind === "math") {
      element.textContent = this.source;
      void renderMath(this.source, element, true);
    } else if (this.kind === "mermaid") {
      const render = () => void this.renderMermaid(element);
      render();
      this.observer = new MutationObserver(render);
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } else if (this.kind === "html") {
      element.classList.add("flux-reading-view");
      (async () => {
        const dompurify = await import("dompurify");
        if (element.isConnected) {
          element.innerHTML = dompurify.default.sanitize(this.source);
        }
      })();
    } else {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (this.language) code.dataset.language = this.language;
      renderCode(this.source, this.language, code);
      pre.append(code);
      element.append(pre);
    }
    return element;
  }

  private async renderMermaid(element: HTMLElement) {
    element.textContent = "Rendering diagram…";
    try {
      const mermaid = await import("mermaid");
      mermaid.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        flowchart: { curve: "linear", htmlLabels: false, useMaxWidth: true },
      });
      const { svg } = await mermaid.default.render(`flux-live-mermaid-${++mermaidId}`, this.source);
      if (element.isConnected) element.innerHTML = svg;
    } catch {
      if (element.isConnected) element.textContent = "Unable to render this diagram.";
    }
  }

  destroy() {
    this.observer?.disconnect();
  }

  ignoreEvent() {
    return true;
  }
}

function tableCells(line: string) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\\" && value[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (value[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += value[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function renderTable(source: string) {
  const lines = source.split("\n");
  const headers = tableCells(lines[0] ?? "");
  const delimiters = tableCells(lines[1] ?? "");
  const alignments = delimiters.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });
  const table = document.createElement("table");
  table.className = "cm-live-table";
  const head = table.createTHead().insertRow();
  headers.forEach((text, index) => {
    const cell = document.createElement("th");
    cell.textContent = text;
    cell.style.textAlign = alignments[index] ?? "left";
    head.append(cell);
  });
  const body = table.createTBody();
  for (const line of lines.slice(2)) {
    const row = body.insertRow();
    const cells = tableCells(line);
    headers.forEach((_, index) => {
      const cell = row.insertCell();
      cell.textContent = cells[index] ?? "";
      cell.style.textAlign = alignments[index] ?? "left";
    });
  }
  return table;
}

function fencedBlock(source: string) {
  const firstBreak = source.indexOf("\n");
  const lastBreak = source.lastIndexOf("\n");
  const header = source.slice(0, firstBreak < 0 ? source.length : firstBreak);
  const match = /^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/.exec(header);
  return {
    language: match?.[1]?.toLowerCase() ?? "",
    content:
      firstBreak < 0 ? "" : source.slice(firstBreak + 1, Math.max(firstBreak + 1, lastBreak)),
  };
}

type BlockSpec = {
  kind: "code" | "math" | "mermaid" | "table" | "html";
  source: string;
  from: number;
  to: number;
  language?: string;
};

function buildBlockSpecs(state: EditorState): BlockSpec[] {
  const specs: BlockSpec[] = [];
  const fencedRanges: Array<[number, number]> = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.type.name === "HTMLBlock") {
        const source = state.doc.sliceString(node.from, node.to);
        const lines = source.split("\n");
        
        let currentFrom = node.from;
        let currentSource = "";
        let currentChunkFrom = node.from;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineLength = line.length + (i < lines.length - 1 ? 1 : 0);
          
          const isCompleteLine = /^\s*<([a-zA-Z][\w-]*)[^>]*>.*<\/\1>\s*$/i.test(line) || 
                                 /^\s*<([a-zA-Z][\w-]*)[^>]*\/>\s*$/i.test(line);

          if (isCompleteLine) {
            if (currentSource.trim()) {
              fencedRanges.push([currentChunkFrom, currentFrom]);
              specs.push({ kind: "html", source: currentSource, from: currentChunkFrom, to: currentFrom });
              currentSource = "";
            }
            
            // Push this complete single-line tag as its own block
            fencedRanges.push([currentFrom, currentFrom + line.length]); // Exclude \n from the highlight boundary
            specs.push({ kind: "html", source: line, from: currentFrom, to: currentFrom + line.length });
            
            currentChunkFrom = currentFrom + lineLength;
          } else {
            currentSource += line + (i < lines.length - 1 ? "\n" : "");
          }
          
          currentFrom += lineLength;
        }

        if (currentSource.trim()) {
          fencedRanges.push([currentChunkFrom, node.to]);
          specs.push({ kind: "html", source: currentSource, from: currentChunkFrom, to: node.to });
        }
        
        return false;
      }
      if (node.type.name !== "FencedCode") return;
      const { language, content } = fencedBlock(state.doc.sliceString(node.from, node.to));
      fencedRanges.push([node.from, node.to]);
      specs.push({
        kind: language === "mermaid" ? "mermaid" : "code",
        source: content,
        from: node.from,
        to: node.to,
        language,
      });
      return false;
    },
  });

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (
      line.text.trim() !== "$$" ||
      fencedRanges.some(([from, to]) => from <= line.from && to >= line.to)
    ) {
      continue;
    }

    for (let endNumber = number + 1; endNumber <= state.doc.lines; endNumber++) {
      const end = state.doc.line(endNumber);
      if (end.text.trim() !== "$$") continue;
      specs.push({
        kind: "math",
        source: state.doc.sliceString(line.to + 1, end.from).trim(),
        from: line.from,
        to: end.to,
      });
      number = endNumber;
      break;
    }
  }

  const overlaps = (from: number, to: number) =>
    specs.some((spec) => spec.from <= to && spec.to >= from);
  for (let number = 1; number < state.doc.lines; number++) {
    const header = state.doc.line(number);
    const delimiter = state.doc.line(number + 1);
    if (!header.text.includes("|") || overlaps(header.from, delimiter.to)) continue;
    const headers = tableCells(header.text);
    const delimiters = tableCells(delimiter.text);
    if (
      headers.length !== delimiters.length ||
      delimiters.length === 0 ||
      !delimiters.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      continue;
    }

    let last = delimiter;
    while (last.number < state.doc.lines) {
      const next = state.doc.line(last.number + 1);
      if (!next.text.trim() || !next.text.includes("|") || overlaps(next.from, next.to)) break;
      last = next;
    }
    specs.push({
      kind: "table",
      source: state.doc.sliceString(header.from, last.to),
      from: header.from,
      to: last.to,
    });
    number = last.number;
  }

  return specs.sort((a, b) => a.from - b.from);
}

function blockDecorations(state: EditorState, specs: BlockSpec[]) {
  const active = state.selection.ranges;
  return Decoration.set(
    specs
      .filter((spec) => !active.some((range) => range.from <= spec.to && range.to >= spec.from))
      .map((spec) =>
        Decoration.replace({
          block: true,
          widget: new BlockWidget(spec.kind, spec.source, spec.from, spec.to, spec.language),
        }).range(spec.from, spec.to)
      )
  );
}

type BlockPreviewState = { specs: BlockSpec[]; decorations: DecorationSet };

const blockPreview = StateField.define<BlockPreviewState>({
  create(state) {
    const specs = buildBlockSpecs(state);
    return { specs, decorations: blockDecorations(state, specs) };
  },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    const specs = transaction.docChanged ? buildBlockSpecs(transaction.state) : value.specs;
    return { specs, decorations: blockDecorations(transaction.state, specs) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

function livePreviewDecorations(
  view: EditorView,
  documents: DemoDocument[]
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const replacements: Array<[number, number]> = [];
  const protectedRanges: Array<[number, number]> = [];
  const activeRanges = view.state.selection.ranges;
  const isActive = (from: number, to = from) =>
    activeRanges.some((range) => range.from <= to && range.to >= from);

  const activeLines = activeRanges.map((range) => [
    view.state.doc.lineAt(range.from).number,
    view.state.doc.lineAt(range.to).number,
  ]);
  const isActiveLine = (from: number, to = from) => {
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    return activeLines.some(([start, end]) => start <= last && end >= first);
  };
  const intersects = (ranges: Array<[number, number]>, from: number, to: number) =>
    ranges.some(([start, end]) => start < to && end > from);
  const callouts: Array<{ first: number; last: number; type: string }> = [];
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const definition = /^>\s*\[!([\w-]+)\][+-]?/i.exec(view.state.doc.line(number).text);
    if (!definition) continue;
    let last = number;
    while (last < view.state.doc.lines && /^>/.test(view.state.doc.line(last + 1).text)) last++;
    callouts.push({ first: number, last, type: definition[1].toLowerCase() });
    number = last;
  }
  const intersectsCallout = (from: number, to: number) => {
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    return callouts.some((callout) => callout.first <= last && callout.last >= first);
  };

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.type.name === "FencedCode" || node.type.name === "InlineCode") {
          protectedRanges.push([node.from, node.to]);
        }
      },
    });
  }

  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!intersects(protectedRanges, line.from, line.to) && !isActive(line.from, line.to)) {
        if (/^\s{0,3}(?:-{3,}|\*\s*\*\s*\*+|_\s*_\s*_+)\s*$/.test(line.text)) {
          replacements.push([line.from, line.to]);
          decorations.push(
            Decoration.replace({ widget: new HorizontalRuleWidget() }).range(line.from, line.to)
          );
        }

        const callout = callouts.find(
          ({ first, last }) => first <= line.number && line.number <= last
        );
        let contentFrom = line.from;
        if (callout) {
          const marker =
            line.number === callout.first
              ? /^>\s*\[![\w-]+\][+-]?\s*/i.exec(line.text)?.[0]
              : /^>\s?/.exec(line.text)?.[0];
          if (marker) {
            const to = line.from + marker.length;
            contentFrom = to;
            replacements.push([line.from, to]);
            decorations.push(Decoration.replace({}).range(line.from, to));
            if (line.number === callout.first) {
              decorations.push(
                Decoration.widget({ side: 1, widget: new CalloutIconWidget(callout.type) }).range(
                  to
                )
              );
            }
          }
          decorations.push(
            Decoration.line({
              class: [
                "cm-live-callout",
                `cm-live-callout-${callout.type}`,
                line.number === callout.first ? "cm-live-callout-title" : "cm-live-callout-body",
                line.number === callout.last ? "cm-live-callout-end" : "",
              ]
                .filter(Boolean)
                .join(" "),
            }).range(line.from)
          );
        }

        const content =
          callout && line.number === callout.first ? "" : line.text.slice(contentFrom - line.from);
        const task = /^(\s*)[-+*]\s+\[([ xX])\]\s*/.exec(content);
        if (task) {
          const from = contentFrom;
          const to = contentFrom + task[0].length;
          const checkboxFrom = contentFrom + task[0].indexOf("[");
          const depth = listDepthAt(view.state, contentFrom + task[1].length);
          replacements.push([from, to]);
          decorations.push(
            Decoration.replace({
              widget: new TaskWidget(task[2].toLowerCase() === "x", checkboxFrom),
            }).range(from, to)
          );
          decorations.push(
            Decoration.line({ class: `cm-live-list-line cm-live-list-depth-${depth}` }).range(
              line.from
            )
          );
        } else {
          const bullet = /^(\s*)[-+*]\s+/.exec(content);
          if (bullet) {
            const from = contentFrom;
            const to = contentFrom + bullet[0].length;
            const depth = listDepthAt(view.state, contentFrom + bullet[1].length);
            replacements.push([from, to]);
            decorations.push(
              Decoration.replace({ widget: new ListMarkerWidget(listBullet(depth), false) }).range(
                from,
                to
              )
            );
            decorations.push(
              Decoration.line({ class: `cm-live-list-line cm-live-list-depth-${depth}` }).range(
                line.from
              )
            );
          } else {
            const ordered = /^(\s*)(\d+)([.)])\s+/.exec(content);
            if (ordered) {
              const from = contentFrom;
              const to = contentFrom + ordered[0].length;
              const depth = listDepthAt(view.state, contentFrom + ordered[1].length);
              replacements.push([from, to]);
              decorations.push(
                Decoration.replace({
                  widget: new ListMarkerWidget(`${ordered[2]}${ordered[3]}`, true),
                }).range(from, to)
              );
              decorations.push(
                Decoration.line({ class: `cm-live-list-line cm-live-list-depth-${depth}` }).range(
                  line.from
                )
              );
            }
          }
        }

        for (const match of line.text.matchAll(
          /!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g
        )) {
          const from = line.from + match.index;
          const to = from + match[0].length;
          if (intersects(replacements, from, to)) continue;
          replacements.push([from, to]);
          decorations.push(
            Decoration.replace({
              widget: new ImageWidget(match[2], match[1], from, line.text.trim() === match[0]),
            }).range(from, to)
          );
        }

        for (const match of line.text.matchAll(/(^|[^\\$])\$([^$\n]+?)\$/g)) {
          const from = line.from + match.index + match[1].length;
          const to = from + match[0].length - match[1].length;
          if (intersects(replacements, from, to)) continue;
          replacements.push([from, to]);
          decorations.push(
            Decoration.replace({ widget: new InlineWidget("math", match[2], from) }).range(from, to)
          );
        }
      }

      if (line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const name = node.type.name;
        if (name === "FencedCode") {
          if (isActive(node.from, node.to)) {
            let codeLine = view.state.doc.lineAt(node.from);
            while (codeLine.from < node.to) {
              decorations.push(
                Decoration.line({ class: "cm-live-codeblock" }).range(codeLine.from)
              );
              if (codeLine.to >= node.to || codeLine.number === view.state.doc.lines) break;
              codeLine = view.state.doc.line(codeLine.number + 1);
            }
          }
          return false;
        }

        if (!isActiveLine(node.from, node.to)) {
          if (name === "WikiLink" || name === "Embed") {
            const source = view.state.doc.sliceString(node.from, node.to);
            replacements.push([node.from, node.to]);
            decorations.push(
              Decoration.replace({
                widget:
                  name === "Embed"
                    ? new EmbedWidget(wikiLabel(source), node.from, documents)
                    : new InlineWidget("wikilink", wikiLabel(source), node.from),
              }).range(node.from, node.to)
            );
            return false;
          }
          if (name === "FootnoteRef") {
            const label = view.state.doc.sliceString(node.from + 2, node.to - 1);
            replacements.push([node.from, node.to]);
            decorations.push(
              Decoration.replace({
                widget: new InlineWidget("footnote", `[${label}]`, node.from),
              }).range(node.from, node.to)
            );
            return false;
          }
          if (name === "Comment") {
            decorations.push(
              Decoration.mark({ class: "cm-live-comment" }).range(node.from, node.to)
            );
            return false;
          }
          if (name === "BlockRef") {
            decorations.push(
              Decoration.mark({ class: "cm-live-block-ref" }).range(node.from, node.to)
            );
            return false;
          }
          if (name === "Escape") {
            const source = view.state.doc.sliceString(node.from, node.to);
            replacements.push([node.from, node.to]);
            decorations.push(
              Decoration.replace({
                widget: new InlineWidget("escape", source.slice(1), node.from),
              }).range(node.from, node.to)
            );
            return false;
          }
          if (name === "Highlight") {
            decorations.push(
              Decoration.mark({ class: "cm-live-highlight" }).range(node.from, node.to)
            );
          } else if (name === "Tag") {
            decorations.push(Decoration.mark({ class: "cm-live-tag" }).range(node.from, node.to));
          }
        }

        if (
          !isActiveLine(node.from, node.to) &&
          HIDDEN_MARKS.has(name) &&
          !intersects(replacements, node.from, node.to)
        ) {
          const to =
            name === "HeaderMark" && view.state.doc.sliceString(node.to, node.to + 1) === " "
              ? node.to + 1
              : node.to;
          decorations.push(Decoration.replace({}).range(node.from, to));
          return;
        }

        const headingLevel = name.startsWith("ATXHeading") ? Number(name.slice(-1)) : 0;
        if (headingLevel) {
          decorations.push(
            Decoration.line({
              class: `cm-live-heading-line cm-live-h${headingLevel}-line`,
            }).range(view.state.doc.lineAt(node.from).from)
          );
        }
        const className = headingLevel
          ? `cm-live-heading cm-live-h${headingLevel}`
          : name === "StrongEmphasis"
            ? "cm-live-strong"
            : name === "Emphasis"
              ? "cm-live-emphasis"
              : name === "InlineCode"
                ? "cm-live-code"
                : name === "Link"
                  ? "cm-live-link"
                  : name === "Strikethrough"
                    ? "cm-live-strike"
                    : name === "Blockquote" && !intersectsCallout(node.from, node.to)
                      ? "cm-live-quote"
                      : "";
        if (className) {
          decorations.push(Decoration.mark({ class: className }).range(node.from, node.to));
        }
      },
    });
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

const inlinePreview = (documents: DemoDocument[]) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = livePreviewDecorations(view, documents);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = livePreviewDecorations(update.view, documents);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );

function headingRange(state: EditorState, number: number) {
  const heading = state.doc.line(number);
  const match = /^(#{1,6})\s+/.exec(heading.text);
  if (!match) return null;
  for (let nextNumber = number + 1; nextNumber <= state.doc.lines; nextNumber++) {
    const next = state.doc.line(nextNumber);
    const nextMatch = /^(#{1,6})\s+/.exec(next.text);
    if (nextMatch && nextMatch[1].length <= match[1].length) {
      return heading.to < next.from - 1 ? { from: heading.to, to: next.from - 1 } : null;
    }
  }
  return heading.to < state.doc.length ? { from: heading.to, to: state.doc.length } : null;
}

function isFolded(state: EditorState, from: number) {
  let folded = false;
  foldedRanges(state).between(from, from + 1, (rangeFrom) => {
    if (rangeFrom === from) folded = true;
  });
  return folded;
}

class FoldWidget extends WidgetType {
  constructor(
    private range: { from: number; to: number },
    private folded: boolean,
    private kind: "heading" | "list"
  ) {
    super();
  }

  eq(widget: FoldWidget) {
    return (
      widget.range.from === this.range.from &&
      widget.range.to === this.range.to &&
      widget.folded === this.folded &&
      widget.kind === this.kind
    );
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-${this.kind}-fold`;
    button.append(disclosureIcon());
    const label = this.kind === "heading" ? "heading" : "list item";
    button.ariaLabel = `${this.folded ? "Expand" : "Collapse"} ${label}`;
    button.setAttribute("aria-expanded", String(!this.folded));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      view.dispatch({
        effects: (this.folded ? unfoldEffect : foldEffect).of(this.range),
      });
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function foldDecorations(state: EditorState) {
  const decorations: Range<Decoration>[] = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const range = headingRange(state, number);
    if (!range) continue;
    const line = state.doc.line(number);
    decorations.push(
      Decoration.widget({
        side: -1,
        widget: new FoldWidget(range, isFolded(state, range.from), "heading"),
      }).range(line.from)
    );
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (node.type.name !== "ListItem") return;
      const line = state.doc.lineAt(node.from);
      if (node.to <= line.to) return;
      const range = { from: line.to, to: node.to };
      decorations.push(
        Decoration.widget({
          side: -2,
          widget: new FoldWidget(range, isFolded(state, range.from), "list"),
        }).range(line.from)
      );
    },
  });
  return Decoration.set(decorations, true);
}

const foldControls = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = foldDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((item) => item.effects.length)
      ) {
        this.decorations = foldDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

export const livePreview = (documents: DemoDocument[]) => [
  blockPreview,
  codeFolding(),
  foldControls,
  inlinePreview(documents),
];
