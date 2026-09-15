import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FluxClient, VaultGraph } from "@flux/bridge-contract";
import type { DemoDocument } from "../editor/markdown-editor";
const emptyDocuments: DemoDocument[] = [];
const GraphView = lazy(() => import("../workspace/graph-view").then((module) => ({ default: module.GraphView })));

export function WorkbenchGraph({ client, vaultId, onOpenDocument, onSplit, onSearchTag }: {
  client: FluxClient;
  vaultId: string;
  onOpenDocument: (path: string) => void;
  onSplit: (placement: "right" | "bottom") => void;
  onSearchTag: (tag: string) => void;
}) {
  const [graph, setGraph] = useState<VaultGraph>();
  const [error, setError] = useState<string>();
  const [bookmarked, setBookmarked] = useState(false);
  const graphRef = useRef<VaultGraph | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let queued = false;
    let refreshTimer: number | undefined;
    const load = async () => {
      if (loading) { queued = true; return; }
      loading = true;
      try {
        const next = await client.getGraph(vaultId);
        if (!cancelled) { graphRef.current = next; setGraph(next); setError(undefined); }
      } catch (cause) {
        if (!cancelled && !graphRef.current)
          setError(cause instanceof Error ? cause.message : "Could not load graph");
      } finally {
        loading = false;
        if (queued && !cancelled) { queued = false; void load(); }
      }
    };
    const scheduleLoad = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(), 200);
    };
    void load();
    const stop = client.watchVaultChanges(vaultId, scheduleLoad);
    return () => { cancelled = true; window.clearTimeout(refreshTimer); stop(); };
  }, [client, vaultId]);
  if (error) return <p role="alert" className="p-4 text-sm text-destructive">{error}</p>;
  if (!graph) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading graph…</p>;
  return <Suspense fallback={<p role="status" className="p-4">Loading graph…</p>}>
    <GraphView embedded documents={emptyDocuments} vaultGraph={graph} bookmarked={bookmarked}
      onBookmarkChange={setBookmarked} onOpenDocument={onOpenDocument}
      onSearchTag={onSearchTag}
      onSplitRight={() => onSplit("right")} onSplitDown={() => onSplit("bottom")} />
  </Suspense>;
}
