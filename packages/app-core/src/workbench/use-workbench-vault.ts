import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileDocument,
  FileEntry,
  RecentVault,
  VaultInfo,
  VaultLocation,
} from "@symtab/bridge-contract";
import type { EditorTab } from "@symtab/shared-ui/components/design-system/workbench/editor/editor-area";

import type { SymtabRuntime } from "../App";
import { decodedText, singleTextEdit } from "../app/helpers";
import type { SymtabStatePersistence } from "../app/state";

export function useWorkbenchVault({
  runtime,
  persistence,
  windowId,
  restore = true,
}: {
  runtime: SymtabRuntime;
  persistence: SymtabStatePersistence;
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
    return runtime.client.watchVaultChanges(vault.id, () => {
      void refreshFiles(vault.id);
    });
  }, [refreshFiles, runtime.client, vault]);

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
      let document = documentsRef.current[path];
      if (!document) {
        if (entry?.kind === "binary") {
          const data = await runtime.client.readBinaryFile(vault.id, path);
          const content = decodedText(data);
          if (content === null) {
            return {
              id: `file:${path}`,
              title: entry.name,
              content: "Binary preview is not available.",
              readOnly: true,
            };
          }
          document = { path, content, contentHash: "", modifiedAt: entry.modifiedAt };
        } else {
          document = await runtime.client.readFile(vault.id, path);
        }
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
          void save().catch((error) =>
            setStatus(error instanceof Error ? error.message : `Could not save ${path}`)
          );
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
      const path = resourcePath(parent, name);
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
      return destinationPath;
    },
    [flushSaves, refreshFiles, runtime.client, vault]
  );

  const renameFile = useCallback(
    async (path: string, name: string) => {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      await moveFile(path, resourcePath(parent, name));
    },
    [moveFile]
  );

  const archiveFile = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault || path === "archive" || path.startsWith("archive/")) return;
      const destinationPath = `archive/${path}`;
      const parent = destinationPath.slice(0, destinationPath.lastIndexOf("/"));
      await runtime.client.createDirectory(vault.id, parent);
      return moveFile(path, destinationPath);
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
    setStatus,
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

function resolveMovedPath(movedPaths: ReadonlyMap<string, string>, path: string) {
  let resolved = path;
  for (let index = 0; index < movedPaths.size; index += 1) {
    const next = movedPaths.get(resolved);
    if (!next) break;
    resolved = next;
  }
  return resolved;
}
