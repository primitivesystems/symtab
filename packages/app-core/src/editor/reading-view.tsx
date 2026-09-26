import { memo, useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import Prism from "prismjs";
import { katex } from "@mdit/plugin-katex";
import callouts from "markdown-it-callouts";
// @ts-expect-error package ships no declarations
import footnote from "markdown-it-footnote";
// @ts-expect-error package ships no declarations
import mark from "markdown-it-mark";
// @ts-expect-error package ships no declarations
import taskLists from "markdown-it-task-lists";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";

import { useTheme } from "@symtab/shared-ui/components/theme-provider";
import { splitFrontmatter } from "./frontmatter";
import type { DemoDocument } from "./markdown-editor";
import { calloutSymbols } from "./obsidian-markdown";
import { showRenderError } from "./render-feedback";

Prism.languages.typescript = Prism.languages.extend("javascript", {
  keyword:
    /\b(?:abstract|as|asserts|declare|enum|implements|interface|keyof|namespace|never|private|protected|public|readonly|satisfies|type|unknown)\b/,
  builtin: /\b(?:any|boolean|number|string|symbol|undefined|void)\b/,
});
Prism.languages.ts = Prism.languages.typescript;

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!
  );
}

function obsidianInline(md: MarkdownIt) {
  md.inline.ruler.before("image", "obsidian_wikilink", (state, silent) => {
    const start = state.pos;
    const embedded = state.src.startsWith("![[", start);
    if (!embedded && !state.src.startsWith("[[", start)) return false;
    const contentFrom = start + (embedded ? 3 : 2);
    const close = state.src.indexOf("]]", contentFrom);
    if (close < 0 || close >= state.posMax) return false;
    if (!silent) {
      const inner = state.src.slice(contentFrom, close);
      const [target, alias] = inner.split("|", 2);
      const label = alias || target;
      if (embedded) {
        const token = state.push("obsidian_embed", "", 0);
        token.meta = { target, label };
      } else {
        const open = state.push("link_open", "a", 1);
        open.attrSet("href", `#${encodeURIComponent(target)}`);
        open.attrSet("class", "internal-link");
        const text = state.push("text", "", 0);
        text.content = label;
        state.push("link_close", "a", -1);
      }
    }
    state.pos = close + 2;
    return true;
  });

  md.inline.ruler.before("emphasis", "obsidian_comment", (state, silent) => {
    if (!state.src.startsWith("%%", state.pos)) return false;
    const close = state.src.indexOf("%%", state.pos + 2);
    if (close < 0 || close >= state.posMax) return false;
    if (!silent) state.push("obsidian_comment", "", 0);
    state.pos = close + 2;
    return true;
  });

  md.inline.ruler.before("text", "obsidian_block_ref", (state, silent) => {
    const match = /^\^[\w-]+\s*$/.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) state.push("obsidian_block_ref", "", 0);
    state.pos += match[0].length;
    return true;
  });

  md.inline.ruler.before("text", "obsidian_tag", (state, silent) => {
    const match = /^#[\p{L}\p{N}_-][\p{L}\p{N}/_-]*/u.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrSet("href", `#${encodeURIComponent(match[0].slice(1))}`);
      open.attrSet("class", "tag");
      const text = state.push("text", "", 0);
      text.content = match[0];
      state.push("link_close", "a", -1);
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.obsidian_comment = () => "";
  md.renderer.rules.obsidian_block_ref = () => "";
  md.renderer.rules.obsidian_embed = (tokens, index, _options, env) => {
    const { target, label } = tokens[index].meta as { target: string; label: string };
    const documents = (env.documents ?? []) as DemoDocument[];
    const stack = new Set<string>((env.stack ?? []) as string[]);
    const document = documents.find((item) => item.title === target);
    if (!document || stack.has(target)) {
      return `<span class="internal-embed is-missing"><a href="#${encodeURIComponent(target)}">${escapeHtml(label)}</a></span>`;
    }
    stack.add(target);
    const body = splitFrontmatter(document.content).body;
    return `<aside class="internal-embed" data-embed-title="${escapeHtml(target)}">${md.render(
      body,
      {
        ...env,
        stack: [...stack],
      }
    )}</aside>`;
  };

  md.renderer.rules.heading_open = (tokens, index, _options, env) => {
    const token = tokens[index];
    const level = Number(token.tag.slice(1));
    const id = `heading-${(env.headingIndex = (env.headingIndex ?? 0) + 1)}`;
    return `<${token.tag} data-heading-level="${level}"><button type="button" class="heading-fold" data-heading-fold="${id}" aria-label="Collapse heading" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></button>`;
  };
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    const grammar = Prism.languages[language];
    return grammar ? Prism.highlight(code, grammar, language) : escapeHtml(code);
  },
})
  .use(katex)
  .use(mark)
  .use(footnote)
  .use(taskLists, { enabled: true })
  .use(callouts, {
    calloutSymbols,
    emptyTitleFallback: "match-type",
  })
  .use(obsidianInline);

const defaultLinkValidator = md.validateLink.bind(md);
md.validateLink = (url) =>
  defaultLinkValidator(url) ||
  /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(url.trim());

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.info.trim() === "mermaid") {
    return `<div class="symtab-mermaid" data-source="${encodeURIComponent(token.content)}"></div>`;
  }
  return defaultFence(tokens, index, options, env, self);
};

export function renderMarkdownHtml(value: string, documents: DemoDocument[]) {
  return DOMPurify.sanitize(md.render(value, { documents, headingIndex: 0 }), {
    ADD_ATTR: [
      "data-source",
      "data-embed-title",
      "data-heading-fold",
      "data-heading-level",
      "data-folded-by",
    ],
  });
}

let markdownCache: { value: string; documents: DemoDocument[]; html: string } | undefined;
let hydratedCache: { source: string; theme: "light" | "dark"; html: string } | undefined;

function cachedMarkdownHtml(value: string, documents: DemoDocument[]) {
  if (markdownCache?.value === value && markdownCache.documents === documents) {
    return markdownCache.html;
  }
  const html = renderMarkdownHtml(value, documents);
  markdownCache = { value, documents, html };
  return html;
}

function ReadingView({
  value,
  documents,
  onNavigate,
}: {
  value: string;
  documents: DemoDocument[];
  onNavigate?: (target: string) => void;
}) {
  const { theme } = useTheme();
  const resolvedTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const sourceHtml = useMemo(() => cachedMarkdownHtml(value, documents), [documents, value]);
  const [html, setHtml] = useState(() =>
    hydratedCache?.source === sourceHtml && hydratedCache.theme === resolvedTheme
      ? hydratedCache.html
      : sourceHtml
  );

  useEffect(() => {
    if (hydratedCache?.source === sourceHtml && hydratedCache.theme === resolvedTheme) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const parsed = new DOMParser().parseFromString(sourceHtml, "text/html");
      const diagrams = parsed.querySelectorAll<HTMLElement>(".symtab-mermaid");
      if (!diagrams.length) {
        hydratedCache = { source: sourceHtml, theme: resolvedTheme, html: sourceHtml };
        if (!cancelled) setHtml(sourceHtml);
        return;
      }

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: resolvedTheme === "dark" ? "dark" : "neutral",
        flowchart: {
          curve: "linear",
          htmlLabels: false,
          useMaxWidth: true,
        },
      });

      const failures: unknown[] = [];
      for (const [index, diagram] of [...diagrams].entries()) {
        try {
          const source = decodeURIComponent(diagram.dataset.source ?? "");
          const { svg } = await mermaid.render(`symtab-mermaid-${Date.now()}-${index}`, source);
          diagram.innerHTML = svg;
        } catch (error) {
          failures.push(error);
          diagram.textContent = "Unable to render this diagram.";
        }
      }

      const nextHtml = parsed.body.innerHTML;
      hydratedCache = { source: sourceHtml, theme: resolvedTheme, html: nextHtml };
      if (!cancelled) {
        setHtml(nextHtml);
        if (failures[0]) showRenderError("Mermaid diagram", failures[0]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedTheme, sourceHtml, theme]);

  return (
    <article
      className="symtab-reading-view mx-auto max-w-[760px] px-9 pb-24 pt-2"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
        if (link && onNavigate) {
          const href = link.getAttribute("href");
          if (href && !href.startsWith("http")) {
            event.preventDefault();
            let target = href;
            if (href.startsWith("#")) target = decodeURIComponent(href.slice(1));
            onNavigate(target);
            return;
          }
        }

        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-heading-fold]"
        );
        const heading = button?.parentElement;
        if (!button || !heading) return;
        const id = button.dataset.headingFold!;
        const level = Number(heading.dataset.headingLevel);
        const collapse = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!collapse));
        button.setAttribute("aria-label", collapse ? "Expand heading" : "Collapse heading");
        for (
          let element = heading.nextElementSibling;
          element;
          element = element.nextElementSibling
        ) {
          const nextLevel = Number((element as HTMLElement).dataset.headingLevel);
          if (nextLevel && nextLevel <= level) break;
          const owners = new Set(
            (element.getAttribute("data-folded-by") ?? "").split(" ").filter(Boolean)
          );
          if (collapse) owners.add(id);
          else owners.delete(id);
          element.setAttribute("data-folded-by", [...owners].join(" "));
          (element as HTMLElement).hidden = owners.size > 0;
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(ReadingView);
