import { expect, test } from "bun:test";
import { movedDocumentPath, singleTextEdit } from "../src/app/helpers";
import { calendarGrid, noteFileName } from "../src/daily-notes/config";
import { calendarEntry } from "../src/daily-notes/use-daily-notes";
import { markdownFileName, markdownFilePath, resourcePath } from "../src/workbench/use-workbench-vault";

test("extracted app helpers preserve path, UTF-8 edit, and calendar behavior", () => {
  expect(movedDocumentPath("Notes/Child/file.md", "Notes", "Archive")).toBe(
    "Archive/Child/file.md"
  );
  expect(singleTextEdit("a😀c", "a🙂c")).toEqual({
    startByte: 1,
    endByte: 5,
    text: "🙂",
  });
  expect(noteFileName("2026-08-23", "YYYY-MM-DD")).toBe("2026-08-23.md");
  expect(calendarGrid("2026-08-23")).toHaveLength(42);
  expect(resourcePath("Notes", "Plan.md")).toBe("Notes/Plan.md");
  expect(markdownFileName("Plan")).toBe("Plan.md");
  expect(markdownFilePath("Notes", "Plan")).toBe("Notes/Plan.md");
  expect(() => markdownFileName("Plan.txt")).toThrow("Markdown notes only");
  expect(() => resourcePath("Notes", "../Plan.md")).toThrow("without slashes");
  expect([
    ...calendarEntry(
      "Daily/2026-08-23/morning.md",
      "---\ntype: journal\ndate: 2026-08-23\ntags: [reflection]\n---\n# Morning",
      "Daily"
    ),
    ...calendarEntry(
      "Projects/launch.md",
      "---\ndate: 2026-08-23\ntags: [work]\n---\n# Launch",
      "Daily"
    ),
  ]).toEqual([
    {
      path: "Daily/2026-08-23/morning.md",
      title: "Morning",
      date: "2026-08-23",
      kind: "journal",
      tags: ["reflection"],
    },
    {
      path: "Projects/launch.md",
      title: "Launch",
      date: "2026-08-23",
      kind: "file",
      tags: ["work"],
    },
  ]);
});
