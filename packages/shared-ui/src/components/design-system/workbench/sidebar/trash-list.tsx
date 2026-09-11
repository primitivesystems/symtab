import { useEffect, useState } from "react";
import { Button } from "../../../ui/button";

type TrashItem = { id: string; originalPath: string; deletedAt: string };

export function TrashList({
  load,
  restore,
}: {
  load?: () => Promise<TrashItem[]>;
  restore?: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (load?.() ?? Promise.resolve([]))
      .then(
        (items) => {
          if (!cancelled) setItems(items);
        },
        (error) => {
          if (!cancelled) setError(String(error));
        }
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);
  return (
    <section aria-label="Trash" className="px-2 text-xs">
      {error && (
        <p role="alert" className="py-2 text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-3 text-muted-foreground">
          Loading Trash…
        </p>
      ) : !items.length ? (
        <p className="py-3 text-muted-foreground">Trash is empty.</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 py-1">
            <span
              className="min-w-0 flex-1 truncate"
              title={`${item.originalPath} · Deleted ${item.deletedAt}`}
            >
              {item.originalPath}
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={!restore || Boolean(busy)}
              onClick={async () => {
                setBusy(item.id);
                setError("");
                try {
                  await restore?.(item.id);
                  setItems((items) => items.filter((entry) => entry.id !== item.id));
                } catch (error) {
                  setError(String(error));
                } finally {
                  setBusy(undefined);
                }
              }}
            >
              Restore
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
