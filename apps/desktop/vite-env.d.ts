/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    ping: () => Promise<string>;
    getWindowId: () => Promise<string>;
    onCommand: (handler: (command: string) => void) => () => void;
    checkForUpdates: () => Promise<{
      currentVersion: string;
      latestVersion?: string;
      releaseNotes?: string;
      codename?: string;
    }>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
    onUpdateStatus: (
      handler: (status: import("@symtab/app-core").UpdateRuntimeStatus) => void
    ) => () => void;
    getAppVersion: () => Promise<string>;
    getPerformanceStats: () => Promise<{
      cpuPercent: number;
      memoryMB: number;
    }>;
    setTheme: (theme: "dark" | "light" | "system") => Promise<void>;
    setMenuBarIconEnabled: (enabled: boolean) => Promise<void>;
    openWindow: (url: string) => Promise<void>;
    onBeforeClose: (handler: () => Promise<void>) => () => void;
    exportPdf: (options: {
      title: string;
      pageSize: "A4" | "Letter";
      landscape: boolean;
      marginMillimetres: number;
      scale: number;
    }) => Promise<string | null>;
    selectVaultDirectory: (mode: "open" | "create" | "location") => Promise<string | null>;
    symtabFetch: (request: {
      url: string;
      method?: string;
      body?: string;
    }) => Promise<{ status: number; body: string; bodyBase64?: string; contentType: string }>;
    watchVaultRevision: (
      vaultId: string,
      onRevision: (revision: number) => void,
      onError?: (message: string) => void
    ) => () => void;
    watchVaultChanges: (
      vaultId: string,
      onChange: (change: import("@symtab/bridge-contract").VaultChange) => void,
      onError?: (message: string) => void
    ) => () => void;
  };
}
