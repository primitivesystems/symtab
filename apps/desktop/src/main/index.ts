import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type WebContents,
} from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "path";
import { formatReleaseNotes } from "./update-notes";
import { downloadMacUpdate, getPlatformInstaller, openMacInstaller } from "./installer";
import { fetchMacRelease, isNewerVersion, type MacRelease } from "./github-release";

app.setName("Symtab");
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = process.platform !== "darwin";
if (!app.isPackaged) {
  autoUpdater.forceDevUpdateConfig = true;
}

let mainWindow: BrowserWindow | null = null;
let menuBarTray: Tray | null = null;
let backendProcess: ChildProcess | null = null;
const eventStreams = new Map<string, AbortController>();
const closeReadyWindows = new Set<number>();
const closePendingWindows = new Set<number>();
let quitAfterFlush = false;
let allowQuit = false;
let installUpdateAfterFlush = false;
let latestUpdateInfo: UpdateInfo | MacRelease | null = null;
let downloadedMacInstaller: string | null = null;
let updateDownload: Promise<void> | null = null;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);
const externalBackendOrigin = process.env.FLUX_BACKEND_URL;
let backendOrigin = externalBackendOrigin ?? "";
let backendToken = "";
let backendHeartbeat: ReturnType<typeof setInterval> | null = null;
let backendStartup: Promise<void> | null = null;
const backendStartupAttempts = 300;

function applicationIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "symtab.png")
    : path.join(currentDirectory, "../assets/icon.png");
}

function dockIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "dock-icon-dark.png")
    : path.join(currentDirectory, "../assets/dock-icon-dark.png");
}

function menuBarIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "menubarTemplate.png")
    : path.join(currentDirectory, "../assets/menubarTemplate.png");
}

type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; update: ReturnType<typeof updateDetails> }
  | { state: "not-available"; update: ReturnType<typeof updateDetails> }
  | { state: "downloading"; percent: number; transferred: number; total: number }
  | { state: "downloaded"; update: ReturnType<typeof updateDetails> }
  | { state: "verifying"; update: ReturnType<typeof updateDetails> }
  | { state: "ready"; update: ReturnType<typeof updateDetails> }
  | { state: "installing"; update: ReturnType<typeof updateDetails> }
  | { state: "error"; message: string };

function updateDetails(info: UpdateInfo | MacRelease) {
  return {
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    codename: info.releaseName || undefined,
    releaseNotes: formatReleaseNotes(info.releaseNotes),
  };
}

function sendUpdateStatus(status: UpdateStatus) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send("update-status", status);
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
autoUpdater.on("update-available", (info) => {
  latestUpdateInfo = info;
  sendUpdateStatus({ state: "available", update: updateDetails(info) });
});
autoUpdater.on("update-not-available", (info) =>
  sendUpdateStatus({ state: "not-available", update: updateDetails(info) })
);
autoUpdater.on("download-progress", (progress: ProgressInfo) =>
  sendUpdateStatus({
    state: "downloading",
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
  })
);
autoUpdater.on("update-downloaded", (info) => {
  latestUpdateInfo = info;
  sendUpdateStatus({ state: "downloaded", update: updateDetails(info) });
});
autoUpdater.on("error", (error) => sendUpdateStatus({ state: "error", message: error.message }));

function symtabAppDataDirectory() {
  if (process.env.FLUX_APP_DATA_DIR) return process.env.FLUX_APP_DATA_DIR;
  const parent = app.getPath("appData");
  const current = path.join(parent, app.isPackaged ? "Symtab" : "Symtab Development");
  const legacy = path.join(parent, app.isPackaged ? "Flux" : "Flux Development");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

interface RuntimeDescriptor {
  pid: number;
  origin: string;
  token: string;
  protocol: number;
  version: string;
}

async function attachPublishedBackend() {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(symtabAppDataDirectory(), "runtime", "daemon.json"), "utf8")
    ) as Partial<RuntimeDescriptor>;
    const origin = new URL(descriptor.origin ?? "");
    if (
      descriptor.protocol !== 1 ||
      !Number.isInteger(descriptor.pid) ||
      descriptor.pid! <= 0 ||
      !descriptor.token ||
      descriptor.version !== app.getVersion() ||
      origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "::1")
    ) {
      return false;
    }
    backendOrigin = origin.origin;
    backendToken = descriptor.token;
    return true;
  } catch {
    return false;
  }
}

async function stopStalePublishedBackend(force = false) {
  try {
    const descriptor = JSON.parse(
      await readFile(path.join(symtabAppDataDirectory(), "runtime", "daemon.json"), "utf8")
    ) as Partial<RuntimeDescriptor>;
    if (!Number.isInteger(descriptor.pid) || descriptor.pid! <= 0 || !descriptor.token) return;
    const origin = new URL(descriptor.origin ?? "");
    if (
      origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "::1")
    ) {
      return;
    }
    try {
      const response = await fetch(`${origin.origin}/api/v1/status`, {
        headers: { "X-Flux-Desktop-Token": descriptor.token },
        signal: AbortSignal.timeout(1_000),
      });
      const status = response.ok ? ((await response.json()) as { version?: unknown }) : null;
      if (!force && response.ok && status?.version === app.getVersion()) return;
    } catch {
      // Descriptor owner is alive but unreachable. Terminate it so startup can replace it.
    }
    process.kill(descriptor.pid!, "SIGTERM");
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        process.kill(descriptor.pid!, 0);
      } catch {
        break;
      }
    }
  } catch {
    // No stale runtime is published.
  }
  backendOrigin = "";
  backendToken = "";
}

function backendHeaders() {
  return backendToken ? { "X-Flux-Desktop-Token": backendToken } : undefined;
}

function streamKey(sender: WebContents, watcherId: string) {
  return `${sender.id}:${watcherId}`;
}

async function waitForRetry(signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function consumeServerEvents(
  sender: WebContents,
  url: () => string,
  signal: AbortSignal,
  onFrame: (eventName: string | undefined, data: string) => void,
  onError: (message: string) => void
) {
  while (!signal.aborted && !sender.isDestroyed()) {
    try {
      const response = await fetch(url(), { signal, headers: backendHeaders() });
      if (!response.ok || !response.body) {
        throw new Error(`Event stream failed with status ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventName = frame
            .split("\n")
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim();
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) onFrame(eventName, data);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted || sender.isDestroyed()) return;
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
    }
    await waitForRetry(signal);
  }
}

function consumeVaultEvents(
  sender: WebContents,
  watcherId: string,
  vaultId: string,
  signal: AbortSignal
) {
  return consumeServerEvents(
    sender,
    () => `${backendOrigin}/api/v1/vaults/${encodeURIComponent(vaultId)}/events`,
    signal,
    (eventName, data) => {
      if (eventName !== "revision" || sender.isDestroyed()) return;
      const payload = JSON.parse(data) as { revision?: unknown };
      if (typeof payload.revision === "number") sender.send(`vault-revision:${watcherId}`, payload);
    },
    (message) => sender.send(`vault-revision-error:${watcherId}`, message)
  );
}

async function backendReady() {
  if (!backendOrigin) return false;
  try {
    const response = await fetch(`${backendOrigin}/api/v1/status`, { headers: backendHeaders() });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBackend() {
  if (externalBackendOrigin) {
    if (await backendReady()) return;
    throw new Error(`Configured Symtab backend is unavailable at ${externalBackendOrigin}`);
  }

  if (isDev) {
    // In dev mode, try to reuse an already-running backend first.
    // Only kill and restart if none is reachable (e.g. first run, or Go source changed).
    if ((await attachPublishedBackend()) && (await backendReady())) return;
    await stopStalePublishedBackend(true);
  } else {
    if ((await attachPublishedBackend()) && (await backendReady())) return;
    await stopStalePublishedBackend(Boolean(backendOrigin));
  }

  const backendEnvironment = {
    ...process.env,
    ENVIRONMENT: "desktop",
    HOST: "127.0.0.1",
    PORT: "0",
    FLUX_APP_DATA_DIR: symtabAppDataDirectory(),
    FLUX_DESKTOP_TOKEN: "",
    FLUX_DAEMON_IDLE_TIMEOUT: "2m",
    FLUX_VERSION: app.getVersion(),
  };
  if (isDev) {
    // Main-process reload restarts daemon, so go run recompiles backend changes.
    const serverDirectory = path.resolve(currentDirectory, "../../../server");
    backendProcess = spawn(
      process.env.GO_BIN ?? "/usr/local/go/bin/go",
      ["-C", serverDirectory, "run", "-tags", "sqlite_fts5", "."],
      {
        env: backendEnvironment,
        stdio: "inherit",
        detached: true,
      }
    );
  } else {
    backendProcess = spawn(path.join(process.resourcesPath, "symtab-server"), [], {
      env: backendEnvironment,
      stdio: "inherit",
      detached: true,
    });
  }
  backendProcess.unref();
  for (let attempt = 0; attempt < backendStartupAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if ((await attachPublishedBackend()) && (await backendReady())) return;
  }
  throw new Error("Symtab backend did not become ready");
}

async function performUpdateInstallation() {
  try {
    const platform = getPlatformInstaller();
    if (!latestUpdateInfo) throw new Error("No downloaded update is ready");
    const update = updateDetails(latestUpdateInfo);
    sendUpdateStatus({ state: "installing", update });
    if (platform === "darwin") {
      if (!downloadedMacInstaller) throw new Error("Verified DMG is missing");
      await openMacInstaller(downloadedMacInstaller);
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to install update:", error);
    sendUpdateStatus({ state: "error", message });
    allowQuit = false;
    quitAfterFlush = false;
    installUpdateAfterFlush = false;
  }
}

function resumeQuitIfReady() {
  if (!quitAfterFlush || closePendingWindows.size > 0 || allowQuit) return;
  allowQuit = true;
  if (installUpdateAfterFlush) {
    // Start the async installation process without waiting
    void performUpdateInstallation();
    return;
  }
  app.quit();
}

function finishWindowFlush(window: BrowserWindow, windowId: number) {
  if (!closePendingWindows.delete(windowId)) return;
  if (quitAfterFlush) {
    resumeQuitIfReady();
    return;
  }
  if (window.isDestroyed()) return;
  closeReadyWindows.add(windowId);
  window.close();
}

function requestWindowFlush(window: BrowserWindow, windowId: number) {
  if (closePendingWindows.has(windowId)) return;
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  closePendingWindows.add(windowId);
  window.webContents.send("flux-before-close");
  const timeout = setTimeout(() => {
    if (closePendingWindows.has(windowId))
      cancelWindowFlush(
        windowId,
        "Saving is taking too long. Your window was kept open; try again after saving completes."
      );
  }, 30_000);
  timeout.unref();
}

function cancelWindowFlush(windowId: number, message: string) {
  closePendingWindows.delete(windowId);
  quitAfterFlush = false;
  installUpdateAfterFlush = false;
  dialog.showErrorBox("Changes were not saved", message);
}

function createWindow(targetUrl?: string) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: applicationIconPath(),
    webPreferences: {
      preload: path.join(currentDirectory, "preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1a1a" : "#e8e8e8",
  });

  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(true);
    window.setWindowButtonPosition({ x: 14, y: 10 });
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      import("electron").then(({ shell }) => {
        shell.openExternal(url);
      });
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const loadWindowContent = () => {
    if (devServerUrl) {
      return window.loadURL(targetUrl ?? devServerUrl);
    }
    if (targetUrl?.startsWith("file:")) return window.loadFile(fileURLToPath(targetUrl));
    return window.loadFile(path.join(currentDirectory, "../dist/index.html"));
  };
  void loadWindowContent();

  let lastRendererRecovery = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    if (
      details.reason === "clean-exit" ||
      window.isDestroyed() ||
      Date.now() - lastRendererRecovery < 5_000
    ) {
      return;
    }
    lastRendererRecovery = Date.now();
    setTimeout(() => {
      if (!window.isDestroyed()) void loadWindowContent();
    }, 250).unref();
  });

  if (!mainWindow) mainWindow = window;
  const windowId = window.webContents.id;
  window.on("close", (event) => {
    if (allowQuit || closeReadyWindows.delete(windowId)) return;
    if (window.webContents.isDestroyed()) return;
    event.preventDefault();
    requestWindowFlush(window, windowId);
  });
  window.on("closed", () => {
    closePendingWindows.delete(windowId);
    closeReadyWindows.delete(windowId);
    if (mainWindow === window) mainWindow = null;
    resumeQuitIfReady();
  });

  return window;
}

function showMainWindow(command?: string) {
  if (process.platform === "darwin") app.dock?.show();
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  const sendCommand = () => command && window.webContents.send("flux-command", command);
  if (window.webContents.isLoadingMainFrame())
    window.webContents.once("did-finish-load", sendCommand);
  else sendCommand();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function dispatchCommand(command: string) {
  showMainWindow(command);
}

function setMenuBarIconEnabled(enabled: boolean) {
  if (process.platform !== "darwin") return;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
  if (!enabled) {
    menuBarTray?.destroy();
    menuBarTray = null;
    return;
  }
  if (menuBarTray) return;
  const icon = nativeImage.createFromPath(menuBarIconPath());
  icon.setTemplateImage(true);
  menuBarTray = new Tray(icon);
  menuBarTray.setToolTip("Symtab quick actions");
  menuBarTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Today’s Note", click: () => dispatchCommand("daily-today") },
      { label: "Search Notes…", click: () => dispatchCommand("search") },
      { type: "separator" },
      { label: "Open Symtab", click: () => showMainWindow() },
      { label: "Settings…", click: () => dispatchCommand("settings") },
      { type: "separator" },
      { role: "quit" },
    ])
  );
}

async function menuBarIconEnabled() {
  try {
    const response = await fetch(`${backendOrigin}/api/v1/app-settings`, {
      headers: backendHeaders(),
    });
    if (!response.ok) return true;
    const settings = (await response.json()) as Record<string, unknown>;
    const fluxSettings = settings.fluxSettings as Record<string, unknown> | undefined;
    const general = fluxSettings?.general as Record<string, unknown> | undefined;
    return general?.showMenuBarIcon !== false;
  } catch {
    return true;
  }
}

function installApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" as const },
                { label: "Check for Updates…", click: () => dispatchCommand("updates") },
                { type: "separator" as const },
                {
                  label: "Settings…",
                  accelerator: "CmdOrCtrl+,",
                  click: () => dispatchCommand("settings"),
                },
                { type: "separator" as const },
                { role: "services" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [
          { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
          {
            label: "Open or Create Vault…",
            accelerator: "CmdOrCtrl+O",
            click: () => dispatchCommand("vaults"),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "Navigate",
        submenu: [
          {
            label: "Search",
            accelerator: "CmdOrCtrl+Shift+F",
            click: () => dispatchCommand("search"),
          },
          { label: "Today's Note", click: () => dispatchCommand("daily-today") },
        ],
      },
      {
        label: "Workspace",
        submenu: [
          { label: "Calendar", click: () => dispatchCommand("calendar") },
          {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () => dispatchCommand("settings"),
          },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ])
  );
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.setIcon(nativeImage.createFromPath(dockIconPath()));
  }
  const openedAtLogin =
    process.platform === "darwin" && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin;
  backendStartup = ensureBackend();
  if (openedAtLogin) app.dock?.hide();
  else createWindow();
  await backendStartup;
  installApplicationMenu();
  setMenuBarIconEnabled(await menuBarIconEnabled());
  backendHeartbeat = setInterval(() => void backendReady(), 30_000);
  backendHeartbeat.unref();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  quitAfterFlush = true;
  for (const window of BrowserWindow.getAllWindows()) {
    requestWindowFlush(window, window.webContents.id);
  }
  resumeQuitIfReady();
});

app.on("will-quit", () => {
  // Detached backend may outlive Electron until its idle timeout.
  if (backendHeartbeat) clearInterval(backendHeartbeat);
  backendHeartbeat = null;
  backendProcess = null;
});

ipcMain.handle("ping", async () => {
  return "pong";
});

ipcMain.handle("get-window-id", (event) => {
  return mainWindow?.webContents.id === event.sender.id ? "main" : `window-${event.sender.id}`;
});

ipcMain.on("flux-close-ready", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed() || !closePendingWindows.has(event.sender.id)) return;
  finishWindowFlush(window, event.sender.id);
});

ipcMain.on("flux-close-failed", (event, message: unknown) => {
  if (!closePendingWindows.has(event.sender.id)) return;
  cancelWindowFlush(
    event.sender.id,
    typeof message === "string" ? message : "Could not save changes"
  );
});

ipcMain.handle("select-vault-directory", async (_event, mode: unknown) => {
  if (mode !== "open" && mode !== "create" && mode !== "location")
    throw new TypeError("Invalid vault selection mode");
  const options = {
    title:
      mode === "location"
        ? "Choose workspace location"
        : mode === "create"
          ? "Create or choose an empty vault folder"
          : "Open vault folder",
    buttonLabel: mode === "location" ? "Choose location" : "Open",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
  };
  const result = await (mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options));
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("flux-fetch", async (_event, request: unknown) => {
  await backendStartup;
  if (!request || typeof request !== "object") throw new TypeError("Invalid Symtab request");
  const value = request as { url?: unknown; method?: unknown; body?: unknown };
  if (typeof value.url !== "string" || !value.url.startsWith("/api/v1/")) {
    throw new TypeError("Invalid Symtab API URL");
  }
  const method = typeof value.method === "string" ? value.method : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new TypeError("Invalid Symtab API method");
  }
  const response = await fetch(new URL(value.url, backendOrigin), {
    method,
    headers: { "Content-Type": "application/json", ...backendHeaders() },
    body: typeof value.body === "string" ? value.body : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "application/json";
  const bytes = Buffer.from(await response.arrayBuffer());
  const binary = !contentType.startsWith("application/json") && !contentType.startsWith("text/");
  return {
    status: response.status,
    body: binary ? "" : bytes.toString("utf8"),
    bodyBase64: binary ? bytes.toString("base64") : undefined,
    contentType,
  };
});

ipcMain.on("watch-vault-revision", (event, request: unknown) => {
  if (!request || typeof request !== "object") return;
  const value = request as { watcherId?: unknown; vaultId?: unknown };
  if (
    typeof value.watcherId !== "string" ||
    value.watcherId.length > 100 ||
    typeof value.vaultId !== "string" ||
    value.vaultId.length > 100
  ) {
    return;
  }
  const key = streamKey(event.sender, value.watcherId);
  eventStreams.get(key)?.abort();
  const controller = new AbortController();
  eventStreams.set(key, controller);
  event.sender.once("destroyed", () => controller.abort());
  void consumeVaultEvents(event.sender, value.watcherId, value.vaultId, controller.signal).finally(
    () => {
      if (eventStreams.get(key) === controller) eventStreams.delete(key);
    }
  );
});

ipcMain.on("unwatch-vault-revision", (event, watcherId: unknown) => {
  if (typeof watcherId !== "string") return;
  const key = streamKey(event.sender, watcherId);
  eventStreams.get(key)?.abort();
  eventStreams.delete(key);
});

ipcMain.handle("export-pdf", async (event, options: unknown) => {
  if (!options || typeof options !== "object") throw new TypeError("Invalid PDF options");
  const value = options as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    (value.pageSize !== "A4" && value.pageSize !== "Letter") ||
    typeof value.landscape !== "boolean" ||
    typeof value.marginMillimetres !== "number" ||
    typeof value.scale !== "number" ||
    value.marginMillimetres < 0 ||
    value.marginMillimetres > 50 ||
    value.scale < 0.5 ||
    value.scale > 2
  ) {
    throw new TypeError("Invalid PDF options");
  }
  const owner = BrowserWindow.fromWebContents(event.sender);
  const safeTitle = value.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
  const result = await (owner
    ? dialog.showSaveDialog(owner, {
        title: "Export PDF",
        defaultPath: `${safeTitle}.pdf`,
        buttonLabel: "Export",
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      })
    : dialog.showSaveDialog({
        title: "Export PDF",
        defaultPath: `${safeTitle}.pdf`,
        buttonLabel: "Export",
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      }));
  if (result.canceled || !result.filePath) return null;
  const data = await event.sender.printToPDF({
    scale: value.scale,
    printBackground: true,
    preferCSSPageSize: true,
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  });
  await writeFile(result.filePath, data);
  return result.filePath;
});

ipcMain.handle("check-for-updates", async () => {
  if (updateDownload && latestUpdateInfo) return updateDetails(latestUpdateInfo);
  const currentVersion = app.getVersion();
  try {
    if (process.platform === "darwin") {
      sendUpdateStatus({ state: "checking" });
      const release = await fetchMacRelease(process.arch);
      latestUpdateInfo =
        release && isNewerVersion(release.version, currentVersion) ? release : null;
      const update = release
        ? updateDetails(release)
        : { currentVersion, latestVersion: currentVersion, codename: undefined, releaseNotes: "" };
      sendUpdateStatus({ state: latestUpdateInfo ? "available" : "not-available", update });
      return update;
    }
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo ? updateDetails(result.updateInfo) : { currentVersion };
  } catch (error) {
    console.error("Failed to check for updates (maybe no GitHub releases yet):", error);
    sendUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Update check failed",
    });
    throw error;
  }
});

async function downloadUpdate() {
  if (!latestUpdateInfo) throw new Error("Check for updates before downloading");
  const update = updateDetails(latestUpdateInfo);
  sendUpdateStatus({
    state: "downloading",
    percent: 0,
    transferred: 0,
    total: "asset" in latestUpdateInfo ? latestUpdateInfo.asset.size : 0,
  });
  try {
    if (process.platform === "darwin") {
      if (!("asset" in latestUpdateInfo)) throw new Error("Check for a DMG update first");
      downloadedMacInstaller = await downloadMacUpdate(
        latestUpdateInfo,
        (percent, transferred, total) =>
          sendUpdateStatus({ state: "downloading", percent, transferred, total })
      );
    } else {
      await autoUpdater.downloadUpdate();
    }
    sendUpdateStatus({ state: "verifying", update });
    sendUpdateStatus({ state: "ready", update });
  } catch (error) {
    sendUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Update download failed",
    });
    throw error;
  }
}

ipcMain.handle("download-update", () => {
  updateDownload ??= downloadUpdate().finally(() => {
    updateDownload = null;
  });
  return updateDownload;
});

ipcMain.handle("install-update", () => {
  installUpdateAfterFlush = true;
  quitAfterFlush = true;
  for (const window of BrowserWindow.getAllWindows()) {
    requestWindowFlush(window, window.webContents.id);
  }
  resumeQuitIfReady();
});

ipcMain.handle("get-app-version", async () => {
  return app.getVersion();
});

ipcMain.handle("get-performance-stats", () => {
  const metrics = app.getAppMetrics();

  return metrics.reduce(
    (stats, processMetric) => ({
      cpuPercent: stats.cpuPercent + processMetric.cpu.percentCPUUsage,
      memoryMB: stats.memoryMB + processMetric.memory.workingSetSize / 1024,
    }),
    { cpuPercent: 0, memoryMB: 0 }
  );
});

ipcMain.handle("set-native-theme", (_event, theme: unknown) => {
  if (theme !== "dark" && theme !== "light" && theme !== "system") {
    throw new TypeError("Invalid native theme");
  }

  nativeTheme.themeSource = theme;
});

ipcMain.handle("set-menu-bar-icon-enabled", (_event, enabled: unknown) => {
  if (typeof enabled !== "boolean") throw new TypeError("Invalid menu bar icon setting");
  setMenuBarIconEnabled(enabled);
});

ipcMain.handle("open-window", (_event, target: unknown) => {
  if (typeof target !== "string") throw new TypeError("Invalid window URL");
  const url = new URL(target);
  if (isDev) {
    if (!devServerUrl || url.origin !== new URL(devServerUrl).origin) {
      throw new Error("Window URL must use the dev server origin");
    }
  } else if (url.protocol !== "file:") {
    throw new Error("Window URL must use the app bundle");
  }
  createWindow(target);
});
