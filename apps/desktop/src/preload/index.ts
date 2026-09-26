import { contextBridge, ipcRenderer } from "electron";
import type { VaultChange } from "@symtab/bridge-contract";

let nextWatcherId = 0;

contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => ipcRenderer.invoke("ping"),
  getWindowId: () => ipcRenderer.invoke("get-window-id"),
  onCommand: (handler: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => handler(command);
    ipcRenderer.on("symtab-command", listener);
    return () => ipcRenderer.off("symtab-command", listener);
  },
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: (handler: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => handler(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.off("update-status", listener);
  },
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPerformanceStats: () => ipcRenderer.invoke("get-performance-stats"),
  setTheme: (theme: "dark" | "light" | "system") => ipcRenderer.invoke("set-native-theme", theme),
  setMenuBarIconEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("set-menu-bar-icon-enabled", enabled),
  openWindow: (url: string) => ipcRenderer.invoke("open-window", url),
  onBeforeClose: (handler: () => Promise<void>) => {
    const listener = () => {
      void handler().then(
        () => ipcRenderer.send("symtab-close-ready"),
        (error) =>
          ipcRenderer.send(
            "symtab-close-failed",
            error instanceof Error ? error.message : "Could not save changes"
          )
      );
    };
    ipcRenderer.on("symtab-before-close", listener);
    return () => ipcRenderer.off("symtab-before-close", listener);
  },
  exportPdf: (options: {
    title: string;
    pageSize: "A4" | "Letter";
    landscape: boolean;
    marginMillimetres: number;
    scale: number;
  }) => ipcRenderer.invoke("export-pdf", options),
  selectVaultDirectory: (mode: "open" | "create" | "location") =>
    ipcRenderer.invoke("select-vault-directory", mode),
  symtabFetch: (request: { url: string; method?: string; body?: string }) =>
    ipcRenderer.invoke("symtab-fetch", request),
  watchVaultRevision: (
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (message: string) => void
  ) => {
    const watcherId = `${Date.now()}-${++nextWatcherId}`;
    const revisionChannel = `vault-revision:${watcherId}`;
    const errorChannel = `vault-revision-error:${watcherId}`;
    const handleRevision = (_event: Electron.IpcRendererEvent, change: VaultChange) =>
      onRevision(change.revision);
    const handleError = (_event: Electron.IpcRendererEvent, message: string) => onError?.(message);
    ipcRenderer.on(revisionChannel, handleRevision);
    ipcRenderer.on(errorChannel, handleError);
    ipcRenderer.send("watch-vault-revision", { watcherId, vaultId });
    return () => {
      ipcRenderer.off(revisionChannel, handleRevision);
      ipcRenderer.off(errorChannel, handleError);
      ipcRenderer.send("unwatch-vault-revision", watcherId);
    };
  },
  watchVaultChanges: (
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (message: string) => void
  ) => {
    const watcherId = `${Date.now()}-${++nextWatcherId}`;
    const revisionChannel = `vault-revision:${watcherId}`;
    const errorChannel = `vault-revision-error:${watcherId}`;
    const handleRevision = (_event: Electron.IpcRendererEvent, change: VaultChange) =>
      onChange(change);
    const handleError = (_event: Electron.IpcRendererEvent, message: string) => onError?.(message);
    ipcRenderer.on(revisionChannel, handleRevision);
    ipcRenderer.on(errorChannel, handleError);
    ipcRenderer.send("watch-vault-revision", { watcherId, vaultId });
    return () => {
      ipcRenderer.off(revisionChannel, handleRevision);
      ipcRenderer.off(errorChannel, handleError);
      ipcRenderer.send("unwatch-vault-revision", watcherId);
    };
  },
});
