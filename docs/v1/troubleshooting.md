# Troubleshoot Symtab

## Symtab stays on “Connecting to your workspace…”

Quit Symtab completely and reopen it. The desktop app must start its bundled local service before onboarding or vault operations become available. If a development server is running against the same app-data directory, stop it first.

## A vault says it is already in use

Another Symtab process or development server owns the vault’s runtime lock. Close the other process, then reopen the vault. Do not delete lock files while their owner is running.

## A note will not save

Symtab rejects a save when the file changed on disk after it was read. Preserve both versions before resolving the conflict. Also check that the vault and file are writable and still exist at the displayed path.

## A note or attachment is missing from Explorer

- Open Explorer’s `…` menu and select **Refresh Explorer**.
- Select **Show Archive** if the item was archived.
- Select **Open Trash…** if the item was deleted.
- Confirm that its extension is supported. Arbitrary source-code and text files stay on disk but are not listed.
- Expand its parent folder; nested entries load as folders are opened.

## Restore fails

Restore uses the item’s original path. If that path already exists, move or rename the current item and try again. A permanently deleted item or an item removed by 30-day cleanup cannot be restored by Symtab.

## Search, backlinks, tags, or graph results are stale

Wait for the vault indexing notification to finish. External filesystem changes are watched and reconciled, but large vaults can take time. If Symtab reports a degraded index, use the rebuild action in the warning banner. Editing remains available while indexing runs.

## Update check or download fails

Confirm that GitHub is reachable, then retry **Check for Updates…**. Symtab refuses a macOS download when the stable release lacks the exact architecture-specific DMG or a valid GitHub SHA-256 digest. You can still download the matching release manually.

## Before reporting a data-loss issue

Do not empty Trash, delete `.flux/`, or overwrite the vault. Copy the entire vault to a safe location first, including hidden files, then record the failing path and the last action taken.
