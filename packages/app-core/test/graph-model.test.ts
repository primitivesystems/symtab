import { expect, test } from "bun:test";
import { buildGraph, graphLabelBudget, graphNodeRadius } from "../src/workspace/graph/model";
import type { VaultGraph } from "@flux/bridge-contract";

test("backend graph includes indexed tags without loading document contents", () => {
  const graph: VaultGraph = {
    nodes: [
      { id: "a.md", path: "a.md", label: "a.md", kind: "markdown", tags: ["focus"] },
      { id: "b.md", path: "b.md", label: "b.md", kind: "markdown", tags: ["focus"] },
    ],
    edges: [{ source: "a.md", target: "b.md" }],
  };
  const hidden = buildGraph([], graph, undefined, false, false, false);
  const shown = buildGraph([], graph, undefined, true, false, false);
  expect(hidden.nodes).toHaveLength(2);
  expect(shown.nodes).toHaveLength(3);
  expect(shown.links).toHaveLength(3);
  expect(shown.nodes.find((node) => node.kind === "tag")?.title).toBe("#focus");
  expect(shown.nodes[0]?.title).toBe("a");
  expect(graphNodeRadius(shown.nodes[0]!, 1)).toBeLessThan(5);
});

test("graph labels stay bounded at overview zoom", () => {
  expect(graphLabelBudget(0.2)).toBe(0);
  expect(graphLabelBudget(0.8)).toBe(20);
  expect(graphLabelBudget(1.2)).toBe(60);
  expect(graphLabelBudget(2)).toBe(120);
});
