import { useCallback, useEffect, useRef } from "react";
import type { PluginCapability } from "@symtab/plugin-sdk";

export type PluginViewLocation = "modal" | "left-sidebar" | "right-sidebar" | "workspace";

export interface OpenPluginView {
  pluginId: string;
  viewId: string;
  title: string;
  html: string;
}

export function sandboxedPluginDocument(html: string) {
  const policy =
    `<meta http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; ` +
    `img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${html.slice(0, insertAt)}${policy}${html.slice(insertAt)}`;
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(html);
  if (root?.index !== undefined) {
    const insertAt = root.index + root[0].length;
    return `${html.slice(0, insertAt)}<head>${policy}</head>${html.slice(insertAt)}`;
  }
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
}

export function PluginSurface({
  view,
  revision,
  onClose,
  invokeCapability,
  showHeader = true,
}: {
  view: OpenPluginView;
  revision: number;
  onClose: () => void;
  invokeCapability: (
    pluginId: string,
    capability: PluginCapability,
    input: unknown
  ) => Promise<unknown>;
  showHeader?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const postTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      {
        kind: "symtab-plugin-theme",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      },
      "*"
    );
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as {
        type?: string;
        kind?: string;
        id?: number;
        capability?: PluginCapability;
        input?: unknown;
      };
      if (message.type === "close_plugin_view") {
        onClose();
        return;
      }
      if (
        message.kind !== "symtab-plugin-capability" ||
        typeof message.id !== "number" ||
        typeof message.capability !== "string"
      )
        return;
      void invokeCapability(view.pluginId, message.capability, message.input).then(
        (value) =>
          frameRef.current?.contentWindow?.postMessage(
            { kind: "symtab-plugin-capability-result", id: message.id, value },
            "*"
          ),
        (error) =>
          frameRef.current?.contentWindow?.postMessage(
            {
              kind: "symtab-plugin-capability-result",
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "*"
          )
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [invokeCapability, onClose, view.pluginId]);

  useEffect(() => {
    const observer = new MutationObserver(postTheme);
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [postTheme]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {showHeader ? (
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 [border-color:var(--layout-separator)]">
          <h2 className="truncate text-xs font-semibold">{view.title}</h2>
          <button
            type="button"
            aria-label={`Close ${view.title}`}
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            Close
          </button>
        </header>
      ) : null}
      <iframe
        ref={frameRef}
        key={`${view.pluginId}:${view.viewId}:${revision}`}
        title={view.title}
        sandbox="allow-scripts"
        srcDoc={sandboxedPluginDocument(view.html)}
        onLoad={postTheme}
        className="min-h-0 w-full flex-1 border-0 bg-sidebar"
      />
    </section>
  );
}

export function PluginModal({
  view,
  revision,
  onClose,
  invokeCapability,
}: {
  view?: OpenPluginView;
  revision: number;
  onClose: () => void;
  invokeCapability: (
    pluginId: string,
    capability: PluginCapability,
    input: unknown
  ) => Promise<unknown>;
}) {
  if (!view) return null;
  return (
    <div className="fixed inset-0 z-[210] grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <section className="h-[min(44rem,90vh)] w-full max-w-5xl overflow-hidden rounded-xl border bg-background shadow-2xl [border-color:var(--layout-separator)]">
        <PluginSurface
          view={view}
          revision={revision}
          onClose={onClose}
          invokeCapability={invokeCapability}
        />
      </section>
    </div>
  );
}
