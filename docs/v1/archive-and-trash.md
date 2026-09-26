# Archive and trash

Archive and Trash serve different purposes.

## Archive

Archive keeps an item in the live vault but moves it under `archive/`, preserving its previous relative path. For example, `Projects/Plan.md` becomes `archive/Projects/Plan.md`.

To archive a file or folder, open its Explorer menu and choose **Archive**. Archive is hidden in Explorer by default. Open Explorer’s `…` menu and select **Show Archive** to reveal it; select **Hide Archive** to hide it again.

Archived notes remain ordinary vault files and can still participate in indexing, search, and links. Move an archived item out of `archive/` to return it to the main file tree.

## Trash

Deleting an item moves it into protected `.symtab/trash/` storage with its original path and deletion time. It is removed from the normal file tree but remains recoverable.

Open Explorer’s `…` menu and select **Open Trash…**. In Trash you can:

- filter entries by original path;
- restore one entry;
- permanently delete one entry;
- empty the entire Trash.

Restore returns an item to its original path and recreates missing parent folders. Restore fails if another item already exists at that path; rename or move the conflicting item, then retry.

## Permanent deletion and retention

**Delete permanently** and **Empty trash** cannot be undone by Symtab. Confirm the action only after checking the selected item or item count.

Symtab automatically removes trash entries older than 30 days when the vault opens. Keep a separate backup for recovery beyond that period.
