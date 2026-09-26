import { useCallback, useEffect, useMemo } from "react";

import { useAppStore } from "./state";

export interface GeneralSettings {
  launchBehaviour: "last-vault" | "empty" | "vault-picker";
  confirmDeleteNote: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  defaultStartupPage: "last-active" | "files" | "graph" | "daily-note";
  showInlineTitle: boolean;
  showTabBar: boolean;
  showMenuBarIcon: boolean;
}

export interface EditorSettings {
  livePreview: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  spellCheck: boolean;
  autoPairBrackets: boolean;
  fontSize: number;
  tabSize: number;
  vimBindings: boolean;
}

export interface AppearanceSettings {
  theme: "dark" | "light" | "system";
  accentColor: string;
  sidebarDensity: "compact" | "comfortable" | "spacious";
  fontScaling: number;
}

export interface KeychainEntry {
  id: string;
  name: string;
  service: string;
  key: string;
  status: "configured" | "not-set";
  createdAt: string;
}

export interface SymtabSettings {
  general: GeneralSettings;
  editor: EditorSettings;
  appearance: AppearanceSettings;
  keychain: KeychainEntry[];
  plugins: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: SymtabSettings = {
  general: {
    launchBehaviour: "last-vault",
    confirmDeleteNote: true,
    autoSave: true,
    autoSaveDelay: 3,
    defaultStartupPage: "last-active",
    showInlineTitle: true,
    showTabBar: true,
    showMenuBarIcon: true,
  },
  editor: {
    livePreview: true,
    wordWrap: true,
    lineNumbers: true,
    spellCheck: true,
    autoPairBrackets: true,
    fontSize: 16,
    tabSize: 4,
    vimBindings: false,
  },
  appearance: {
    theme: "system",
    accentColor: "default",
    sidebarDensity: "comfortable",
    fontScaling: 100,
  },
  keychain: [],
  plugins: {
    "file-explorer": true,
    search: true,
    "graph-view": true,
    bookmarks: true,
    "live-preview": true,
    canvas: true,
    "ai-chat": true,
    backlinks: true,
    "command-palette": true,
    "daily-notes": true,
    "file-recovery": true,
    "note-composer": true,
    "page-preview": true,
    "quick-switcher": true,
    sync: true,
    templates: true,
    outline: true,
    properties: true,
    "word-count": true,
  },
};

function mergeSettings(settings?: Partial<SymtabSettings>): SymtabSettings {
  return {
    general: { ...DEFAULT_SETTINGS.general, ...settings?.general },
    editor: { ...DEFAULT_SETTINGS.editor, ...settings?.editor },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...settings?.appearance },
    keychain: settings?.keychain ?? DEFAULT_SETTINGS.keychain,
    plugins: { ...DEFAULT_SETTINGS.plugins, ...settings?.plugins },
  };
}

export const APP_STATE_KEY = "symtabSettings";

export function loadSettings(): SymtabSettings {
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: SymtabSettings): void {
  applyAppearanceSettings(settings.appearance);
}

export function applyAppearanceSettings(appearance: AppearanceSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (appearance.accentColor && appearance.accentColor !== "default") {
    root.style.setProperty("--primary", appearance.accentColor);
  } else {
    root.style.removeProperty("--primary");
  }

  const densityPaddingMap: Record<string, string> = {
    compact: "0.25rem",
    comfortable: "0.5rem",
    spacious: "0.75rem",
  };
  root.style.setProperty(
    "--sidebar-density-padding",
    densityPaddingMap[appearance.sidebarDensity] || "0.5rem"
  );

  if (appearance.fontScaling && appearance.fontScaling !== 100) {
    root.style.fontSize = `${(appearance.fontScaling / 100) * 100}%`;
  } else {
    root.style.fontSize = "";
  }
}

export function useSymtabSettings() {
  const storedSettings = useAppStore(
    (state) => state.settings[APP_STATE_KEY] as SymtabSettings | undefined
  );
  const storedTheme = useAppStore((state) => state.settings.theme);
  const setSetting = useAppStore((state) => state.setSetting);
  const settings = useMemo(
    () =>
      mergeSettings({
        ...(storedSettings ?? loadSettings()),
        appearance: {
          ...(storedSettings ?? loadSettings()).appearance,
          ...(storedTheme === "dark" || storedTheme === "light" || storedTheme === "system"
            ? { theme: storedTheme }
            : {}),
        },
      }),
    [storedSettings, storedTheme]
  );

  useEffect(() => {
    applyAppearanceSettings(settings.appearance);
    if (!storedSettings) setSetting(APP_STATE_KEY, settings);
  }, [setSetting, settings, storedSettings]);

  const updateSettings = useCallback(
    (updater: (prev: SymtabSettings) => SymtabSettings) => {
      const current = mergeSettings(
        useAppStore.getState().settings[APP_STATE_KEY] as SymtabSettings | undefined
      );
      const next = mergeSettings(updater(current));
      setSetting(APP_STATE_KEY, next);
      setSetting("theme", next.appearance.theme);
      applyAppearanceSettings(next.appearance);
    },
    [setSetting]
  );

  return { settings, updateSettings };
}
