import type { SimulationLinkDatum, SimulationNodeDatum } from "d3";
import type { VaultGraph } from "@symtab/bridge-contract";
import type { DemoDocument } from "../../editor/markdown-editor";
import { buildLinkIndex, linkedTitles } from "../../editor/link-index";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: "file" | "tag" | "attachment" | "missing";
  connected: boolean;
  path?: string;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

const TAGS_PATTERN = /(?:^|\n)tags:\s*\[([^\]]+)\]/i;

export function graphNodeRadius(node: GraphNode, degree: number, scale = 1) {
  const baseRadius = node.kind === "tag" ? 3 : 3.5;
  const rankGrowth = Math.min(8, Math.log2(degree + 1) * 0.8);
  return (baseRadius + rankGrowth) * scale;
}

export function graphLabelBudget(scale: number) {
  if (scale < 0.55) return 0;
  if (scale < 1) return 20;
  if (scale < 1.5) return 60;
  return 120;
}

function tagsFor(content: string) {
  const inlineTags = [...content.matchAll(/(^|\s)#([\w/-]+)/g)].map((match) => match[2]);
  const frontmatterTags =
    content
      .match(TAGS_PATTERN)?.[1]
      ?.split(",")
      .map((tag) => tag.trim()) ?? [];
  return [...new Set([...inlineTags, ...frontmatterTags].filter(Boolean))];
}

export function buildGraph(
  documents: DemoDocument[],
  vaultGraph: VaultGraph | null | undefined,
  activePath: string | undefined,
  showTags: boolean,
  showAttachments: boolean,
  existingFilesOnly: boolean
) {
  const edges = new Map<string, GraphLink>();
  const connected = new Set<string>(activePath ? [activePath] : []);
  const nodes = new Map<string, GraphNode>();
  if (vaultGraph) {
    for (const node of vaultGraph.nodes) {
      if (node.kind === "binary" && !showAttachments) continue;
      if (node.kind === "missing" && existingFilesOnly) continue;
      nodes.set(node.id, {
        id: node.id,
        title: node.kind === "markdown" ? node.label.replace(/\.(md|markdown)$/i, "") : node.label,
        kind: node.kind === "missing" ? "missing" : node.kind === "binary" ? "attachment" : "file",
        connected: false,
        path: node.path,
      });
    }
    if (showTags) {
      for (const file of vaultGraph.nodes) {
        if (!nodes.has(file.id)) continue;
        for (const tag of file.tags ?? []) {
          const id = `tag:${tag}`;
          nodes.set(id, { id, title: `#${tag}`, kind: "tag", connected: false });
          edges.set(`${file.id}\n${id}`, { source: file.id, target: id });
        }
      }
    }
    for (const edge of vaultGraph.edges) {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      edges.set(`${edge.source}\n${edge.target}`, { source: edge.source, target: edge.target });
      if (edge.source === activePath || edge.target === activePath) {
        connected.add(edge.source);
        connected.add(edge.target);
      }
    }
  } else {
    for (const document of documents) {
      const id = document.path ?? document.title;
      nodes.set(id, {
        id,
        title: document.title,
        kind: "file",
        connected: false,
        path: document.path,
      });
    }
    const linkIndex = buildLinkIndex(documents);
    for (const edge of linkIndex.edges) {
      const id = `${edge.source}\n${edge.target}`;
      edges.set(id, { source: edge.source, target: edge.target });
      if (edge.source === activePath || edge.target === activePath) {
        connected.add(edge.source);
        connected.add(edge.target);
      }
    }
  }
  const knownTitles = new Set(documents.map((document) => document.title));

  for (const document of documents) {
    const documentId = document.path ?? document.title;
    if (!nodes.has(documentId)) continue;
    if (showTags) {
      for (const tag of tagsFor(document.content)) {
        const id = `#${tag}`;
        if (!nodes.has(id)) nodes.set(id, { id, title: id, kind: "tag", connected: false });
        edges.set(`${documentId}\n${id}`, { source: documentId, target: id });
      }
    }
    if (!vaultGraph && !existingFilesOnly) {
      for (const target of linkedTitles(document.content)) {
        const missingTitle = target.slice(target.lastIndexOf("/") + 1);
        if (!missingTitle || knownTitles.has(missingTitle) || nodes.has(missingTitle)) continue;
        nodes.set(missingTitle, {
          id: missingTitle,
          title: missingTitle,
          kind: "missing",
          connected: false,
        });
        edges.set(`${documentId}\n${missingTitle}`, {
          source: documentId,
          target: missingTitle,
        });
      }
    }
  }

  for (const node of nodes.values()) {
    node.connected = activePath ? connected.has(node.id) || node.id === activePath : true;
  }

  return { nodes: [...nodes.values()], links: [...edges.values()] };
}
