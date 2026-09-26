# Create and manage Markdown notes

Use Explorer to manage files and folders in the active vault.

## Create

Open Explorer’s `…` menu and select **New File** or **New Folder**. Folder context menus also let you create items inside that folder.

New file names default to `Untitled.md`. Keep the `.md` extension for an editable Markdown note. If a generated note name already exists, Symtab adds a number instead of overwriting it.

## Edit and save

Select a Markdown file to open it. Choose among:

- **Live Preview** for editing with rendered formatting;
- **Source mode** for the underlying Markdown;
- **Reading view** for rendered content.

Symtab autosaves editor changes after a short delay and uses content hashes to detect conflicting external edits. Closing or switching vaults waits for pending saves; if saving fails, Symtab keeps the window open and reports the error.

## Rename and move

Use a file or folder’s context menu to rename it. Drag an item onto a folder to move it. Symtab updates Markdown and wiki links only when their target resolves unambiguously; ambiguous or unresolved links remain unchanged.

## Delete

Choose **Move to trash** from the item menu. Deleting a folder moves the folder and its contents together. See [Archive and trash](archive-and-trash.md) for recovery and permanent deletion.

## Files shown by Symtab

Symtab indexes Markdown plus common canvas, base, image, audio, video, and PDF formats. Unsupported source-code and text formats remain on disk but are not listed as vault notes. Protected metadata and cache folders such as `.symtab`, `.git`, and `.obsidian` are hidden.
