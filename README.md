<p align="center">
  <picture>
  <img alt="Project Banner" src=".github/assets/wordmark.svg">
</picture>

</p>

<p align="center">
  Personal Knowledge Management for your ideas, notes, and knowledge.
</p>

<p align="center">
  <a href="CONTRIBUTING.md"><strong>Contributing Guidelines</strong></a>
  ✦
  <a href="../../releases"><strong>Releases</strong></a>
  ✦
  <a href="CODE_OF_CONDUCT.md"><strong>Code Of Conduct</strong></a>
</p>

<div align="center">

<a href="https://bun.sh/"><img alt="Bun" src="https://www.shieldcn.dev/badge/Package_mgr-Bun-000000.svg?logo=bun&variant=branded&size=sm&mode=light" height="22"></a>
&nbsp;
<a href="https://eslint.org/"><img alt="ESLint" src="https://www.shieldcn.dev/badge/Lint-ESLint-4B32C3.svg?logo=eslint&variant=branded&size=sm&mode=light" height="22"></a>
&nbsp;
<a href="https://prettier.io/"><img alt="Prettier" src="https://www.shieldcn.dev/badge/Format-Prettier-F7B93E.svg?logo=prettier&variant=branded&size=sm&mode=light" height="22"></a>
&nbsp;
<a href="https://turbo.build/"><img alt="Turborepo" src="https://www.shieldcn.dev/badge/Monorepo-Turborepo-EF4444.svg?logo=turborepo&variant=branded&size=sm&mode=light" height="22"></a>

</div>

Symtab is a cross-platform Personal Knowledge Management (PKM) tool designed to help you organize, connect, and manage your knowledge across desktop and web.

## Tech Stack

### Frontend

- **Framework**: React 19 + Vite 8
- **Desktop Runtime**: Electron
- **Web Runtime**: Vite + PWA
- **Styling**: Tailwind CSS 4 + Radix UI
- **Package Manager**: Bun
- **Build Tool**: Turborepo

### Backend

- **Language**: Go
- **Web Framework**: Gin
- **ORM**: GORM
- **Database**: Per-vault SQLite (derived state under `.symtab/index.db`)
- **Deployment**: Docker

## Monorepo Architecture

Symtab uses a single monorepo with one shared product UI and multiple thin runtime shells:

```text
symtab/
├── apps/
│   ├── desktop/           # Electron shell, preload, updater, packaging
│   └── web/               # Vite/PWA shell and HTTP bridge
├── server/                # Go server for self-hosted and hosted deployments
├── packages/
│   ├── app-core/          # Shared React application and renderer logic
│   ├── bridge-contract/   # Typed runtime contract between UI and host
│   ├── client-desktop/    # Electron IPC implementation of the contract
│   ├── client-web/        # HTTP implementation of the contract
│   ├── shared-domain/     # Shared types and note/task/view models
│   └── shared-ui/         # Reusable UI primitives
├── tooling/
│   └── scripts/            # Shared tooling hooks and migration scripts
└── docs/                  # Documentation
```

### Architecture Principles

- **`packages/app-core`** is the source of truth for user-facing features.
- **`packages/shared-ui`** owns reusable components and the shared Tailwind theme.
- Platform-specific code stays in the app shells:
  - `apps/desktop` for Electron-only concerns (windows, menus, updater, packaging)
  - `apps/web` for browser/PWA bootstrapping
  - `server` for HTTP/WebSocket serving, vault access, and deployment config
- The shared UI depends on the typed bridge in `packages/bridge-contract`.

### Deployment Modes

Symtab ships as:

- **Desktop**: `apps/desktop` - Electron application with auto-updater
- **Self-hosted**: `apps/web` + `server` - Docker-based deployment
- **Hosted**: Same web stack with auth/storage additions

## Getting Started

### Prerequisites

- **Node.js**: >= 20.19.0 or >= 22.12.0
- **Bun**: Latest version
- **Go**: 1.25 or higher
- **Docker**: Optional, for containerized backend development

### Installation

1. **Navigate to the symtab directory**

   ```bash
   cd symtab
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Set up the backend**

   ```bash
   cd server
   go mod download
   ```

### Running the Application

#### Desktop Application (Development)

```bash
# From symtab root (the default development target)
bun run dev
```

#### Web Application (Development)

```bash
# From symtab root
bun run dev:web
```

The web app will be available at `http://localhost:3000`.

#### Backend Server (Local)

```bash
# Optionally select the vault whose derived index is stored in <vault>/.symtab/index.db.
export SYMTAB_VAULT_PATH="/path/to/your/vault"

bun run dev:server
```

When omitted, `bun run dev:server` starts without opening a vault. Localhost clients may then open any user-selected directory through `POST /api/v1/vaults/open`. Production requires a configured vault path. No database service is required for local development.

#### Backend Server (Docker)

```bash
cd server
docker compose up
```

The backend will be available at `http://localhost:8080`.

### Building

#### Desktop Application

```bash
bun run build --filter=@symtab/desktop
```

The desktop build compiles the Go backend and ships it as one app-scoped sidecar process.

#### Web Application

```bash
bun run build --filter=@symtab/web
```

## Development

### Available Scripts

- `bun run dev` - Run the Electron desktop app
- `bun run dev:all` - Run desktop and web shells together
- `bun run dev:web` - Run only the browser shell
- `bun run dev:server` - Run the Go backend
- `bun run build` - Build all packages
- `bun run lint` - Lint all packages
- `bun run clean` - Clean build artifacts

Vite dependency optimization caches are stored under `.cache/vite` at the repository root. The app workspaces do not maintain separate dependency installations; `bun install` owns the single root `node_modules` tree.

Developer guides:

- [Symtab MCP with VS Code](docs/mcp-development.md)
- [External plugin development](docs/plugin-development.md)

### Package Structure

#### `packages/app-core`

Contains the shared React application and layout that runs in both desktop and web environments. Product screens belong here; the app shells only provide runtime adapters.

#### `packages/bridge-contract`

Defines the typed interface between the shared UI and platform-specific runtimes. This ensures consistent behavior across desktop and web.

#### `packages/shared-domain`

Contains shared types, constants, and domain models used across the application.

#### `packages/shared-ui`

Reusable components and the shared Tailwind CSS theme.

### API Endpoints

The backend currently provides the first transport-neutral vault/file slice:

- `GET /health` - Health and vault status
- `GET /api/v1/status` - Runtime status
- `POST /api/v1/vaults/open` - Open or switch to a vault
- `POST /api/v1/vaults/create` - Initialize and open a new vault
- `GET /api/v1/vaults/:vaultId/files` - List canonical files and directories
- `POST /api/v1/vaults/:vaultId/directories` - Create a directory
- `POST /api/v1/vaults/:vaultId/files` - Create a file
- `DELETE /api/v1/vaults/:vaultId/files?path=...` - Move a file or directory to trash
- `GET /api/v1/vaults/:vaultId/files/content?path=...` - Read a file
- `PUT /api/v1/vaults/:vaultId/files/content` - Atomically replace file content
- `PATCH /api/v1/vaults/:vaultId/files/content` - Apply hash-guarded UTF-8 byte edits
- `POST /api/v1/vaults/:vaultId/files/move` - Move or rename a file or directory
- `POST /api/v1/vaults/:vaultId/files/restore` - Restore a trashed item
- `GET /api/v1/vaults/:vaultId/trash` - List trash entries and their sizes
- `DELETE /api/v1/vaults/:vaultId/trash?olderThanDays=30&confirm=true` - Purge entries older than 7, 30, or 90 days
- `DELETE /api/v1/vaults/:vaultId/trash/:trashId?confirm=true` - Permanently delete one trash entry

Opening a vault starts one recursive filesystem watcher and a periodic reconciliation scan. Moves rewrite only wiki/Markdown links that resolve unambiguously by exact vault path, relative path, or a unique filename; unresolved and ambiguous links are left untouched. Trash defaults to 30-day retention when a vault opens.

## Architecture

### Monorepo Management

This project uses Turborepo for efficient monorepo management with Bun as the package manager. This provides:

- Fast builds with caching
- Parallel task execution
- Shared dependencies
- Consistent tooling

### Desktop Application

The Electron app is structured with:

- **Main Process**: Owns one bundled Go sidecar, native directory selection, and auto-updater
- **Preload Script**: Exposes a narrow typed IPC transport; renderer code has no direct filesystem access
- **Renderer Process**: Loads the shared app-core React application

### Web Application

The web app is a Vite + PWA application that:

- Loads the shared app-core React application
- Provides HTTP bridge to communicate with the backend server
- Supports offline functionality via PWA

### Backend

The Go backend follows a clean architecture:

- **Models**: Database entities
- **Handlers**: Request/response logic
- **API**: Route definitions
- **Config**: Configuration management
- **Database**: Database connection and setup

## Deployment

### Backend (Docker)

```bash
cd server
docker-compose up -d
```

### Desktop Application

Build the application for your platform:

```bash
cd apps/desktop
bun run build
```

The output will be in the `dist/` directory.

### Web Application

Build the web application:

```bash
cd apps/web
bun run build
```

The output will be in the `dist/` directory and can be deployed to any static hosting service.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](https://github.com/primitivesystems/symtab/blob/main/License.md) file for details.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Roadmap

- [ ] Full note editing with markdown support
- [ ] Graph view for knowledge visualization
- [ ] Tag system and filtering
- [ ] Search functionality
- [ ] Workspace management
- [ ] Cloud sync
- [ ] Mobile application
- [ ] Plugin system

[hello](https://www.github.com/wizaye)
