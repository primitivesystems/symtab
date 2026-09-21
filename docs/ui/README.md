# Symtab UI appearance revamp

Status: **proposal only — no UI implementation performed**

This folder freezes the visual direction for the `codex/ui-revamp` branch before implementation
starts.

## Decision

Keep the current Symtab shell and interaction model intact:

- 44px integrated title/tab bar
- 48px workspace rail
- resizable left sidebar
- tabbed and split main workspace
- resizable right sidebar
- 28px status bar
- current collapse, resize, stack, drag, split, and navigation behavior

Change only appearance:

- colors and surface hierarchy
- typography
- panel insets and radii inside existing footprints
- tab and selected-row treatment
- borders, shadows, and elevation
- icon consistency
- hover, focus, pressed, loading, active-window, and reduced-motion states

The target is a quiet, native-feeling professional tool: closer in craft to Codex, Cursor, and the
provided inset-shell reference, without copying their layouts or changing Symtab's information
architecture.

## Documents

- [Visual refresh specification](./visual-refresh-spec.md)
- [Implementation map](./implementation-map.md)

## Research note

Computer Use was attempted against the live Codex desktop app by both display name and bundle ID.
The platform blocks inspection of `com.openai.codex` for safety reasons. Analysis therefore uses:

- both user-provided Codex screenshots
- both user-provided inset-shell/editor screenshots
- live browser inspection of COSS UI and Cursor
- a live local render of Symtab in light and dark mode at 1280×720
- direct inspection of Symtab shell, tabs, sidebars, editor, status bar, dialogs, and token code

## Hard stop

Review these documents before any component, CSS, dependency, or layout implementation begins.
