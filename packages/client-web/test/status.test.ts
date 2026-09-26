import { expect, mock, test } from "bun:test";
import { WebSymtabClient } from "../src";

test("uses canonical status route", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () =>
    Response.json({
      status: "healthy",
      version: "0.0.1",
      vaultConfigured: false,
      openVault: null,
    })
  );
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const client = new WebSymtabClient();
    await client.getStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/status", {
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handles confirmed permanent deletion with an empty response", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const client = new WebSymtabClient();
    await expect(client.permanentlyDelete("vault/id", "trash/id")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/vaults/vault%2Fid/trash/trash%2Fid?confirm=true",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads watcher revision", async () => {
  const fetchMock = mock(async () => Response.json({ revision: 7 }));
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.getVaultRevision("vault/id")).resolves.toBe(7);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/vaults/vault%2Fid/revision", {
    headers: { "Content-Type": "application/json" },
  });
});

test("reads raw binary file", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const fetchMock = mock(async () => new Response(bytes));
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  const result = new Uint8Array(await client.readBinaryFile("vault/id", "folder/test.pdf"));
  expect(result).toEqual(bytes);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/vaults/vault%2Fid/files/raw?path=folder%2Ftest.pdf"
  );
});

test("loads and saves durable workspace state", async () => {
  const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    return Response.json({
      windowId: "main",
      vaultId: "vault/id",
      state: { tabs: [{ path: "notes/a.md" }] },
      updatedAt: "2026-07-21T00:00:00Z",
    });
  });
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.getWorkspace("main", "vault/id")).resolves.toMatchObject({
    vaultId: "vault/id",
  });
  await client.saveWorkspace("main", "vault/id", { activePath: "notes/a.md" });

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/v1/workspace-sessions/main?vaultId=vault%2Fid",
    { headers: { "Content-Type": "application/json" } }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/workspace-sessions/main", {
    method: "PUT",
    body: JSON.stringify({ vaultId: "vault/id", state: { activePath: "notes/a.md" } }),
    headers: { "Content-Type": "application/json" },
  });
});

test("loads and saves protected per-vault config", async () => {
  const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response(null, { status: 204 })
      : Response.json({ dailyFolder: "Journal" })
  );
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.getVaultConfig("vault/id")).resolves.toEqual({ dailyFolder: "Journal" });
  await client.putVaultConfig("vault/id", { dailyFolder: "Daily" });
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/vaults/vault%2Fid/config", {
    method: "PUT",
    body: JSON.stringify({ dailyFolder: "Daily" }),
    headers: { "Content-Type": "application/json" },
  });
});

test("discovers vaults registered inside the server storage root", async () => {
  const fetchMock = mock(async () =>
    Response.json([{ vaultId: "vault/id", name: "Notes", path: "Notes" }])
  );
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.listAvailableVaults()).resolves.toEqual([
    { vaultId: "vault/id", name: "Notes", path: "Notes" },
  ]);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/vaults/available", {
    headers: { "Content-Type": "application/json" },
  });
});

test("requests an explicit derived-index rebuild", async () => {
  const fetchMock = mock(async () => Response.json({ accepted: true }, { status: 202 }));
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await client.rebuildIndex("vault/id");
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/vaults/vault%2Fid/index/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
});

test("loads path-keyed vault graph", async () => {
  const graph = {
    nodes: [{ id: "one/route.ts", path: "one/route.ts", label: "one/route.ts", kind: "text" }],
    edges: [],
  };
  const fetchMock = mock(async () => Response.json(graph));
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.getGraph("vault/id")).resolves.toEqual(graph);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/vaults/vault%2Fid/graph", {
    headers: { "Content-Type": "application/json" },
  });
});

test("queries indexed sidebar data", async () => {
  const fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/search?")) {
      return Response.json([{ path: "notes/a.md", title: "a.md", excerpt: "matching text" }]);
    }
    if (url.includes("/references?")) {
      return Response.json({ linked: [], unlinked: [], outgoing: ["notes/b.md"] });
    }
    return Response.json({ tags: [{ name: "symtab", count: 2 }], properties: [] });
  });
  const client = new WebSymtabClient("/api/v1", fetchMock as typeof fetch);

  await client.searchVault("vault/id", "tag:symtab", 25);
  await client.getDocumentReferences("vault/id", "notes/a.md");
  await client.getDocumentReferences("vault/id", "notes/a.md", true);
  await client.getVaultFacets("vault/id");

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/v1/vaults/vault%2Fid/search?q=tag%3Asymtab&limit=25&offset=0&matchCase=false",
    { headers: { "Content-Type": "application/json" } }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/v1/vaults/vault%2Fid/references?path=notes%2Fa.md",
    { headers: { "Content-Type": "application/json" } }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "/api/v1/vaults/vault%2Fid/references?path=notes%2Fa.md&includeUnlinked=true",
    { headers: { "Content-Type": "application/json" } }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/v1/vaults/vault%2Fid/facets", {
    headers: { "Content-Type": "application/json" },
  });
});
