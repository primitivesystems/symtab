import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileDocument,
  FileEntry,
  RecentVault,
  VaultInfo,
  VaultLocation,
} from "@flux/bridge-contract";
import type { EditorTab } from "@flux/shared-ui/components/design-system/workbench/editor/editor-area";

import type { FluxRuntime } from "../App";
import { singleTextEdit } from "../app/helpers";
import type { FluxStatePersistence } from "../app/state";
import { toast } from "@flux/shared-ui/components/sonner";

export function useWorkbenchVault({
  runtime,
  persistence,
  windowId,
  restore = true,
}: {
  runtime: FluxRuntime;
  persistence: FluxStatePersistence;
  windowId?: string;
  restore?: boolean;
}) {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [recent, setRecent] = useState<RecentVault[]>([]);
  const [available, setAvailable] = useState<VaultLocation[]>([]);
  const [documents, setDocuments] = useState<Record<string, FileDocument>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [status, setStatus] = useState("No vault open");
  const indexingToast = useRef<string | null>(null);
  const documentsRef = useRef(documents);
  const savedDocumentsRef = useRef(new Map<string, FileDocument>());
  const movedPathsRef = useRef(new Map<string, string>());
  const saveTimers = useRef(new Map<string, number>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  const pendingSaves = useRef(new Map<string, () => Promise<void>>());

  const flushSaves = useCallback(async () => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
    const pending = [...pendingSaves.current.values()];
    pendingSaves.current.clear();
    await Promise.all(pending.map((save) => save()));
    await Promise.all(saveChains.current.values());
  }, []);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const refreshFiles = useCallback(
    async (vaultId = vault?.id) => {
      if (!runtime.client || !vaultId) return;
      setFiles(await runtime.client.listFiles(vaultId));
    },
    [runtime.client, vault?.id]
  );

  const loadVault = useCallback(
    async (info: VaultInfo) => {
      if (!runtime.client) return;
      await flushSaves();
      setVault(info);
      setDocuments({});
      documentsRef.current = {};
      saveChains.current.clear();
      savedDocumentsRef.current.clear();
      movedPathsRef.current.clear();
      setFiles(await runtime.client.listFiles(info.id));
      setStatus(info.name);
      setManagerOpen(false);
    },
    [flushSaves, runtime.client]
  );

  useEffect(() => {
    if (!runtime.client || !windowId) return;
    let cancelled = false;
    void Promise.all([
      runtime.client.getBootstrap(windowId),
      runtime.client.listRecentVaults(),
      runtime.client.listAvailableVaults(),
    ])
      .then(async ([bootstrap, nextRecent, nextAvailable]) => {
        if (cancelled) return;
        setRecent(nextRecent);
        setAvailable(nextAvailable);
        const vaultId = bootstrap.workspace?.vaultId ?? nextRecent[0]?.vaultId;
        const location =
          nextAvailable.find((item) => item.vaultId === vaultId) ??
          nextRecent.find((item) => item.vaultId === vaultId);
        if (location && restore)
          await loadVault(await runtime.client!.openVault({ path: location.path }));
        else setManagerOpen(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load vaults");
          setManagerOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadVault, runtime.client, windowId, restore]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let cancelled = false;
    let receivedChange = false;
    const stop = runtime.client.watchVaultChanges(vault.id, (change) => {
      receivedChange = true;
      setVault(change.vault);
      // TODO(v1): Reconcile already-open documents when the underlying file changes externally.
      // Today we refresh the explorer and index state, but open tabs can still hold stale content.
      if (change.reconcile || change.events?.length) void refreshFiles(vault.id);
    });
    // Indexing can finish between opening the vault and subscribing.
    void runtime.client
      .getVaultInfo(vault.id)
      .then((info) => {
        if (!cancelled && !receivedChange) setVault(info);
      })
      .catch((error) => {
        if (!cancelled)
          toast.error("Could not read indexing status", { description: String(error) });
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [refreshFiles, runtime.client, vault?.id]);

  useEffect(() => {
    if (!vault) return;
    const id = `vault-indexing:${vault.id}`;
    if (indexingToast.current && indexingToast.current !== id) toast.dismiss(indexingToast.current);
    if (["initializing", "read_only_ready", "writable", "indexing"].includes(vault.state)) {
      indexingToast.current = id;
      const progress = vault.indexing;
      toast.loading(`Indexing ${vault.name}`, {
        id,
        duration: Infinity,
        description: progress?.total
          ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} files · ${progress.failed} failed`
          : "Scanning files…",
      });
    } else if (indexingToast.current === id) {
      indexingToast.current = null;
      if (vault.state === "active")
        toast.success(`${vault.name} indexed`, {
          id,
          description: "Search, backlinks, and graph are ready.",
          duration: 4_000,
        });
      else
        toast.error(`Indexing ${vault.name} needs attention`, {
          id,
          description: "Indexing did not complete. Try rebuilding the index.",
          duration: 8_000,
        });
    }
  }, [vault]);

  useEffect(
    () => () => {
      if (indexingToast.current) toast.dismiss(indexingToast.current);
    },
    []
  );

  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    },
    []
  );

  const openFile = useCallback(
    async (path: string): Promise<EditorTab | undefined> => {
      if (!runtime.client || !vault) return;
      const entry = files.find((item) => item.path === path);
      if (entry?.kind === "directory") return;
      if (entry && entry.kind !== "markdown") {
        toast.error("Flux v1 opens Markdown notes only", {
          description: "Attachments and other file types stay on disk but are hidden from the v1 workbench.",
        });
        return;
      }
      if (!entry && !path.toLowerCase().endsWith(".md")) return;
      let document = documentsRef.current[path];
      if (!document) {
        document = await runtime.client.readFile(vault.id, path);
        documentsRef.current = { ...documentsRef.current, [path]: document };
        savedDocumentsRef.current.set(path, document);
        setDocuments(documentsRef.current);
      }
      return {
        id: `file:${path}`,
        title: path.split("/").pop() ?? path,
        content: document.content,
      };
    },
    [files, runtime.client, vault]
  );

  const changeDocument = useCallback(
    (path: string, content: string, onSaved: () => void) => {
      if (!runtime.client || !vault) return;
      path = resolveMovedPath(movedPathsRef.current, path);
      const current = documentsRef.current[path];
      if (!current || current.content === content) return;
      const next = { ...current, content };
      documentsRef.current = { ...documentsRef.current, [path]: next };
      setDocuments(documentsRef.current);
      const previousTimer = saveTimers.current.get(path);
      if (previousTimer) window.clearTimeout(previousTimer);
      const save = () => {
        saveTimers.current.delete(path);
        pendingSaves.current.delete(path);
        const targetPath = resolveMovedPath(movedPathsRef.current, path);
        const previous = saveChains.current.get(targetPath) ?? Promise.resolve();
        const nextSave = previous
          .catch(() => undefined)
          .then(async () => {
            const latest = documentsRef.current[targetPath];
            const base = savedDocumentsRef.current.get(targetPath);
            if (!latest || !base || base.content === latest.content) return;
            const targetContent = latest.content;
            const saved = base.contentHash
              ? await runtime.client!.patchFile({
                  vaultId: vault.id,
                  path: targetPath,
                  expectedHash: base.contentHash,
                  edits: [singleTextEdit(base.content, targetContent)],
                })
              : await runtime.client!.saveFile({
                  vaultId: vault.id,
                  path: targetPath,
                  content: targetContent,
                  expectedHash: base.contentHash || undefined,
                });
            savedDocumentsRef.current.set(targetPath, {
              ...latest,
              ...saved,
              content: targetContent,
            });
            const visible = documentsRef.current[targetPath];
            if (visible) {
              documentsRef.current = {
                ...documentsRef.current,
                [targetPath]: {
                  ...visible,
                  contentHash: saved.contentHash,
                  modifiedAt: saved.modifiedAt,
                },
              };
              setDocuments(documentsRef.current);
            }
            setStatus(`Saved ${targetPath}`);
            if (visible?.content === targetContent) onSaved();
          });
        saveChains.current.set(targetPath, nextSave);
        return nextSave;
      };
      pendingSaves.current.set(path, save);
      saveTimers.current.set(
        path,
        window.setTimeout(() => {
          void save().catch((error) => {
            const message = error instanceof Error ? error.message : `Could not save ${path}`;
            setStatus(message);
            toast.error(`Could not save ${path}`, { description: message });
          });
        }, 500)
      );
    },
    [runtime.client, vault]
  );

  const connectVault = useCallback(
    async (path: string, mode: "open" | "create") => {
      if (!runtime.client) throw new Error("Not connected. Please try again.");
      const info =
        mode === "create"
          ? await runtime.client.createVault({ path })
          : await runtime.client.openVault({ path });
      await persistence.rememberVault({ id: info.id, name: info.name, path });
      await loadVault(info);
      const [nextRecent, nextAvailable] = await Promise.all([
        runtime.client.listRecentVaults(),
        runtime.client.listAvailableVaults(),
      ]);
      setRecent(nextRecent);
      setAvailable(nextAvailable);
      return info;
    },
    [loadVault, persistence, runtime]
  );

  const chooseVault = useCallback(
    async (mode: "open" | "create") => {
      if (!runtime.selectVaultDirectory) return;
      const path = await runtime.selectVaultDirectory(mode);
      if (path) return connectVault(path, mode);
    },
    [connectVault, runtime]
  );

  const openVault = useCallback(
    async (location: { path: string }) => {
      return connectVault(location.path, "open");
    },
    [connectVault]
  );

  const createFile = useCallback(
    async (parent: string | undefined, name: string) => {
      if (!runtime.client || !vault) return;
      const path = markdownFilePath(parent, name);
      await runtime.client.createFile({ vaultId: vault.id, path, content: "" });
      await refreshFiles();
      return openFile(path);
    },
    [openFile, refreshFiles, runtime.client, vault]
  );

  const createFolder = useCallback(
    async (parent: string | undefined, name: string) => {
      if (!runtime.client || !vault) return;
      await runtime.client.createDirectory(vault.id, resourcePath(parent, name));
      await refreshFiles();
    },
    [refreshFiles, runtime.client, vault]
  );

  const moveFile = useCallback(
    async (path: string, destinationPath: string) => {
      if (!runtime.client || !vault) return;
      if (destinationPath === path) return;
      await flushSaves();
      await runtime.client.moveFile({ vaultId: vault.id, sourcePath: path, destinationPath });
      const nextDocuments = { ...documentsRef.current };
      for (const [documentPath, document] of Object.entries(nextDocuments)) {
        if (documentPath !== path && !documentPath.startsWith(`${path}/`)) continue;
        const nextPath = `${destinationPath}${documentPath.slice(path.length)}`;
        const nextDocument = { ...document, path: nextPath };
        delete nextDocuments[documentPath];
        nextDocuments[nextPath] = nextDocument;
        movedPathsRef.current.set(documentPath, nextPath);
        const saved = savedDocumentsRef.current.get(documentPath);
        savedDocumentsRef.current.delete(documentPath);
        if (saved) savedDocumentsRef.current.set(nextPath, { ...saved, path: nextPath });
        saveChains.current.delete(documentPath);
      }
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      await refreshFiles();
    },
    [flushSaves, refreshFiles, runtime.client, vault]
  );

  const renameFile = useCallback(
    async (path: string, name: string) => {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const entry = files.find((item) => item.path === path);
      const destination = entry?.kind === "directory" ? resourcePath(parent, name) : markdownFilePath(parent, name);
      await moveFile(path, destination);
    },
    [files, moveFile]
  );

  const archiveFile = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault || path === "archive" || path.startsWith("archive/")) return;
      const destinationPath = `archive/${path}`;
      const parent = destinationPath.slice(0, destinationPath.lastIndexOf("/"));
      await runtime.client.createDirectory(vault.id, parent);
      await moveFile(path, destinationPath);
    },
    [moveFile, runtime.client, vault]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault) return;
      await flushSaves();
      await runtime.client.deleteFile(vault.id, path);
      const next = { ...documentsRef.current };
      for (const documentPath of Object.keys(next)) {
        if (documentPath !== path && !documentPath.startsWith(`${path}/`)) continue;
        window.clearTimeout(saveTimers.current.get(documentPath));
        saveTimers.current.delete(documentPath);
        pendingSaves.current.delete(documentPath);
        saveChains.current.delete(documentPath);
        savedDocumentsRef.current.delete(documentPath);
        delete next[documentPath];
      }
      documentsRef.current = next;
      setDocuments(next);
      await refreshFiles();
    },
    [flushSaves, refreshFiles, runtime.client, vault]
  );

  const restoreArchive = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault || !path.startsWith("archive/")) return;
      const destination = path.slice("archive/".length);
      const parent = destination.slice(0, destination.lastIndexOf("/"));
      if (destination.includes("/")) await runtime.client.createDirectory(vault.id, parent);
      await moveFile(path, destination);
    },
    [moveFile, runtime.client, vault]
  );

  const listTrash = useCallback(async () => {
    if (!runtime.client || !vault) return [];
    return runtime.client.listTrash(vault.id);
  }, [runtime.client, vault?.id]);

  const restoreTrash = useCallback(
    async (id: string) => {
      if (!runtime.client || !vault) return;
      await runtime.client.restoreFile(vault.id, id);
      await refreshFiles();
    },
    [refreshFiles, runtime.client, vault?.id]
  );

  const forgetVault = useCallback(
    async (vaultId: string) => {
      if (!runtime.client) return;
      await runtime.client.forgetVault(vaultId);
      setRecent(await runtime.client.listRecentVaults());
    },
    [runtime.client]
  );

  const backlinkCount = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault) return 0;
      const references = await runtime.client.getDocumentReferences(
        vault.id,
        resolveMovedPath(movedPathsRef.current, path)
      );
      return references.linked.length;
    },
    [runtime.client, vault]
  );

  return {
    vault,
    files,
    recent,
    available,
    documents,
    managerOpen,
    setManagerOpen,
    status,
    refreshFiles,
    openFile,
    changeDocument,
    chooseVault,
    connectVault,
    openVault,
    createFile,
    createFolder,
    renameFile,
    archiveFile,
    restoreArchive,
    listTrash,
    restoreTrash,
    deleteFile,
    forgetVault,
    backlinkCount,
    flushSaves,
  };
}

export function resourcePath(parent: string | undefined, requestedName: string) {
  const name = requestedName.trim();
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw new Error("Use a name without slashes.");
  }
  return parent ? `${parent}/${name}` : name;
}

export function markdownFileName(requestedName: string) {
  const name = requestedName.trim();
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw new Error("Use a note name without slashes.");
  }
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  if (extension && extension !== ".md") {
    throw new Error("Flux v1 creates Markdown notes only. Use a .md name.");
  }
  return extension === ".md" ? name : `${name}.md`;
}

export function markdownFilePath(parent: string | undefined, requestedName: string) {
  return resourcePath(parent, markdownFileName(requestedName));
}

function resolveMovedPath(movedPaths: ReadonlyMap<string, string>, path: string) {
  let resolved = path;
  for (let index = 0; index < movedPaths.size; index += 1) {
    const next = movedPaths.get(resolved);
    if (!next) break;
    resolved = next;
  }
  return resolved;
}
