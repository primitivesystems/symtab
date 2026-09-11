export type EditorTab = {
  id: string;
  title: string;
  pinned?: boolean;
  dirty?: boolean;
  content?: string;
  readOnly?: boolean;
  mode?: "read" | "live" | "source";
  showBacklinks?: boolean;
  bookmarked?: boolean;
};

export type EditorGroupId = string;

export function documentStatistics(
  tab?: EditorTab,
  overrides: { words?: number; characters?: number; backlinks?: number } = {}
) {
  if (!tab?.id.startsWith("file:") || tab.readOnly) return {};
  return {
    words: overrides.words ?? tab.content?.trim().split(/\s+/).filter(Boolean).length ?? 0,
    characters: overrides.characters ?? tab.content?.length ?? 0,
    backlinks: overrides.backlinks,
  };
}
export type SplitPlacement = "left" | "right" | "top" | "bottom";

export type EditorGroupState = {
  id: EditorGroupId;
  tabIds: string[];
  activeTabId?: string;
};

export type EditorLayoutNode =
  | { type: "group"; groupId: EditorGroupId }
  | {
      type: "split";
      id: string;
      orientation: "horizontal" | "vertical";
      sizes: [number, number];
      first: EditorLayoutNode;
      second: EditorLayoutNode;
    };

export type EditorModel = {
  documents: Record<string, EditorTab>;
  groups: EditorGroupState[];
  activeGroupId: EditorGroupId;
  layout: EditorLayoutNode;
  nextGroupNumber: number;
};

export type EditorAction =
  | { type: "activate-group"; groupId: EditorGroupId }
  | { type: "activate-tab"; groupId: EditorGroupId; tabId: string }
  | { type: "open"; tab: EditorTab; groupId?: EditorGroupId }
  | { type: "close"; groupId: EditorGroupId; tabId: string; force?: boolean }
  | { type: "close-all"; groupId: EditorGroupId; force?: boolean }
  | { type: "close-saved"; groupId: EditorGroupId }
  | { type: "close-others"; groupId: EditorGroupId; tabId: string }
  | { type: "close-after"; groupId: EditorGroupId; tabId: string }
  | { type: "toggle-pin"; groupId: EditorGroupId; tabId: string }
  | { type: "split"; groupId: EditorGroupId; placement: SplitPlacement }
  | { type: "resize-split"; splitId: string; sizes: [number, number] }
  | {
      type: "drop";
      tab: EditorTab;
      sourceGroupId?: EditorGroupId;
      targetGroupId: EditorGroupId;
      placement: SplitPlacement | "center";
      targetIndex?: number;
      operation?: "copy" | "move";
    }
  | { type: "update-document"; tabId: string; changes: Partial<Omit<EditorTab, "id">> }
  | { type: "rename-path"; sourcePath: string; destinationPath: string }
  | { type: "close-path"; path: string };

export function createEditorModel(initialTabs: readonly EditorTab[]): EditorModel {
  return {
    documents: Object.fromEntries(initialTabs.map((tab) => [tab.id, tab])),
    groups: [
      {
        id: "primary",
        tabIds: initialTabs.map((tab) => tab.id),
        activeTabId: initialTabs[0]?.id,
      },
    ],
    activeGroupId: "primary",
    layout: { type: "group", groupId: "primary" },
    nextGroupNumber: 1,
  };
}

export function persistedEditorModel(model: EditorModel): EditorModel {
  return {
    ...model,
    documents: Object.fromEntries(
      Object.entries(model.documents).map(([id, { content: _content, dirty: _dirty, ...tab }]) => [
        id,
        tab,
      ])
    ),
  };
}

export function restoreEditorModel(
  value: unknown,
  fallbackTabs: readonly EditorTab[]
): EditorModel {
  if (!value || typeof value !== "object") return createEditorModel(fallbackTabs);
  const candidate = value as Partial<EditorModel>;
  if (
    !candidate.documents ||
    typeof candidate.documents !== "object" ||
    !Array.isArray(candidate.groups)
  )
    return createEditorModel(fallbackTabs);
  const documents = Object.fromEntries(
    Object.entries(candidate.documents).filter(
      (entry): entry is [string, EditorTab] =>
        Boolean(entry[1]) &&
        typeof entry[1] === "object" &&
        typeof (entry[1] as EditorTab).id === "string" &&
        typeof (entry[1] as EditorTab).title === "string" &&
        (entry[1] as EditorTab).id === entry[0]
    )
  );
  const groups = candidate.groups.filter(
    (group): group is EditorGroupState =>
      Boolean(group) &&
      typeof group.id === "string" &&
      Array.isArray(group.tabIds) &&
      group.tabIds.every((id) => typeof id === "string" && Boolean(documents[id])) &&
      (group.activeTabId === undefined || group.tabIds.includes(group.activeTabId))
  );
  const groupIds = new Set(groups.map((group) => group.id));
  const layoutGroups = new Set<string>();
  const validLayout = (node: unknown): node is EditorLayoutNode => {
    if (!node || typeof node !== "object") return false;
    const layout = node as Partial<EditorLayoutNode>;
    if (layout.type === "group" && typeof layout.groupId === "string") {
      layoutGroups.add(layout.groupId);
      return groupIds.has(layout.groupId);
    }
    return (
      layout.type === "split" &&
      typeof layout.id === "string" &&
      (layout.orientation === "horizontal" || layout.orientation === "vertical") &&
      Array.isArray(layout.sizes) &&
      layout.sizes.length === 2 &&
      layout.sizes.every((size) => typeof size === "number" && Number.isFinite(size)) &&
      validLayout(layout.first) &&
      validLayout(layout.second)
    );
  };
  if (
    !groups.length ||
    new Set(groups.map((group) => group.id)).size !== groups.length ||
    typeof candidate.activeGroupId !== "string" ||
    !groupIds.has(candidate.activeGroupId) ||
    !validLayout(candidate.layout) ||
    layoutGroups.size !== groupIds.size ||
    typeof candidate.nextGroupNumber !== "number" ||
    !Number.isInteger(candidate.nextGroupNumber) ||
    candidate.nextGroupNumber < 1
  )
    return createEditorModel(fallbackTabs);
  return {
    documents,
    groups,
    activeGroupId: candidate.activeGroupId,
    layout: candidate.layout,
    nextGroupNumber: candidate.nextGroupNumber,
  };
}

export function editorReducer(model: EditorModel, action: EditorAction): EditorModel {
  if (action.type === "rename-path") {
    return renameDocumentPath(model, action.sourcePath, action.destinationPath);
  }

  if (action.type === "close-path") {
    const ids = Object.keys(model.documents).filter(
      (id) => id === `file:${action.path}` || id.startsWith(`file:${action.path}/`)
    );
    return ids.reduce(
      (next, tabId) =>
        next.groups.reduce((current, group) => closeInGroup(current, group.id, tabId, true), next),
      model
    );
  }

  if (action.type === "activate-group") {
    return getGroup(model, action.groupId) ? { ...model, activeGroupId: action.groupId } : model;
  }

  if (action.type === "activate-tab") {
    if (!getGroup(model, action.groupId)) return model;
    return {
      ...model,
      activeGroupId: action.groupId,
      groups: updateGroup(model.groups, action.groupId, (group) => ({
        ...group,
        activeTabId: action.tabId,
      })),
    };
  }

  if (action.type === "open") {
    return openInGroup(model, action.groupId ?? model.activeGroupId, action.tab);
  }

  if (action.type === "close") {
    return closeInGroup(model, action.groupId, action.tabId, action.force);
  }

  if (action.type === "close-all" || action.type === "close-saved") {
    const group = getGroup(model, action.groupId);
    if (!group) return model;
    const tabIds = group.tabIds.filter((id) => {
      if (action.type === "close-saved") return model.documents[id]?.dirty;
      return !action.force && !canCloseDocument(model, action.groupId, id);
    });
    return replaceGroupTabs(model, action.groupId, tabIds);
  }

  if (action.type === "close-others" || action.type === "close-after") {
    const group = getGroup(model, action.groupId);
    if (!group) return model;
    const activeIndex = group.tabIds.indexOf(action.tabId);
    const tabIds = group.tabIds.filter((id, index) => {
      const shouldClose =
        action.type === "close-others" ? id !== action.tabId : index > activeIndex;
      return !shouldClose || !canCloseDocument(model, action.groupId, id);
    });
    return replaceGroupTabs(model, action.groupId, tabIds);
  }

  if (action.type === "toggle-pin") {
    const document = model.documents[action.tabId];
    const group = getGroup(model, action.groupId);
    if (!document || !group) return model;
    const pinned = !document.pinned;
    const documents = { ...model.documents, [action.tabId]: { ...document, pinned } };
    const tabIds = group.tabIds.filter((id) => id !== action.tabId);
    const firstUnpinned = tabIds.findIndex((id) => !documents[id]?.pinned);
    tabIds.splice(
      pinned ? (firstUnpinned < 0 ? tabIds.length : firstUnpinned) : tabIds.length,
      0,
      action.tabId
    );
    return {
      ...model,
      documents,
      groups: updateGroup(model.groups, action.groupId, (current) => ({ ...current, tabIds })),
    };
  }

  if (action.type === "split") {
    const source = getGroup(model, action.groupId);
    const tabId = source?.activeTabId;
    const tab = tabId ? model.documents[tabId] : undefined;
    if (!tab) return model;
    return addSplitGroup(model, action.groupId, action.placement, tab);
  }

  if (action.type === "resize-split") {
    const sizes = normalizeSplitSizes(action.sizes);
    return { ...model, layout: updateSplitSizes(model.layout, action.splitId, sizes) };
  }

  if (action.type === "drop") {
    const operation = action.operation ?? "move";
    const source = action.sourceGroupId ? getGroup(model, action.sourceGroupId) : undefined;
    if (
      operation === "move" &&
      action.placement !== "center" &&
      action.sourceGroupId === action.targetGroupId &&
      source?.tabIds.length === 1 &&
      source.tabIds[0] === action.tab.id
    ) {
      return model;
    }

    if (action.placement !== "center") {
      let next = addSplitGroup(model, action.targetGroupId, action.placement, action.tab);
      if (operation === "move" && action.sourceGroupId) {
        next = closeInGroup(next, action.sourceGroupId, action.tab.id, true);
      }
      return next;
    }

    let next = openInGroup(model, action.targetGroupId, action.tab);
    if (action.targetIndex !== undefined) {
      next = reorderInGroup(next, action.targetGroupId, action.tab.id, action.targetIndex);
    }
    if (
      operation === "move" &&
      action.sourceGroupId &&
      action.sourceGroupId !== action.targetGroupId
    ) {
      next = closeInGroup(next, action.sourceGroupId, action.tab.id, true);
    }
    return next;
  }

  const document = model.documents[action.tabId];
  if (!document) return model;
  return {
    ...model,
    documents: {
      ...model.documents,
      [action.tabId]: { ...document, ...action.changes, id: document.id },
    },
  };
}

function renameDocumentPath(model: EditorModel, sourcePath: string, destinationPath: string) {
  const sourceId = `file:${sourcePath}`;
  const replacements = new Map(
    Object.keys(model.documents).flatMap((id) =>
      id === sourceId || id.startsWith(`${sourceId}/`)
        ? [[id, `file:${destinationPath}${id.slice(sourceId.length)}`] as const]
        : []
    )
  );
  if (!replacements.size) return model;
  const documents = { ...model.documents };
  for (const [oldId, newId] of replacements) {
    const document = documents[oldId];
    if (!document) continue;
    delete documents[oldId];
    documents[newId] = {
      ...document,
      id: newId,
      title:
        oldId === sourceId ? (destinationPath.split("/").pop() ?? document.title) : document.title,
    };
  }
  return {
    ...model,
    documents,
    groups: model.groups.map((group) => ({
      ...group,
      tabIds: group.tabIds.map((id) => replacements.get(id) ?? id),
      activeTabId: group.activeTabId
        ? (replacements.get(group.activeTabId) ?? group.activeTabId)
        : undefined,
    })),
  };
}

export function getGroup(model: EditorModel, groupId: EditorGroupId) {
  return model.groups.find((group) => group.id === groupId);
}

function addSplitGroup(
  model: EditorModel,
  targetGroupId: EditorGroupId,
  placement: SplitPlacement,
  tab: EditorTab
): EditorModel {
  if (!getGroup(model, targetGroupId)) return model;
  const groupId = `group-${model.nextGroupNumber}`;
  const next: EditorModel = {
    ...model,
    documents: model.documents[tab.id] ? model.documents : { ...model.documents, [tab.id]: tab },
    groups: [...model.groups, { id: groupId, tabIds: [tab.id], activeTabId: tab.id }],
    activeGroupId: groupId,
    layout: insertSplit(model.layout, targetGroupId, groupId, placement, model.nextGroupNumber),
    nextGroupNumber: model.nextGroupNumber + 1,
  };
  return next;
}

function insertSplit(
  node: EditorLayoutNode,
  targetGroupId: EditorGroupId,
  newGroupId: EditorGroupId,
  placement: SplitPlacement,
  splitNumber: number
): EditorLayoutNode {
  if (node.type === "group") {
    if (node.groupId !== targetGroupId) return node;
    const inserted = { type: "group" as const, groupId: newGroupId };
    const insertedFirst = placement === "left" || placement === "top";
    return {
      type: "split",
      id: `split-${splitNumber}`,
      orientation: placement === "left" || placement === "right" ? "horizontal" : "vertical",
      sizes: [0.5, 0.5],
      first: insertedFirst ? inserted : node,
      second: insertedFirst ? node : inserted,
    };
  }
  return {
    ...node,
    first: insertSplit(node.first, targetGroupId, newGroupId, placement, splitNumber),
    second: insertSplit(node.second, targetGroupId, newGroupId, placement, splitNumber),
  };
}

function reorderInGroup(
  model: EditorModel,
  groupId: EditorGroupId,
  tabId: string,
  targetIndex: number
): EditorModel {
  return {
    ...model,
    groups: updateGroup(model.groups, groupId, (group) => {
      const currentIndex = group.tabIds.indexOf(tabId);
      const tabIds = group.tabIds.filter((id) => id !== tabId);
      const adjustedIndex =
        currentIndex >= 0 && currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      tabIds.splice(Math.max(0, Math.min(adjustedIndex, tabIds.length)), 0, tabId);
      return { ...group, tabIds, activeTabId: tabId };
    }),
  };
}

function openInGroup(model: EditorModel, groupId: EditorGroupId, tab: EditorTab): EditorModel {
  if (!getGroup(model, groupId)) return model;
  const documents = model.documents[tab.id]
    ? model.documents
    : { ...model.documents, [tab.id]: tab };
  return {
    ...model,
    documents,
    activeGroupId: groupId,
    groups: updateGroup(model.groups, groupId, (group) => ({
      ...group,
      tabIds: group.tabIds.includes(tab.id) ? group.tabIds : [...group.tabIds, tab.id],
      activeTabId: tab.id,
    })),
  };
}

function closeInGroup(
  model: EditorModel,
  groupId: EditorGroupId,
  tabId: string,
  force = false
): EditorModel {
  const group = getGroup(model, groupId);
  if (!group) return model;
  if (!force && !canCloseDocument(model, groupId, tabId)) return model;
  const index = group.tabIds.indexOf(tabId);
  return replaceGroupTabs(
    model,
    groupId,
    group.tabIds.filter((id) => id !== tabId),
    index
  );
}

function canCloseDocument(model: EditorModel, groupId: EditorGroupId, tabId: string) {
  if (!model.documents[tabId]?.dirty) return true;
  return model.groups.some((group) => group.id !== groupId && group.tabIds.includes(tabId));
}

function normalizeSplitSizes([first, second]: [number, number]): [number, number] {
  const safeFirst = Number.isFinite(first) ? Math.max(0, first) : 0;
  const safeSecond = Number.isFinite(second) ? Math.max(0, second) : 0;
  const total = safeFirst + safeSecond;
  return total > 0 ? [safeFirst / total, safeSecond / total] : [0.5, 0.5];
}

function updateSplitSizes(
  node: EditorLayoutNode,
  splitId: string,
  sizes: [number, number]
): EditorLayoutNode {
  if (node.type === "group") return node;
  if (node.id === splitId) return { ...node, sizes };
  return {
    ...node,
    first: updateSplitSizes(node.first, splitId, sizes),
    second: updateSplitSizes(node.second, splitId, sizes),
  };
}

function replaceGroupTabs(
  model: EditorModel,
  groupId: EditorGroupId,
  tabIds: string[],
  closedIndex = 0
): EditorModel {
  if (tabIds.length === 0 && model.groups.length > 1) {
    const groups = model.groups.filter((group) => group.id !== groupId);
    const layout = removeLayoutGroup(model.layout, groupId);
    const fallbackId = firstLayoutGroup(layout);
    return {
      ...model,
      groups,
      layout,
      activeGroupId: model.activeGroupId === groupId ? fallbackId : model.activeGroupId,
    };
  }
  return {
    ...model,
    groups: updateGroup(model.groups, groupId, (group) => ({
      ...group,
      tabIds,
      activeTabId: tabIds.includes(group.activeTabId ?? "")
        ? group.activeTabId
        : tabIds[Math.min(closedIndex, Math.max(tabIds.length - 1, 0))],
    })),
  };
}

function removeLayoutGroup(node: EditorLayoutNode, groupId: EditorGroupId): EditorLayoutNode {
  if (node.type === "group") return node;
  if (node.first.type === "group" && node.first.groupId === groupId) return node.second;
  if (node.second.type === "group" && node.second.groupId === groupId) return node.first;
  return {
    ...node,
    first: removeLayoutGroup(node.first, groupId),
    second: removeLayoutGroup(node.second, groupId),
  };
}

function firstLayoutGroup(node: EditorLayoutNode): EditorGroupId {
  return node.type === "group" ? node.groupId : firstLayoutGroup(node.first);
}

function updateGroup(
  groups: EditorGroupState[],
  groupId: EditorGroupId,
  update: (group: EditorGroupState) => EditorGroupState
) {
  return groups.map((group) => (group.id === groupId ? update(group) : group));
}
