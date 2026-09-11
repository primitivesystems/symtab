import { expect, test } from "bun:test";

import {
  createEditorModel,
  editorReducer,
  getGroup,
  documentStatistics,
  persistedEditorModel,
  restoreEditorModel,
  type EditorLayoutNode,
} from "../src/components/design-system/workbench/editor/editor-model";

test("editor state restores tabs and splits without duplicating document content", () => {
  const tab = { id: "file:notes.md", title: "notes.md", content: "large body", dirty: true };
  const split = editorReducer(createEditorModel([tab]), {
    type: "split",
    groupId: "primary",
    placement: "right",
  });
  const persisted = persistedEditorModel(split);
  expect(persisted.documents[tab.id]?.content).toBeUndefined();
  expect(persisted.documents[tab.id]?.dirty).toBeUndefined();
  expect(restoreEditorModel(persisted, []).groups).toEqual(split.groups);
  expect(restoreEditorModel({ broken: true }, []).groups).toEqual(createEditorModel([]).groups);
});

test("only editable file tabs expose document statistics", () => {
  for (const id of ["workbench:journal", "workbench:graph"]) {
    expect(
      documentStatistics({ id, title: id }, { words: 30, characters: 200, backlinks: 2 })
    ).toEqual({});
  }
  expect(documentStatistics()).toEqual({});
  expect(documentStatistics({ id: "file:image.png", title: "image.png", readOnly: true })).toEqual(
    {}
  );
  expect(
    documentStatistics(
      { id: "file:note.md", title: "note.md", content: "one two" },
      { backlinks: 2 }
    )
  ).toEqual({ words: 2, characters: 7, backlinks: 2 });
});

test("split duplicates view state while documents stay shared", () => {
  const tab = { id: "notes.md", title: "notes.md", content: "one" };
  let model = createEditorModel([tab]);

  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  const splitGroupId = model.activeGroupId;
  expect(getGroup(model, "primary")?.tabIds).toEqual([tab.id]);
  expect(getGroup(model, splitGroupId)?.tabIds).toEqual([tab.id]);
  expect(model.documents[getGroup(model, "primary")!.tabIds[0]!]).toBe(
    model.documents[getGroup(model, splitGroupId)!.tabIds[0]!]
  );

  model = editorReducer(model, {
    type: "update-document",
    tabId: tab.id,
    changes: { content: "two" },
  });
  expect(model.documents[tab.id]?.content).toBe("two");
});

test("center drop moves a tab between groups and honors its insertion point", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  let model = createEditorModel([first, second]);
  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  const targetGroupId = model.activeGroupId;

  model = editorReducer(model, {
    type: "drop",
    tab: second,
    sourceGroupId: "primary",
    targetGroupId,
    placement: "center",
    targetIndex: 0,
  });

  expect(getGroup(model, "primary")?.tabIds).toEqual([first.id]);
  expect(getGroup(model, targetGroupId)?.tabIds).toEqual([second.id, first.id]);
  expect(getGroup(model, targetGroupId)?.activeTabId).toBe(second.id);
});

test("every edge drop inserts a new nested group relative to its target", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  const third = { id: "third.md", title: "third.md" };
  let model = createEditorModel([first, second, third]);

  model = editorReducer(model, {
    type: "drop",
    tab: second,
    sourceGroupId: "primary",
    targetGroupId: "primary",
    placement: "right",
  });
  const rightGroupId = model.activeGroupId;

  model = editorReducer(model, {
    type: "drop",
    tab: third,
    sourceGroupId: "primary",
    targetGroupId: rightGroupId,
    placement: "bottom",
  });
  const bottomGroupId = model.activeGroupId;

  expect(model.groups.map((group) => group.id)).toEqual(["primary", rightGroupId, bottomGroupId]);
  expect(layoutGroupIds(model.layout)).toEqual(["primary", rightGroupId, bottomGroupId]);
  expect(model.layout).toMatchObject({
    type: "split",
    orientation: "horizontal",
    second: { type: "split", orientation: "vertical" },
  });
});

test("moving the last source tab collapses its leaf and promotes its sibling", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  let model = createEditorModel([first, second]);
  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  const targetGroupId = model.activeGroupId;
  model = editorReducer(model, {
    type: "drop",
    tab: second,
    sourceGroupId: "primary",
    targetGroupId,
    placement: "center",
  });
  model = editorReducer(model, {
    type: "drop",
    tab: first,
    sourceGroupId: "primary",
    targetGroupId,
    placement: "center",
  });

  expect(model.groups).toHaveLength(1);
  expect(getGroup(model, "primary")).toBeUndefined();
  expect(getGroup(model, targetGroupId)?.tabIds).toEqual([first.id, second.id]);
  expect(model.layout).toEqual({ type: "group", groupId: targetGroupId });
  expect(model.activeGroupId).toBe(targetGroupId);
});

test("center drop reorders tabs within one group", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  const third = { id: "third.md", title: "third.md" };
  let model = createEditorModel([first, second, third]);

  model = editorReducer(model, {
    type: "drop",
    tab: third,
    sourceGroupId: "primary",
    targetGroupId: "primary",
    placement: "center",
    targetIndex: 1,
  });

  expect(getGroup(model, "primary")?.tabIds).toEqual([first.id, third.id, second.id]);
  expect(getGroup(model, "primary")?.activeTabId).toBe(third.id);
});

test("sole tab cannot be edge-moved back onto its own group", () => {
  const tab = { id: "notes.md", title: "notes.md" };
  const model = createEditorModel([tab]);

  const next = editorReducer(model, {
    type: "drop",
    tab,
    sourceGroupId: "primary",
    targetGroupId: "primary",
    placement: "right",
  });

  expect(next).toBe(model);
});

test("copy drop keeps source view while move drop removes it", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  let model = createEditorModel([first, second]);
  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  const targetGroupId = model.activeGroupId;

  model = editorReducer(model, {
    type: "drop",
    tab: second,
    sourceGroupId: "primary",
    targetGroupId,
    placement: "center",
    operation: "copy",
  });
  expect(getGroup(model, "primary")?.tabIds).toContain(second.id);
  expect(getGroup(model, targetGroupId)?.tabIds).toContain(second.id);

  model = editorReducer(model, {
    type: "drop",
    tab: second,
    sourceGroupId: "primary",
    targetGroupId,
    placement: "center",
    operation: "move",
  });
  expect(getGroup(model, "primary")?.tabIds).not.toContain(second.id);
  expect(getGroup(model, targetGroupId)?.tabIds).toContain(second.id);
});

test("dirty document guards last view but explicit force close succeeds", () => {
  const dirty = { id: "dirty.md", title: "dirty.md", dirty: true };
  let model = createEditorModel([dirty]);

  const guarded = editorReducer(model, {
    type: "close",
    groupId: "primary",
    tabId: dirty.id,
  });
  expect(guarded).toBe(model);

  model = editorReducer(model, {
    type: "close",
    groupId: "primary",
    tabId: dirty.id,
    force: true,
  });
  expect(getGroup(model, "primary")?.tabIds).toEqual([]);
});

test("close all removes clean tabs but keeps the last dirty view", () => {
  const clean = { id: "clean.md", title: "clean.md" };
  const dirty = { id: "dirty.md", title: "dirty.md", dirty: true };
  const model = editorReducer(createEditorModel([clean, dirty]), {
    type: "close-all",
    groupId: "primary",
  });

  expect(getGroup(model, "primary")?.tabIds).toEqual([dirty.id]);
});

test("editor commands close relative tabs and move pinned tabs first", () => {
  const first = { id: "first.md", title: "first.md" };
  const second = { id: "second.md", title: "second.md" };
  const third = { id: "third.md", title: "third.md" };
  let model = createEditorModel([first, second, third]);

  model = editorReducer(model, { type: "toggle-pin", groupId: "primary", tabId: second.id });
  expect(getGroup(model, "primary")?.tabIds).toEqual([second.id, first.id, third.id]);
  expect(model.documents[second.id]?.pinned).toBe(true);

  model = editorReducer(model, { type: "close-after", groupId: "primary", tabId: first.id });
  expect(getGroup(model, "primary")?.tabIds).toEqual([second.id, first.id]);

  model = editorReducer(model, { type: "close-others", groupId: "primary", tabId: first.id });
  expect(getGroup(model, "primary")?.tabIds).toEqual([first.id]);
});

test("dirty shared document can close in one group while another view remains", () => {
  const dirty = { id: "dirty.md", title: "dirty.md", dirty: true };
  let model = createEditorModel([dirty]);
  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  const otherGroupId = model.activeGroupId;

  model = editorReducer(model, {
    type: "close",
    groupId: "primary",
    tabId: dirty.id,
  });

  expect(getGroup(model, "primary")).toBeUndefined();
  expect(getGroup(model, otherGroupId)?.tabIds).toEqual([dirty.id]);
});

test("split sizes are normalized and stored in serializable layout state", () => {
  const tab = { id: "notes.md", title: "notes.md" };
  let model = createEditorModel([tab]);
  model = editorReducer(model, { type: "split", groupId: "primary", placement: "right" });
  expect(model.layout).toMatchObject({ type: "split", sizes: [0.5, 0.5] });

  model = editorReducer(model, {
    type: "resize-split",
    splitId: "split-1",
    sizes: [3, 1],
  });
  expect(model.layout).toMatchObject({ type: "split", sizes: [0.75, 0.25] });
  expect(JSON.parse(JSON.stringify(model.layout))).toEqual(model.layout);
});

test("file CRUD keeps open editor tabs synchronized", () => {
  let model = createEditorModel([
    { id: "file:Notes/Plan.md", title: "Plan.md" },
    { id: "file:Notes/Child/Idea.md", title: "Idea.md" },
  ]);

  model = editorReducer(model, {
    type: "rename-path",
    sourcePath: "Notes",
    destinationPath: "Archive",
  });
  expect(getGroup(model, "primary")?.tabIds).toEqual([
    "file:Archive/Plan.md",
    "file:Archive/Child/Idea.md",
  ]);

  model = editorReducer(model, { type: "close-path", path: "Archive" });
  expect(getGroup(model, "primary")?.tabIds ?? []).toEqual([]);
});

function layoutGroupIds(node: EditorLayoutNode): string[] {
  return node.type === "group"
    ? [node.groupId]
    : [...layoutGroupIds(node.first), ...layoutGroupIds(node.second)];
}
