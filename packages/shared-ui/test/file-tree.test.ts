import { describe, expect, test } from "bun:test";

import { fileTree } from "../src/components/design-system/workbench/sidebar/primary-sidebar";

describe("fileTree", () => {
  test("nests files under explicit and implicit folders without duplicates", () => {
    expect(fileTree([
      { path: "notes", name: "notes", kind: "directory" },
      { path: "notes/daily/today.md", name: "today.md", kind: "markdown" },
      { path: "README.md", name: "README.md", kind: "markdown" },
    ])).toEqual([
      {
        name: "notes",
        path: "notes",
        type: "folder",
        children: [{
          name: "daily",
          path: "notes/daily",
          type: "folder",
          children: [{ name: "today.md", path: "notes/daily/today.md", type: "file" }],
        }],
      },
      { name: "README.md", path: "README.md", type: "file" },
    ]);
  });

  test("hides the archive tree when requested", () => {
    const files = [
      { path: "archive", name: "archive", kind: "directory" as const },
      { path: "archive/old.md", name: "old.md", kind: "markdown" as const },
      { path: "notes/live.md", name: "live.md", kind: "markdown" as const },
    ];

    expect(fileTree(files, false)).toEqual([
      {
        name: "notes",
        path: "notes",
        type: "folder",
        children: [{ name: "live.md", path: "notes/live.md", type: "file" }],
      },
    ]);
    expect(fileTree(files, true)[0]?.path).toBe("archive");
  });
});
