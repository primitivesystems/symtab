![Contributing Guidelines](.github/workflows/contributing.png)

Thank you for your interest in contributing to SYMTAB! This document provides guidelines for contributing to the project.

---

## Important

- If an issue is assigned to you, please complete it **before requesting another one**.
- A person can be assigned a **maximum of two issues** at a time to ensure fair distribution among all participants.

## ⭐ Before You Start

1. **Starring the repository is mandatory** before contributing.  
   This helps the project grow and shows your support.

2. **Join our Discord server** for discussions, questions, and faster PR approvals:  
   👉 [Join the Discord Server](https://discord.gg/dQUh6SY9Uk)

   ⚠️ **Please note:** To quickly get your PRs reviewed and merged, you must be a member of our Discord server.

3. **Pull Request Policy on Discord**
   - Before raising a PR, **check the `#pull-request` channel** to ensure there isn't already an open PR for the same issue.
   - If no one is working on it, go ahead and raise your PR and mention it in the channel.

---

## Keeping Your Branch Up-to-Date

Please ensure your local branch is **synced with the latest `develop` branch** before making changes or opening a Pull Request (PR).

This helps avoid unnecessary merge conflicts and ensures a smooth review process.

⚠️ **Note:**

- 🚀 Please raise PRs **only to the `develop` branch**.
- 📷 For faster reviews and merges, include a **recording or screenshot** (depending on the issue) that demonstrates the fix.
- 🏗️ Before opening a PR, run the appropriate build command and ensure the project builds successfully **without errors**.
- ✅ Only raise a PR once the build passes.
- 🔗 When raising the PR, please **reference the issue number** it addresses.

## Merge Conflicts

- Project maintainers are **not responsible** if your PR is blocked due to merge conflicts.
- It is **your responsibility** to update your branch and resolve conflicts before requesting a merge.

---

## Getting Started

1. Fork the repository.
2. Clone your fork locally.
3. Navigate to the SYMTAB directory.
4. Install the required dependencies.
5. Follow the development setup instructions below.
6. Create a new branch for your feature or fix.

---

## Development Setup

Make sure the following tools are installed before starting development:

- Bun
- Go
- Node.js (if required by the development environment)
- Git
- Docker (required for Docker-based backend development)

### Install Dependencies

1. **Navigate to the SYMTAB directory**

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

After installing the backend dependencies, return to the SYMTAB root directory when running the application commands:

```bash
cd ..
```

---

## Running the Application

### Desktop Application (Development)

From the SYMTAB root directory:

```bash
# Default development target
bun run dev
```

This starts the SYMTAB desktop development environment.

### Web Application (Development)

From the SYMTAB root directory:

```bash
bun run dev:web
```

This starts the SYMTAB web application in development mode.

### Backend Server (Local)

The backend server can optionally use a specific vault whose derived index is stored in:

```text
<vault>/.symtab/index.db
```

Set the vault path using:

```bash
export SYMTAB_VAULT_PATH="/path/to/your/vault"
```

Then start the backend server:

```bash
bun run dev:server
```

### Backend Server (Docker)

Navigate to the server directory:

```bash
cd server
```

Start the backend using Docker Compose:

```bash
docker compose up
```

The backend will be available at:

```text
http://localhost:8080
```

---

## Building

### Desktop Application

From the SYMTAB root directory:

```bash
bun run build --filter=@symtab/desktop
```

The desktop build compiles the Go backend and ships it as one app-scoped sidecar process.

### Web Application

From the SYMTAB root directory:

```bash
bun run build --filter=@symtab/web
```

Before submitting a Pull Request, make sure the appropriate build completes successfully without errors.

---

## Code Style

When contributing to SYMTAB:

- Follow the existing **React and TypeScript patterns** used throughout the project.
- Follow the existing **Go conventions** when working on the backend.
- Use meaningful variable, function, component, and file names.
- Keep components focused and reusable.
- Reuse existing components and utilities where possible.
- Follow the existing Tailwind CSS patterns used in the project.
- Use the existing Radix UI components and patterns where applicable.
- Avoid introducing unnecessary dependencies.
- Add comments only when they help explain complex or non-obvious logic.
- Keep the code clean, readable, and maintainable.
- Maintain consistency with the existing project architecture.
- Keep shared application logic in `packages/app-core` when it is intended to be reused across desktop and web.
- Ensure changes do not unnecessarily break either the desktop or web application.

---

## Testing Your Changes

Before submitting a Pull Request, make sure your changes have been properly tested.

### General Testing

1. Test the functionality you changed.
2. Verify that existing functionality continues to work.
3. Test relevant edge cases.
4. Check the application for console errors.
5. Verify that the UI behaves correctly on different screen sizes where applicable.

### Desktop Testing

If your changes affect the desktop application:

1. Run the desktop application locally.
2. Verify the affected functionality.
3. Check Electron-specific behavior where applicable.
4. Make sure the application starts and builds successfully.

### Web Testing

If your changes affect the web application:

1. Run the web application locally.
2. Verify the affected functionality.
3. Test relevant navigation and UI behavior.
4. Check responsive behavior where applicable.
5. Make sure the web application builds successfully.

### Backend Testing

If your changes affect the Go backend:

1. Start the local backend server.
2. Test the affected API or functionality.
3. Verify database-related behavior where applicable.
4. Test relevant error and edge cases.
5. If using Docker, verify that the backend starts successfully with Docker Compose.

### Build Verification

Before creating a Pull Request, run the appropriate build command.

For the desktop application:

```bash
bun run build --filter=@symtab/desktop
```

For the web application:

```bash
bun run build --filter=@symtab/web
```

Make sure the build completes successfully without errors.

---

## Submitting Changes

1. Make sure your branch is up to date with the latest `develop` branch.
2. Test your changes thoroughly.
3. Run the appropriate build command.
4. Commit your changes with clear and descriptive commit messages.
5. Push your branch to your fork.
6. Check the Discord `#pull-request` channel to make sure another PR does not already address the same issue.
7. Create a Pull Request targeting the **`develop` branch**.
8. Your Pull Request should include:
   - A clear description of the changes.
   - The issue number being addressed.
   - Screenshots or videos for UI-related changes.
   - Testing details and results.
9. Resolve any merge conflicts before requesting a review.
10. Mention the Pull Request in the appropriate Discord channel after submitting it.

---
## Areas for Contribution

We welcome contributions in the following areas:

- UI/UX improvements
- Note management
- Editor improvements
- Sidebar and navigation improvements
- Workspace improvements
- Desktop application improvements
- Web application improvements
- Performance optimizations
- Backend and API improvements
- Database and indexing improvements
- Cross-platform functionality
- Plugin system improvements
- AI and MCP-related features
- Graph, canvas, and multi-view features
- Vim mode improvements
- Publishing and web-related features
- Accessibility improvements
- Responsive design
- Documentation updates
- Bug fixes
- New features
- Code quality and refactoring
- Testing improvements

If you are unsure whether your idea would be useful, feel free to discuss it with the maintainers before starting development.

---

## Questions?

If you have any questions about contributing to SYMTAB:

- Join our [Discord Server](https://discord.gg/dQUh6SY9Uk) for discussions and faster communication.
- Check existing issues and Pull Requests before creating a new one.
- Check the project documentation and README for existing setup instructions.
- Feel free to open an issue for questions or discussion about potential contributions.

Thank you for contributing to SYMTAB! ❤️