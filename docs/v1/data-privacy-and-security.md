# Data, privacy, and security

## Your notes

Vault notes and attachments are ordinary files in the folder you selected. Symtab does not place them in a proprietary document database. Back up that folder with a tool you trust.

Each vault contains a protected `.flux/` directory used for:

- `vault.json` — stable vault identity;
- `config.json` — per-vault settings, including journal configuration;
- `index.db` — a derived SQLite search and graph index;
- `trash/` — recoverable deleted items;
- runtime coordination data.

Do not edit `.flux/` while Symtab is running. The explorer and index intentionally hide it. Deleting `index.db` discards derived search data, not note contents, but should be reserved for troubleshooting with Symtab closed.

## App data

Symtab stores recent-vault records, workspace sessions, and app settings in its application-data directory. On macOS this is normally under `~/Library/Application Support/Symtab/`. Older installations may continue using the legacy app-data directory so existing state is not lost.

## Desktop security boundary

The desktop app starts a bundled Go service bound to the local loopback interface. Electron calls its `/api/v1` routes with a random desktop token. Vault paths are normalized, traversal is rejected, and symlinks that escape the expected path are rejected or omitted.

The graph and search database is derived locally from vault content. Update checks contact the project’s GitHub releases endpoint; downloaded macOS updates are accepted only when asset name, size, and GitHub-provided SHA-256 digest match.

## v1 limits

Symtab v1 does not ship account sync, publishing, AI mode, plugins, or version-control workflows. It also does not replace a backup: Trash expires after 30 days on vault open, and permanent deletion cannot be reversed by Symtab.
