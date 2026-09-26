import type { SymtabClient } from "@symtab/bridge-contract";

export interface DailyNoteConfig {
  dailyFolder: string;
  weeklyFolder: string;
  inboxPath: string;
  dailyFormat: string;
  weeklyFormat: string;
  dailyTemplate?: string;
  weeklyTemplate?: string;
  timeZone: string;
}

export const defaultDailyNoteConfig: DailyNoteConfig = {
  dailyFolder: "Daily",
  weeklyFolder: "Daily/Weekly",
  inboxPath: "Inbox",
  dailyFormat: "YYYY-MM-DD",
  weeklyFormat: "GGGG-[W]WW",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function safeVaultPath(value: unknown, fallback: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    return fallback;
  }
  return value.replace(/\/+$/, "");
}

export async function loadDailyNoteConfig(client: SymtabClient, vaultId: string) {
  const value = await client.getVaultConfig(vaultId);
  const timeZone =
    typeof value.timeZone === "string" ? value.timeZone : defaultDailyNoteConfig.timeZone;
  new Intl.DateTimeFormat(undefined, { timeZone }).format();
  return {
    dailyFolder: safeVaultPath(value.dailyFolder, defaultDailyNoteConfig.dailyFolder),
    weeklyFolder: safeVaultPath(value.weeklyFolder, defaultDailyNoteConfig.weeklyFolder),
    inboxPath: safeVaultPath(value.inboxPath, defaultDailyNoteConfig.inboxPath),
    dailyFormat:
      typeof value.dailyFormat === "string" && value.dailyFormat
        ? value.dailyFormat
        : defaultDailyNoteConfig.dailyFormat,
    weeklyFormat:
      typeof value.weeklyFormat === "string" && value.weeklyFormat
        ? value.weeklyFormat
        : defaultDailyNoteConfig.weeklyFormat,
    dailyTemplate:
      typeof value.dailyTemplate === "string" ? safeVaultPath(value.dailyTemplate, "") : undefined,
    weeklyTemplate:
      typeof value.weeklyTemplate === "string"
        ? safeVaultPath(value.weeklyTemplate, "")
        : undefined,
    timeZone,
  } satisfies DailyNoteConfig;
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function isoWeekKey(date: Date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function calendarGrid(selected: string) {
  const date = dateFromKey(selected);
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function noteFileName(dateKey: string, format: string, weekly = false) {
  const date = dateFromKey(dateKey);
  const week = isoWeekKey(date);
  const [weekYear, weekNumber] = week.split("-W");
  const value = format
    .replaceAll("[W]", "W")
    .replaceAll("GGGG", weekYear)
    .replaceAll("WW", weekNumber)
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", String(date.getMonth() + 1).padStart(2, "0"))
    .replaceAll("DD", String(date.getDate()).padStart(2, "0"));
  const stem = value.replace(/\.md$/i, "");
  return `${stem || (weekly ? week : dateKey)}.md`;
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function noteTemplate(
  client: SymtabClient,
  vaultId: string,
  path: string | undefined,
  fallback: string,
  replacements: Record<string, string>
) {
  if (!path) return fallback;
  if (!(await client.getFileMetadata(vaultId, path))) {
    throw new Error(`Configured template not found: ${path}`);
  }
  let content = (await client.readFile(vaultId, path)).content;
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}
