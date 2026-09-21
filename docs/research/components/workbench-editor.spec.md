# Workbench Editor Specification

## Target file
- `packages/shared-ui/src/components/design-system/workbench/editor-area.tsx`

## Structure
- One or two editor groups, each with a 35px tab strip and flexible editor body.
- Tabs use inactive chrome background and active editor background.
- Empty editor uses a restrained Symtab wordmark and shortcut list.
- Optional bottom panel is deferred; its layout boundary remains compatible with a future horizontal group.

## Exact styles
- Dark editor `#121314`, foreground `#bbbebf`.
- Light editor `#ffffff`, foreground `#202020`.
- Borders `#2a2b2c` dark / `#f0f1f2` light.
- Tab height 35px; font size 12px; editor body font 13px.

## Behavior
- Split button creates a second group.
- Group divider resizes both editors.
- Closing the last tab in a secondary group removes the group.
- Active group owns split/maximize actions and visible focus treatment.
