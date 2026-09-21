# Symtab MCP development

Symtab MCP is a stdio bridge to the same Go daemon used by the open desktop app. Do not start a
second normal server for MCP.

## VS Code

Repository `.vscode/mcp.json` starts:

```sh
go -C server run -tags sqlite_fts5 . mcp \
  --vault /absolute/path/to/vault \
  --client vscode \
  --mode read_only
```

Replace `${workspaceFolder}` in `.vscode/mcp.json` when VS Code workspace is not the vault.
Restart VS Code MCP server after changing config.

Available modes:

- `read_only`: reads and graph tools only.
- `guided_write`: asks client approval before each write; client must support MCP elicitation.
- `trusted_workspace`: permits conflict-checked writes inside selected vault.

Tool names use MCP-safe underscores, for example `flux_read_file` and
`flux_get_graph_neighbors`. Dotted names such as `flux.read_file` are invalid in VS Code.

## Sharing desktop daemon

Desktop app and MCP bridge must use same app-data directory. Default macOS path is:

```text
~/Library/Application Support/Symtab
```

When desktop app uses custom `FLUX_APP_DATA_DIR`, add matching MCP argument:

```sh
--app-data "/absolute/shared/app-data"
```

Bridge reads `<app-data>/runtime/daemon.json`, attaches to healthy daemon, and opens requested
vault in shared runtime. A normal `go run .` cannot open same vault concurrently; runtime lock
correctly rejects it.

## Quick verification

1. Open vault in Symtab.
2. Start `flux` MCP server from VS Code.
3. Confirm tools include `flux_list_vaults`, `flux_list_files`, `flux_read_file`, and graph tools.
4. Call `flux_list_vaults`; use returned `vaultId` for later calls.
5. Call `flux_list_files`, `flux_read_file`, then `flux_get_graph_neighbors`.

If bridge reports vault already open elsewhere, app-data paths differ. If tools are rejected as
invalid names, stale server binary still advertises dotted names; restart MCP process.

## Production target

Current `--vault` configuration is a development/headless override. Desktop production will use
connections created under **Settings → MCP connections**.

Each connection has:

- Display name.
- Opaque connection ID and one-time bearer secret.
- Selected vault IDs.
- Capability grants.
- `read_only`, `guided_write`, or `trusted_workspace` approval mode.
- Revocation and rotation state in the global app database.

Client ID alone is not authentication. Generated VS Code, Codex, and Claude configurations invoke
the packaged `flux-server mcp` binary with connection credentials. `flux_list_vaults` lists saved
grants, and every later tool call supplies an explicit `vaultId`; the bridge has no mutable global
active vault.

Packaged users never install Go. Symtab discovers the bundled sidecar path from its running
installation and copies a platform-correct configuration. This section describes the production
target and must not be used as evidence that connection UI or config generation is implemented.
