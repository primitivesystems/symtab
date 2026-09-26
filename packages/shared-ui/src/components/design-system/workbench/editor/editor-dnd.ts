import type { EditorGroupId, EditorTab, SplitPlacement } from "./editor-model";

export type DropPlacement = SplitPlacement | "center";

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function isCopyOperation(event: Pick<DragEvent, "altKey" | "ctrlKey">) {
  return isMac() ? event.altKey : event.ctrlKey;
}

export function isSplitToggleOperation(event: Pick<DragEvent, "altKey" | "shiftKey">) {
  return isMac() ? event.shiftKey : event.altKey;
}

const EDITOR_DROP_TYPES = [
  "application/x-symtab-editor-tab",
  "application/x-symtab-path",
  "application/x-symtab-file",
  "Files",
  "text/plain",
] as const;

export function hasEditorDropData(dataTransfer: DataTransfer) {
  return EDITOR_DROP_TYPES.some((type) => Array.from(dataTransfer.types).includes(type));
}

export function readDroppedTab(dataTransfer: DataTransfer): {
  tab: EditorTab;
  source?: EditorGroupId;
} | null {
  const editorTab = dataTransfer.getData("application/x-symtab-editor-tab");
  if (editorTab) {
    try {
      const parsed = JSON.parse(editorTab) as {
        tab?: Partial<EditorTab>;
        source?: EditorGroupId;
      };
      if (typeof parsed.tab?.id !== "string" || typeof parsed.tab.title !== "string") return null;
      return {
        tab: {
          id: parsed.tab.id,
          title: parsed.tab.title,
          dirty: parsed.tab.dirty,
          content: parsed.tab.content,
          readOnly: parsed.tab.readOnly,
        },
        source: parsed.source,
      };
    } catch {
      return null;
    }
  }

  const file = dataTransfer.files[0];
  if (file) return { tab: { id: `file:${file.name}`, title: file.name } };

  const raw =
    dataTransfer.getData("application/x-symtab-path") ||
    dataTransfer.getData("application/x-symtab-file") ||
    dataTransfer.getData("text/plain");
  if (!raw || raw.includes("\n")) return null;

  let path = raw;
  try {
    const parsed = JSON.parse(raw) as { path?: string; name?: string; title?: string };
    const candidate = parsed.path ?? parsed.name ?? parsed.title;
    if (typeof candidate === "string") path = candidate;
  } catch {
    // Sidebar payloads may be plain paths.
  }

  const title = path.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (!title) return null;
  return { tab: { id: `file:${path}`, title } };
}
