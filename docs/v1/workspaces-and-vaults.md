# Work with vaults

A **workspace** is the Symtab window and layout you work in. A **vault** is the folder containing its notes and attachments. In the desktop app, a newly created workspace uses a new vault folder with the same name.

## Open or create a vault

Use **File → Open or Create Vault…** or press `Command+O` on macOS (`Ctrl+O` on Windows and Linux). You can also open the Explorer `…` menu and select **Manage Vaults…**.

The Vaults dialog lets you:

- create a vault in a folder;
- open an existing folder;
- switch among available and recent vaults;
- search the vault list;
- remove an inactive vault from the recent list.

Removing a vault from the recent list does not delete its folder or notes.

## What Symtab remembers

Symtab remembers recent vaults, open tabs, editor groups, the active layout, and app settings. Before switching vaults or closing a window, it attempts to save pending note changes.

Only one Symtab backend process can own a vault at a time. If a vault reports that it is in use, close the other Symtab instance or development server that has it open, then try again.
