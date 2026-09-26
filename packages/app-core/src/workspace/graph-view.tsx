import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  select,
  zoom,
  zoomIdentity,
  type ZoomTransform,
} from "d3";
import {
  Bookmark,
  Camera,
  PanelBottomOpen,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Settings,
  WandSparkles,
  X,
} from "lucide-react";
import { MenuItem } from "@symtab/shared-ui/components/ui/menu";
import { Application, BitmapText, Color, Container, Graphics, Rectangle } from "pixi.js";
import { SymtabEditorPane } from "@symtab/shared-ui/components/workspace-tab";
import type { DemoDocument } from "../editor/markdown-editor";
import { buildGraph, graphLabelBudget, graphNodeRadius, type GraphNode, type GraphLink } from "./graph/model";
import { GraphSection as ForceSection, GraphSwitch, GraphSlider } from "@symtab/shared-ui/components/design-system/graph/graph-controls";
import { Button } from "@symtab/shared-ui/components/ui/button";
import { Input } from "@symtab/shared-ui/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@symtab/shared-ui/components/ui/context-menu";
import type { VaultGraph } from "@symtab/bridge-contract";

interface GraphViewProps {
  embedded?: boolean;
  documents: DemoDocument[];
  vaultGraph?: VaultGraph | null;
  activePath?: string;
  bookmarked: boolean;
  onBookmarkChange: (value: boolean) => void;
  onOpenDocument: (title: string) => void;
  onSearchTag?: (tag: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
}

function GraphViewMenu({
  bookmarked,
  onBookmarkChange,
  onCopyScreenshot,
  onSplitRight,
  onSplitDown,
}: {
  bookmarked: boolean;
  onBookmarkChange: (value: boolean) => void;
  onCopyScreenshot: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onSplitRight}>
        <PanelRightOpen className="size-4 text-muted-foreground" /> Split right
      </MenuItem>
      <MenuItem onClick={onSplitDown}>
        <PanelBottomOpen className="size-4 text-muted-foreground" /> Split down
      </MenuItem>
      <MenuItem onClick={onCopyScreenshot}>
        <Camera className="size-4 text-muted-foreground" /> Copy screenshot
      </MenuItem>
      <MenuItem onClick={() => onBookmarkChange(!bookmarked)}>
        <Bookmark className="size-4 text-muted-foreground" /> Bookmark…
      </MenuItem>
    </>
  );
}

interface GraphDrag {
  node: GraphNode;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  at: number;
  vx: number;
  vy: number;
  moved: boolean;
}

const WIDTH = 960;
const HEIGHT = 640;

interface PixiGraphScene {
  app: Application;
  world: Container;
  links: Graphics;
  nodes: Graphics;
  labels: Container;
  labelById: Map<string, BitmapText>;
  labelColor: number;
}

export function GraphView({
  embedded = false,
  documents,
  vaultGraph,
  activePath,
  bookmarked,
  onBookmarkChange,
  onOpenDocument,
  onSearchTag,
  onSplitRight,
  onSplitDown,
}: GraphViewProps) {
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [contextNode, setContextNode] = useState<GraphNode | null>(null);
  const [showTags, setShowTags] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [existingFilesOnly, setExistingFilesOnly] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [textFadeThreshold, setTextFadeThreshold] = useState(0);
  const [nodeSize, setNodeSize] = useState(1);
  const [linkThickness, setLinkThickness] = useState(1);
  const [groups, setGroups] = useState<Array<{ id: number; query: string; color: string }>>([]);
  const [centerForce, setCenterForce] = useState(0.5187132);
  const [repelForce, setRepelForce] = useState(10);
  const [linkForce, setLinkForce] = useState(1);
  const [linkDistance, setLinkDistance] = useState(250);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<GraphNode[]>([]);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [viewport, setViewport] = useState({ width: WIDTH, height: HEIGHT });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiGraphScene | null>(null);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const zoomRef = useRef<ReturnType<typeof zoom<HTMLDivElement, unknown>> | null>(null);
  const dragRef = useRef<GraphDrag | null>(null);
  const layoutNodesRef = useRef<GraphNode[]>([]);
  const frameRef = useRef<number | undefined>(undefined);
  const lastLayoutUpdateRef = useRef(0);
  const fitGraphRef = useRef<(minimumScale?: number) => void>(() => undefined);
  const autoFitPendingRef = useRef(true);
  const graph = useMemo(
    () =>
      buildGraph(documents, vaultGraph, activePath, showTags, showAttachments, existingFilesOnly),
    [activePath, documents, existingFilesOnly, showAttachments, showTags, vaultGraph]
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDarkMode(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    autoFitPendingRef.current = true;
  }, [graph]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let disposed = false;
    const app = new Application();
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setViewport((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
      pixiRef.current?.app.renderer.resize(width, height);
      pixiRef.current?.app.render();
    });
    void app
      .init({
        width: Math.max(1, surface.clientWidth),
        height: Math.max(1, surface.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
        powerPreference: "high-performance",
        autoStart: false,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        const world = new Container();
        const links = new Graphics();
        const nodes = new Graphics();
        const labels = new Container();
        world.addChild(links, nodes, labels);
        app.stage.addChild(world);
        app.canvas.className = "block size-full";
        app.canvas.setAttribute("aria-hidden", "true");
        surface.prepend(app.canvas);
        pixiRef.current = {
          app,
          world,
          links,
          nodes,
          labels,
          labelById: new Map(),
          labelColor: -1,
        };
        observer.observe(surface);
        const width = Math.max(1, surface.clientWidth);
        const height = Math.max(1, surface.clientHeight);
        setViewport({ width, height });
        app.renderer.resize(width, height);
        app.render();
      });
    return () => {
      disposed = true;
      observer.disconnect();
      if (pixiRef.current?.app === app) {
        pixiRef.current = null;
        app.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    const previous = new Map(layoutNodesRef.current.map((node) => [node.id, node]));
    const nodes = graph.nodes.map((node) => {
      const old = previous.get(node.id);
      return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : { ...node };
    });
    const links = graph.links.map((link) => ({ ...link }));
    const degreeById = new Map<string, number>();
    for (const link of links) {
      const source = typeof link.source === "string" ? link.source : link.source.id;
      const target = typeof link.target === "string" ? link.target : link.target.id;
      degreeById.set(source, (degreeById.get(source) ?? 0) + 1);
      degreeById.set(target, (degreeById.get(target) ?? 0) + 1);
    }
    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(linkDistance * 0.16)
          .strength(linkForce * 0.18)
      )
      .force("charge", forceManyBody().strength(-repelForce * 10))
      .force("x", forceX(viewport.width / 2).strength(centerForce * 0.1))
      .force("y", forceY(viewport.height / 2).strength(centerForce * 0.1))
      .force(
        "collision",
        forceCollide<GraphNode>().radius(
          (node) => graphNodeRadius(node, degreeById.get(node.id) ?? 0, nodeSize) + 3
        )
      )
      .velocityDecay(0.2)
      .alphaDecay(nodes.length > 1_000 ? 0.06 : 0.025)
      .on("tick", () => {
        const now = performance.now();
        if (now - lastLayoutUpdateRef.current < 50) return;
        if (frameRef.current !== undefined) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = undefined;
          lastLayoutUpdateRef.current = performance.now();
          layoutNodesRef.current = nodes;
          setLayoutNodes([...nodes]);
        });
      })
      .on("end", () => {
        layoutNodesRef.current = nodes;
        setLayoutNodes([...nodes]);
        if (autoFitPendingRef.current) {
          autoFitPendingRef.current = false;
          requestAnimationFrame(() => fitGraphRef.current());
        }
      });

    simulationRef.current = simulation;
    return () => {
      simulation.stop();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [
    centerForce,
    graph,
    linkDistance,
    linkForce,
    nodeSize,
    repelForce,
    viewport.height,
    viewport.width,
  ]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.05, 4])
      .filter((event) => !dragRef.current && (!event.button || event.type === "wheel"))
      .on("start", (event) => {
        if (event.sourceEvent) autoFitPendingRef.current = false;
      })
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = behavior;
    select(surface).call(behavior);
    return () => {
      select(surface).on(".zoom", null);
    };
  }, []);

  const linkNodeId = (value: string | GraphNode) => (typeof value === "string" ? value : value.id);
  const linkedIds = useMemo(
    () =>
      new Set(graph.links.flatMap((link) => [linkNodeId(link.source), linkNodeId(link.target)])),
    [graph.links]
  );
  const visibleNodes = useMemo(
    () =>
      layoutNodes.filter((node) => {
        if (!showOrphans && node.kind === "file" && !linkedIds.has(node.id)) return false;
        return !query || node.title.toLowerCase().includes(query.toLowerCase());
      }),
    [layoutNodes, linkedIds, query, showOrphans]
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const nodeById = useMemo(
    () => new Map(layoutNodes.map((node) => [node.id, node])),
    [layoutNodes]
  );
  const linkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    graph.links.forEach((link) => {
      const source = linkNodeId(link.source);
      const target = linkNodeId(link.target);
      counts.set(source, (counts.get(source) ?? 0) + 1);
      counts.set(target, (counts.get(target) ?? 0) + 1);
    });
    return counts;
  }, [graph.links]);
  const labelRank = useMemo(
    () => new Map([...graph.nodes]
      .sort((a, b) => (linkCounts.get(b.id) ?? 0) - (linkCounts.get(a.id) ?? 0))
      .map((node, index) => [node.id, index])),
    [graph.nodes, linkCounts]
  );
  const hoveredNeighbors = useMemo(() => {
    const neighbors = new Set<string>(hoveredId ? [hoveredId] : []);
    if (hoveredId) {
      graph.links.forEach((link) => {
        const source = linkNodeId(link.source);
        const target = linkNodeId(link.target);
        if (source === hoveredId) neighbors.add(target);
        if (target === hoveredId) neighbors.add(source);
      });
    }
    return neighbors;
  }, [graph.links, hoveredId]);
  useEffect(() => {
    const scene = pixiRef.current;
    const surface = surfaceRef.current;
    if (!scene || !surface) return;
    const { app, world, links, nodes, labels, labelById } = scene;
    const foreground = darkMode ? 0xcccccc : 0x555555;
    const linkColor = darkMode ? 0x707070 : 0xababab;
    const nodeColor = darkMode ? 0xb2b2b2 : 0x666666;
    const secondaryNodeColor = darkMode ? 0x707070 : 0x929292;
    const baseLinkAlpha = Math.max(0.06,
      Math.min(darkMode ? 0.4 : 0.42, 8 / Math.sqrt(Math.max(1, graph.links.length))));
    if (scene.labelColor !== foreground) {
      for (const label of labelById.values()) label.style.fill = foreground;
      scene.labelColor = foreground;
    }
    world.position.set(transform.x, transform.y);
    world.scale.set(transform.k);
    links.clear();
    nodes.clear();
    for (const label of labelById.values()) label.visible = false;
    const liveLabelIds = new Set<string>();

    let baseLinks = false;
    for (const link of graph.links) {
      const sourceId = linkNodeId(link.source);
      const targetId = linkNodeId(link.target);
      if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) continue;
      const source = nodeById.get(sourceId);
      const target = nodeById.get(targetId);
      if (!source || !target || source.x === undefined || source.y === undefined) continue;
      if (target.x === undefined || target.y === undefined) continue;
      const highlighted = hoveredId === sourceId || hoveredId === targetId;
      if (!highlighted) {
        links.moveTo(source.x, source.y).lineTo(target.x, target.y);
        baseLinks = true;
      }
    }
    if (baseLinks)
      links.stroke({
        color: linkColor,
        width: 0.7 * linkThickness,
        alpha: hoveredId ? Math.min(0.08, baseLinkAlpha) : baseLinkAlpha,
      });
    if (hoveredId) {
      let highlightedLinks = false;
      for (const link of graph.links) {
        const sourceId = linkNodeId(link.source);
        const targetId = linkNodeId(link.target);
        if (hoveredId !== sourceId && hoveredId !== targetId) continue;
        const source = nodeById.get(sourceId);
        const target = nodeById.get(targetId);
        if (!source || !target || source.x === undefined || source.y === undefined) continue;
        if (target.x === undefined || target.y === undefined) continue;
        links.moveTo(source.x, source.y).lineTo(target.x, target.y);
        highlightedLinks = true;
      }
      if (highlightedLinks)
        links.stroke({ color: 0x8b7cf6, width: 1.1 * linkThickness, alpha: 0.9 });
    }
    if (showArrows && transform.k > 0.8) {
      for (const link of graph.links) {
        const sourceId = linkNodeId(link.source);
        const targetId = linkNodeId(link.target);
        if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) continue;
        const source = nodeById.get(sourceId);
        const target = nodeById.get(targetId);
        if (!source || !target || source.x === undefined || source.y === undefined) continue;
        if (target.x === undefined || target.y === undefined) continue;
        const highlighted = hoveredId === sourceId || hoveredId === targetId;
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        const size = 4;
        links
          .poly([
            target.x,
            target.y,
            target.x - Math.cos(angle - Math.PI / 6) * size,
            target.y - Math.sin(angle - Math.PI / 6) * size,
            target.x - Math.cos(angle + Math.PI / 6) * size,
            target.y - Math.sin(angle + Math.PI / 6) * size,
          ])
          .fill({
            color: highlighted ? 0x8b7cf6 : linkColor,
            alpha: hoveredId && !highlighted ? 0.12 : highlighted ? 0.9 : baseLinkAlpha,
          });
      }
    }
    const labelBudget = graphLabelBudget(
      transform.k - textFadeThreshold * 1.4 - (darkMode ? 0.1 : 0)
    );
    for (const node of visibleNodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const active = node.id === activePath;
      const hovered = node.id === hoveredId;
      const radius = graphNodeRadius(node, linkCounts.get(node.id) ?? 0, nodeSize);
      const groupColor = groups.find(
        (group) =>
          group.query.trim() &&
          node.title.toLocaleLowerCase().includes(group.query.trim().toLocaleLowerCase())
      )?.color;
      const fill =
        active || hovered
          ? 0x8b7cf6
          : groupColor
            ? new Color(groupColor).toNumber()
            : node.kind === "tag" || node.kind === "missing"
              ? secondaryNodeColor
              : nodeColor;
      nodes.circle(node.x, node.y, radius).fill({ color: fill, alpha: hoveredId && !hoveredNeighbors.has(node.id) ? 0.18 : 1 });
      if (showLabels &&
        (hovered || active || (labelRank.get(node.id) ?? Number.POSITIVE_INFINITY) < labelBudget)) {
        const screenX = node.x * transform.k + transform.x;
        const screenY = node.y * transform.k + transform.y;
        if (
          screenX < -160 ||
          screenX > viewport.width + 160 ||
          screenY < -30 ||
          screenY > viewport.height + 30
        )
          continue;
        let label = labelById.get(node.id);
        if (!label) {
          label = new BitmapText({
            text: node.title,
            style: { fontFamily: "system-ui", fontSize: 11, fill: foreground },
          });
          labelById.set(node.id, label);
          labels.addChild(label);
        }
        label.text = node.title;
        label.position.set(node.x, node.y + radius + 2.5);
        label.anchor.set(0.5, 0);
        label.visible = true;
        liveLabelIds.add(node.id);
        label.alpha =
          hoveredId && !hoveredNeighbors.has(node.id)
            ? 0.12
            : hovered
              ? 1
              : node.connected || active
                ? 0.82
                : 0.55;
      }
    }
    for (const [id, label] of labelById) {
      if (liveLabelIds.has(id)) continue;
      labels.removeChild(label);
      label.destroy();
      labelById.delete(id);
    }
    app.render();
  }, [
    activePath,
    darkMode,
    graph.links,
    groups,
    hoveredId,
    hoveredNeighbors,
    layoutNodes,
    linkCounts,
    linkThickness,
    labelRank,
    nodeById,
    nodeSize,
    showArrows,
    showLabels,
    textFadeThreshold,
    transform,
    viewport.height,
    viewport.width,
    visibleIds,
    visibleNodes,
  ]);
  const fitGraph = (minimumScale = 0) => {
    const surface = surfaceRef.current;
    const behavior = zoomRef.current;
    if (!surface || !behavior || !visibleNodes.length) return;
    const xs = visibleNodes.map((node) => node.x ?? viewport.width / 2);
    const ys = visibleNodes.map((node) => node.y ?? viewport.height / 2);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(120, maxX - minX + 120);
    const height = Math.max(120, maxY - minY + 120);
    const scale = Math.max(
      minimumScale,
      Math.min(1, 0.9 / Math.max(width / viewport.width, height / viewport.height))
    );
    const next = zoomIdentity
      .translate(viewport.width / 2, viewport.height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    const selection = select(surface);
    if (reducedMotion) selection.call(behavior.transform, next);
    else selection.transition().duration(180).call(behavior.transform, next);
  };
  useEffect(() => {
    fitGraphRef.current = fitGraph;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!autoFitPendingRef.current) return;
      autoFitPendingRef.current = false;
      fitGraphRef.current();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [graph]);
  const reset = () => {
    setQuery("");
    setShowTags(false);
    setShowAttachments(false);
    setExistingFilesOnly(false);
    setShowOrphans(false);
    setShowLabels(true);
    setShowArrows(false);
    setTextFadeThreshold(0);
    setNodeSize(1);
    setLinkThickness(1);
    setCenterForce(0.5187132);
    setRepelForce(10);
    setLinkForce(1);
    setLinkDistance(250);
    setGroups([]);
    const surface = surfaceRef.current;
    const behavior = zoomRef.current;
    if (surface && behavior) select(surface).call(behavior.transform, zoomIdentity);
    simulationRef.current?.alpha(0.8).restart();
  };
  const changeZoom = (factor: number) => {
    const surface = surfaceRef.current;
    const behavior = zoomRef.current;
    if (surface && behavior) {
      const selection = select(surface);
      if (reducedMotion) selection.call(behavior.scaleBy, factor);
      else selection.transition().duration(140).call(behavior.scaleBy, factor);
    }
  };
  const copyScreenshot = () => {
    const scene = pixiRef.current;
    const surface = surfaceRef.current;
    if (!scene || !surface || !navigator.clipboard || typeof ClipboardItem === "undefined") return;
    scene.app.render();
    const source = scene.app.renderer.extract.canvas({
      target: scene.app.stage,
      frame: new Rectangle(0, 0, viewport.width, viewport.height),
      antialias: true,
    }) as HTMLCanvasElement;
    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    if (!context) return;
    context.fillStyle = getComputedStyle(surface).backgroundColor || "#111";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0);
    output.toBlob((blob) => {
      if (blob) void navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    }, "image/png");
  };
  const graphCoordinates = (event: React.MouseEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - transform.x) / transform.k,
      y: (event.clientY - bounds.top - transform.y) / transform.k,
    };
  };
  const nodeAtPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const coordinates = graphCoordinates(event);
    if (!coordinates) return null;
    let nearest: GraphNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const node of visibleNodes) {
      if (node.x === undefined || node.y === undefined || (!node.path && node.kind !== "tag")) continue;
      const radius = graphNodeRadius(node, linkCounts.get(node.id) ?? 0, nodeSize);
      const distance = Math.hypot(coordinates.x - node.x, coordinates.y - node.y);
      if (distance <= radius + 8 / transform.k && distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    return nearest;
  };
  const moveNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const coordinates = graphCoordinates(event);
    if (!coordinates) return;
    const now = event.timeStamp;
    const elapsed = Math.max(8, now - session.at);
    session.vx = ((coordinates.x - session.x) * 16) / elapsed;
    session.vy = ((coordinates.y - session.y) * 16) / elapsed;
    session.x = coordinates.x;
    session.y = coordinates.y;
    session.at = now;
    session.node.fx = coordinates.x;
    session.node.fy = coordinates.y;
    session.node.x = coordinates.x;
    session.node.y = coordinates.y;
    session.moved ||=
      Math.hypot(coordinates.x - session.startX, coordinates.y - session.startY) > 4 / transform.k;
    layoutNodesRef.current = [...layoutNodesRef.current];
    setLayoutNodes([...layoutNodesRef.current]);
    simulationRef.current?.alpha(0.45).restart();
  };
  const finishNodeDrag = (event: React.PointerEvent<HTMLDivElement>, openOnClick = true) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const node = session.node;
    const shouldOpen =
      openOnClick &&
      !session.moved &&
      (node.kind === "file" || node.kind === "attachment") &&
      Boolean(node.path);
    node.fx = null;
    node.fy = null;
    node.vx = session.vx * 0.85;
    node.vy = session.vy * 0.85;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    simulationRef.current?.alphaTarget(0).alpha(0.75).restart();
    if (shouldOpen) onOpenDocument(node.path!);
    if (openOnClick && !session.moved && node.kind === "tag") onSearchTag?.(node.title.replace(/^#/, ""));
  };

  const content = (
      <section
        className="relative flex h-full w-full min-h-0 min-w-0 flex-col bg-[var(--workbench-editor,var(--background))]"
        aria-label="Graph view"
      >
        <ContextMenu>
        <ContextMenuTrigger render={<div
          ref={surfaceRef}
          className="absolute inset-0 touch-none overflow-hidden bg-inherit outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          role="img"
          aria-label="Knowledge graph"
          aria-description="Drag to pan. Use arrow keys to move, plus and minus to zoom, and Home to fit. Click a note to open it."
          tabIndex={0}
          onContextMenu={(event) => setContextNode(nodeAtPointer(event))}
          onKeyDown={(event) => {
            autoFitPendingRef.current = false;
            if (event.key === "+" || event.key === "=") changeZoom(1.25);
            else if (event.key === "-") changeZoom(0.8);
            else if (event.key === "Home") fitGraph();
            else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              const surface = surfaceRef.current;
              const behavior = zoomRef.current;
              const step = (event.shiftKey ? 100 : 30) / transform.k;
              if (surface && behavior) select(surface).call(behavior.translateBy,
                event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0,
                event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0);
            } else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            autoFitPendingRef.current = false;
            const node = nodeAtPointer(event);
            const coordinates = graphCoordinates(event);
            if (!node || !coordinates) return;
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = {
              node,
              pointerId: event.pointerId,
              startX: coordinates.x,
              startY: coordinates.y,
              x: coordinates.x,
              y: coordinates.y,
              at: event.timeStamp,
              vx: 0,
              vy: 0,
              moved: false,
            };
            node.fx = node.x;
            node.fy = node.y;
            event.currentTarget.setPointerCapture(event.pointerId);
            simulationRef.current?.alphaTarget(0.32).restart();
          }}
          onPointerMove={(event) => {
            if (dragRef.current) moveNode(event);
            else setHoveredId(nodeAtPointer(event)?.id ?? null);
          }}
          onPointerUp={finishNodeDrag}
          onPointerCancel={(event) => finishNodeDrag(event, false)}
          onPointerLeave={() => {
            if (!dragRef.current) setHoveredId(null);
          }}
        />} />
        <ContextMenuContent>
          {contextNode?.path ? <ContextMenuItem onClick={() => onOpenDocument(contextNode.path!)}>Open note</ContextMenuItem> : null}
          {contextNode?.kind === "tag" ? <ContextMenuItem onClick={() => onSearchTag?.(contextNode.title.replace(/^#/, ""))}>Find notes with this tag</ContextMenuItem> : null}
          <ContextMenuItem onClick={() => fitGraph()}>Fit graph to view</ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
        <div
          className="absolute right-2 top-2 z-20 flex flex-col gap-0.5 text-muted-foreground"
        >
          <Button variant="ghost"
            type="button"
            aria-label="Open graph settings"
            title="Open graph settings"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => {
              autoFitPendingRef.current = false;
              setShowSettings((open) => !open);
            }}
          >
            <Settings className="size-3.5" />
          </Button>
          <Button variant="ghost"
            type="button"
            aria-label="Animate graph layout"
            title="Animate graph layout"
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
            onClick={() => {
              autoFitPendingRef.current = false;
              simulationRef.current?.alpha(1).restart();
            }}
          >
            <WandSparkles className="size-3.5" />
          </Button>
        </div>
        {showSettings ? (
          <aside className="absolute right-2 top-2 z-30 max-h-[calc(100%-1rem)] w-60 max-w-[calc(100%-1rem)] animate-in overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-border fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none">
            <ForceSection title="Filters" defaultOpen actions={<>
              <Button variant="ghost" size="icon-sm" aria-label="Restore default graph settings" onClick={reset}><RotateCcw className="size-3.5" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Close graph settings" onClick={() => setShowSettings(false)}><X className="size-3.5" /></Button>
            </>}>
              <Input aria-label="Search graph" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" className="h-8 text-xs" />

              <GraphSwitch label="Tags" checked={showTags} onCheckedChange={setShowTags} />
              <GraphSwitch label="Attachments" checked={showAttachments} onCheckedChange={setShowAttachments} />
              <GraphSwitch label="Existing files only" checked={existingFilesOnly} onCheckedChange={setExistingFilesOnly} />
              <GraphSwitch label="Orphans" checked={showOrphans} onCheckedChange={setShowOrphans} />
            </ForceSection>
            <ForceSection title="Groups">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label="Group color"
                    value={group.color}
                    onChange={(event) =>
                      setGroups((current) =>
                        current.map((candidate) =>
                          candidate.id === group.id
                            ? { ...candidate, color: event.target.value }
                            : candidate
                        )
                      )
                    }
                    className="size-6 rounded border-0 bg-transparent p-0"
                  />
                  <input
                    aria-label="Group query"
                    value={group.query}
                    onChange={(event) =>
                      setGroups((current) =>
                        current.map((candidate) =>
                          candidate.id === group.id
                            ? { ...candidate, query: event.target.value }
                            : candidate
                        )
                      )
                    }
                    placeholder="Search query"
                    className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none [border-color:var(--layout-separator)]"
                  />
                  <Button variant="ghost"
                    type="button"
                    aria-label="Remove group"
                    onClick={() =>
                      setGroups((current) =>
                        current.filter((candidate) => candidate.id !== group.id)
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost"
                type="button"
                className="flex h-7 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setGroups((current) => [
                    ...current,
                    { id: Date.now(), query: "", color: "#8b5cf6" },
                  ])
                }
              >
                <Plus className="size-3.5" /> New group
              </Button>
            </ForceSection>
            <ForceSection title="Display">
              <GraphSwitch label="Show labels" checked={showLabels} onCheckedChange={setShowLabels} />
              <GraphSwitch label="Arrows" checked={showArrows} onCheckedChange={setShowArrows} />
              <GraphSlider label="Text fade threshold" value={textFadeThreshold} min={0} max={1} step={0.01} onChange={setTextFadeThreshold} />
              <GraphSlider label="Node size" value={nodeSize} min={0.5} max={2.5} step={0.05} onChange={setNodeSize} />
              <GraphSlider label="Link thickness" value={linkThickness} min={0.4} max={3} step={0.05} onChange={setLinkThickness} />
              <Button variant="ghost"
                type="button"
                className="flex h-7 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => simulationRef.current?.alpha(1).restart()}
              >
                <WandSparkles className="size-3.5" /> Animate
              </Button>
            </ForceSection>
            <ForceSection title="Forces">
              <GraphSlider label="Centre force" value={centerForce} min={0} max={1} step={0.0000001} onChange={setCenterForce} />
              <GraphSlider label="Repel force" value={repelForce} min={0} max={20} step={0.1} onChange={setRepelForce} />
              <GraphSlider label="Link force" value={linkForce} min={0} max={2} step={0.05} onChange={setLinkForce} />
              <GraphSlider label="Link distance" value={linkDistance} min={30} max={500} step={1} onChange={setLinkDistance} />
            </ForceSection>
          </aside>
        ) : null}
      </section>
  );
  return embedded ? content : (
    <SymtabEditorPane title="Graph view" menuLabel="More options" menuContent={
      <GraphViewMenu bookmarked={bookmarked} onBookmarkChange={onBookmarkChange}
        onCopyScreenshot={copyScreenshot} onSplitRight={onSplitRight} onSplitDown={onSplitDown} />
    }>{content}</SymtabEditorPane>
  );
}
