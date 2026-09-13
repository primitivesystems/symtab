export const APP_NAME = "Symtab";
export const APP_VERSION = "0.0.1";

export const DEFAULT_SETTINGS = {
  theme: "system" as const,
  fontSize: 16,
  fontFamily: "Inter, system-ui, sans-serif",
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
};

export const SUPPORTED_FILE_FORMATS = [".md", ".txt", ".json"];

export const API_ENDPOINTS = {
  NOTES: "/api/notes",
  BLOCKS: "/api/blocks",
  GRAPH: "/api/graph",
  WORKSPACE: "/api/workspace",
  SEARCH: "/api/search",
} as const;
