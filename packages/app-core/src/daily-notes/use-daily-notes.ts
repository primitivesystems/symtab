import { useEffect, useMemo, useState } from "react";
import type { FileEntry, FluxClient, VaultInfo } from "@flux/bridge-contract";
import {
  calendarGrid,
  dateFromKey,
  dateKeyInTimeZone,
  defaultDailyNoteConfig,
  isoWeekKey,
  loadDailyNoteConfig,
  localDateKey,
  noteFileName,
  noteTemplate,
} from "./config";
import { errorMessage } from "../app/helpers";
import { getFrontmatterProperties, splitFrontmatter } from "../editor/frontmatter";

export interface CalendarEntry {
  path: string;
  title: string;
  date: string;
  kind: "journal" | "file";
  tags: string[];
}

export function useDailyNotes<T>({
  client,
  vault,
  files,
  refreshFiles,
  openDocument,
  onStatus,
}: {
  client: FluxClient | null;
  vault: VaultInfo | null;
  files: readonly FileEntry[];
  refreshFiles: () => Promise<unknown>;
  openDocument: (path: string) => Promise<T>;
  onStatus: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localDateKey);
  const [config, setConfig] = useState(defaultDailyNoteConfig);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const days = useMemo(() => calendarGrid(date), [date]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
        dateFromKey(date)
      ),
    [date]
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    let active = true;
    if (!vault || !client) return;
    void loadDailyNoteConfig(client, vault.id)
      .then((next) => {
        if (!active) return;
        setConfig(next);
        setDate(dateKeyInTimeZone(new Date(), next.timeZone));
      })
      .catch((error) => {
        if (active) onStatus(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [client, onStatus, vault]);

  useEffect(() => {
    if (!vault || !client) return;
    let active = true;
    const legacy = files.filter(
      (file) =>
        file.kind === "markdown" &&
        file.path.startsWith(`${config.dailyFolder}/`) &&
        /^\d{4}-\d{2}-\d{2}\.md$/i.test(file.name)
    );
    void client
      .searchVault(vault.id, "property:date", 500)
      .then(async (results) => {
        const paths = [
          ...new Set([...results.map(({ path }) => path), ...legacy.map(({ path }) => path)]),
        ];
        const documents = await Promise.all(paths.map((path) => client.readFile(vault.id, path)));
        if (!active) return;
        setEntries(
          documents.flatMap((document) =>
            calendarEntry(document.path, document.content, config.dailyFolder)
          )
        );
      })
      .catch((error) => active && onStatus(errorMessage(error)));
    return () => {
      active = false;
    };
  }, [client, config.dailyFolder, files, onStatus, vault]);

  const openDaily = async (selected: string) => {
    if (!vault || !client) return;
    const path = `${config.dailyFolder}/${noteFileName(selected, config.dailyFormat)}`;
    try {
      await client.createDirectory(vault.id, config.dailyFolder);
      if (!(await client.getFileMetadata(vault.id, path))) {
        try {
          const content = await noteTemplate(
            client,
            vault.id,
            config.dailyTemplate,
            `# ${selected}\n\n`,
            { date: selected }
          );
          await client.createFile({ vaultId: vault.id, path, content });
          await refreshFiles();
        } catch {
          // A simultaneous capture may have created today's note.
        }
      }
      setOpen(false);
      return await openDocument(path);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };

  const openToday = () => openDaily(dateKeyInTimeZone(new Date(), config.timeZone));

  const openWeekly = async (selected: string) => {
    if (!vault || !client) return;
    const week = isoWeekKey(dateFromKey(selected));
    const path = `${config.weeklyFolder}/${noteFileName(selected, config.weeklyFormat, true)}`;
    try {
      await client.createDirectory(vault.id, config.weeklyFolder);
      if (!(await client.getFileMetadata(vault.id, path))) {
        try {
          const content = await noteTemplate(
            client,
            vault.id,
            config.weeklyTemplate,
            `# ${week}\n\n`,
            { date: selected, week }
          );
          await client.createFile({ vaultId: vault.id, path, content });
          await refreshFiles();
        } catch {
          // Another window won create race.
        }
      }
      setOpen(false);
      return await openDocument(path);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };

  const createEntry = async (selected: string, title: string, tags: string[]) => {
    if (!vault || !client) return;
    const safeTitle = title.trim() || "Journal entry";
    const slug =
      safeTitle
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "entry";
    const folder = `${config.dailyFolder}/${selected}`;
    const path = `${folder}/${slug}-${crypto.randomUUID().slice(0, 8)}.md`;
    const cleanTags = [...new Set(tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
    const content = `---\ntype: journal\ndate: ${selected}\ntags: ${JSON.stringify(cleanTags)}\n---\n\n# ${safeTitle.replace(/[\r\n]+/g, " ")}\n\n`;
    try {
      await client.createDirectory(vault.id, folder);
      await client.createFile({ vaultId: vault.id, path, content });
      await refreshFiles();
      return await openDocument(path);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };

  return {
    open,
    setOpen,
    date,
    setDate,
    config,
    setConfig,
    days,
    monthLabel,
    entries: vault ? entries : [],
    openDaily,
    openToday,
    openWeekly,
    createEntry,
  };
}

export function calendarEntry(path: string, content: string, dailyFolder: string): CalendarEntry[] {
  const properties = new Map(
    getFrontmatterProperties(content).map(({ key, value }) => [key.toLowerCase(), value])
  );
  const legacyDate = path.startsWith(`${dailyFolder}/`)
    ? path
        .split("/")
        .pop()
        ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
    : undefined;
  const date = properties.get("date")?.replace(/^['"]|['"]$/g, "") ?? legacyDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const body = splitFrontmatter(content).body;
  const title =
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  const tags = (properties.get("tags") ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => tag.trim().replace(/^['"#]|['"]$/g, ""))
    .filter(Boolean);
  const type = properties
    .get("type")
    ?.replace(/^['"]|['"]$/g, "")
    .toLowerCase();
  return [
    {
      path,
      title,
      date,
      tags,
      kind: type === "journal" || path.startsWith(`${dailyFolder}/`) ? "journal" : "file",
    },
  ];
}
