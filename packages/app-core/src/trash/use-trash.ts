import { useState } from "react";
import type { SymtabClient, TrashEntry } from "@symtab/bridge-contract";
import { runWithToast } from "../app/toast-feedback";

export function useTrash({
  client,
  vaultId,
  refreshFiles,
  onStatus,
}: {
  client: SymtabClient | null;
  vaultId?: string;
  refreshFiles: () => Promise<unknown>;
  onStatus: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [query, setQuery] = useState("");
  const [deleteRequest, setDeleteRequest] = useState<TrashEntry>();
  const [emptyRequest, setEmptyRequest] = useState(false);

  const refresh = async () => {
    if (!client || !vaultId) return [];
    const next = await client.listTrash(vaultId);
    setEntries(next);
    return next;
  };

  const show = async () => {
    setOpen(true);
    try {
      await refresh();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not load trash");
    }
  };

  const restore = async (entry: TrashEntry) => {
    if (!client || !vaultId) return;
    try {
      await runWithToast(
        (async () => {
          await client.restoreFile(vaultId, entry.id);
          await Promise.all([refreshFiles(), refresh()]);
          onStatus(`Restored · ${entry.originalPath}`);
        })(),
        {
          loading: `Restoring ${entry.originalPath}…`,
          success: `Restored ${entry.originalPath}`,
          error: `Could not restore ${entry.originalPath}`,
        }
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Restore failed");
    }
  };

  const permanentlyDelete = async (entry: TrashEntry) => {
    if (!client || !vaultId) return;
    try {
      await runWithToast(
        (async () => {
          await client.permanentlyDelete(vaultId, entry.id);
          await refresh();
          setDeleteRequest(undefined);
          onStatus(`Permanently deleted · ${entry.originalPath}`);
        })(),
        {
          loading: `Permanently deleting ${entry.originalPath}…`,
          success: `Permanently deleted ${entry.originalPath}`,
          error: `Could not permanently delete ${entry.originalPath}`,
        }
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Permanent deletion failed");
    }
  };

  const empty = async () => {
    if (!client || !vaultId || !entries.length) return;
    try {
      await runWithToast(
        Promise.all(entries.map((entry) => client.permanentlyDelete(vaultId, entry.id))),
        {
          loading: `Deleting ${entries.length} trash items…`,
          success: "Trash emptied",
          error: "Could not empty trash",
        }
      );
      setEntries([]);
      setEmptyRequest(false);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not empty trash");
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) => entry.originalPath.toLocaleLowerCase().includes(normalizedQuery))
    : entries;

  return {
    open,
    setOpen,
    entries,
    filteredEntries,
    query,
    setQuery,
    deleteRequest,
    setDeleteRequest,
    emptyRequest,
    setEmptyRequest,
    refresh,
    show,
    restore,
    permanentlyDelete,
    empty,
  };
}
