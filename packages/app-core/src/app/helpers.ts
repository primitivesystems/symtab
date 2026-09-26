import type { SymtabClient, ServerStatus, VaultInfo } from "@symtab/bridge-contract";
import type { DemoDocument } from "../editor/markdown-editor";
import type { VaultLifecycleState } from "./state";
import type { WorkspaceTab } from "../workspace/tabs";
import type { WorkspaceLeafView, WorkspaceNode } from "../workspace/tree";

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

const bootstrapStatus = new WeakMap<SymtabClient, Promise<ServerStatus>>();

export function getBootstrapStatus(client: SymtabClient) {
  let pending = bootstrapStatus.get(client);
  if (!pending) {
    pending = client.getStatus().catch((error: unknown) => {
      bootstrapStatus.delete(client);
      throw error;
    });
    bootstrapStatus.set(client, pending);
  }
  return pending;
}

export function lifecycleFromVault(info: VaultInfo): VaultLifecycleState {
  const state = info.state as string;
  if (
    state === "initializing" ||
    state === "read_only_ready" ||
    state === "writable" ||
    state === "indexing" ||
    state === "active" ||
    state === "degraded"
  ) {
    return state;
  }
  return state === "ready" ? "active" : "degraded";
}

export const bookmarkItemsKey = (vaultId?: string) =>
  `symtab-bookmarks-items:${vaultId ?? "default"}`;

export const bookmarkGroupsKey = (vaultId?: string) =>
  `symtab-bookmarks-groups:${vaultId ?? "default"}`;

export function restoreWorkspaceRoot(
  node: WorkspaceNode | undefined,
  tabIds: Set<number>
): WorkspaceNode | null {
  if (!node) return null;
  if (node.kind === "leaf") {
    const kept = node.tabIds.filter((id) => tabIds.has(id));
    if (!kept.length) return null;
    return {
      ...node,
      view: node.view === "pdf" ? "editor" : node.view,
      tabIds: kept,
      activeTabId: kept.includes(node.activeTabId) ? node.activeTabId : kept[0],
    };
  }
  const first = restoreWorkspaceRoot(node.children[0], tabIds);
  const second = restoreWorkspaceRoot(node.children[1], tabIds);
  if (!first) return second;
  if (!second) return first;
  return { ...node, children: [first, second] };
}

export function maxWorkspaceNodeId(node: WorkspaceNode): number {
  return node.kind === "leaf"
    ? node.id
    : Math.max(node.id, maxWorkspaceNodeId(node.children[0]), maxWorkspaceNodeId(node.children[1]));
}

export function titleFromPath(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
}

export function fileTitleFromPath(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^./]+$/, "");
}

export function workspaceTabPath(tab: WorkspaceTab) {
  return tab.document?.path ?? tab.pdf?.path ?? tab.preview?.path ?? tab.deferred?.path;
}

export function workspaceTabView(tab: WorkspaceTab | undefined): WorkspaceLeafView {
  return tab?.kind === "graph" ? "graph" : tab?.kind === "browser" ? "browser" : "editor";
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}

export function mimeTypeForPath(path: string) {
  const extension = path.toLocaleLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    "3gp": "audio/3gpp",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    mkv: "video/x-matroska",
  };
  return types[extension] ?? "application/octet-stream";
}

export function decodedText(data: ArrayBuffer) {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (content.includes("\0")) return null;
    const sample = content.slice(0, 8_192);
    const readable = [...sample].filter(
      (character) =>
        character === "\n" || character === "\r" || character === "\t" || character >= " "
    ).length;
    return sample.length === 0 || readable / sample.length > 0.9 ? content : null;
  } catch {
    return null;
  }
}

export function markdownPath(parent: string, title: string) {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled";
  return parent ? `${parent}/${safeTitle}.md` : `${safeTitle}.md`;
}

export function movedDocumentPath(candidate: string, source: string, destination: string) {
  if (candidate === source) return destination;
  return candidate.startsWith(`${source}/`)
    ? destination + candidate.slice(source.length)
    : candidate;
}

export function singleTextEdit(before: string, after: string) {
  const oldRunes = Array.from(before);
  const newRunes = Array.from(after);
  let prefix = 0;
  while (
    prefix < oldRunes.length &&
    prefix < newRunes.length &&
    oldRunes[prefix] === newRunes[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldRunes.length - prefix &&
    suffix < newRunes.length - prefix &&
    oldRunes[oldRunes.length - 1 - suffix] === newRunes[newRunes.length - 1 - suffix]
  )
    suffix++;
  const encoder = new TextEncoder();
  return {
    startByte: encoder.encode(oldRunes.slice(0, prefix).join("")).length,
    endByte: encoder.encode(oldRunes.slice(0, oldRunes.length - suffix).join("")).length,
    text: newRunes.slice(prefix, newRunes.length - suffix).join(""),
  };
}

export function documentFromLocation(library: DemoDocument[], fallback: DemoDocument) {
  if (typeof window === "undefined") return fallback;
  const title = new URLSearchParams(window.location.search).get("popout");
  return library.find((document) => document.title === title) ?? fallback;
}
