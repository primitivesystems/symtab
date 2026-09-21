# Symtab UI revamp implementation map

This map identifies where the approved appearance spec should land. It is not an implementation.

## 1. Change boundary

Safe to change:

- theme tokens
- font roles
- shared primitive styling
- surface wrappers inside existing footprints
- class names controlling visual state
- motion timings/easing
- icon size/stroke
- editor presentation

Do not change:

- component ownership
- application state
- workspace tree
- saved layout state
- pane dimensions
- resize math
- tab commands
- keyboard behavior
- data loading
- plugin placement

## 2. File map

| Priority | File                                                  | Responsibility                    | Planned appearance work                                        |
| -------- | ----------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| P0       | `packages/shared-ui/src/styles/globals.css`           | tokens, base, editor, print       | split ownership; install new light/dark role tokens            |
| P0       | `packages/shared-ui/src/components/flux-layout.tsx`   | shell grid and pane wrappers      | preserve geometry; add window-well and inset-surface classes   |
| P0       | `packages/shared-ui/src/components/flux-tabs.tsx`     | titlebar tabs                     | contained active tab; zero-bounce motion; shared state styling |
| P0       | `packages/shared-ui/src/components/workspace-tab.tsx` | editor pane header and tab menus  | header polish; migrate repeated menu styling                   |
| P0       | `packages/app-core/src/workspace-sidebars.tsx`        | ribbon and sidebars               | selected/hover states, toolbars, row density, icon stroke      |
| P0       | `packages/app-core/src/vault-explorer.tsx`            | file tree                         | row states, guides, toolbar, preview surface                   |
| P0       | `packages/app-core/src/markdown-editor.tsx`           | editor and document presentation  | typography roles, selection, headings, inline surfaces         |
| P0       | `packages/shared-ui/src/components/status-bar.tsx`    | bottom status chrome              | grouping, separators, utility typography                       |
| P1       | `packages/app-core/src/settings-dialog.tsx`           | settings UI                       | shared fields/switches/cards; remove `transition-all`          |
| P1       | `packages/app-core/src/App.tsx`                       | banners, modals, workspace leaves | named surface/elevation tokens; keep render tree unchanged     |
| P1       | `packages/app-core/src/graph-view.tsx`                | graph controls                    | floating control surface and menu consistency                  |
| P1       | `packages/app-core/src/pdf-viewer.tsx`                | PDF toolbar                       | control-state consistency                                      |
| P1       | `packages/app-core/src/browser-view.tsx`              | browser toolbar                   | replace one-off control styling                                |
| P1       | `packages/app-core/src/file-preview.tsx`              | media preview                     | neutral image outline and surface treatment                    |
| P2       | `packages/shared-ui/src/components/mode-toggle.tsx`   | theme switch                      | contextual icon state and reduced motion                       |
| P2       | `packages/shared-ui/src/components/tooltip.tsx`       | tooltip                           | Base UI/COSS behavior and compact elevation                    |
| P2       | `packages/shared-ui/src/components/sonner.tsx`        | notifications                     | token and elevation alignment                                  |

## 3. Existing geometry anchors

Implementation must preserve:

- `flux-layout-root` grid rows: `44px minmax(0,1fr) 28px`
- sticky rail column
- left and right grid tracks calculated in `FluxLayout`
- zero-width resize-track math
- `leftSidebarOptions`: 260 default, 200 min, 480 max
- `rightSidebarOptions`: 280 default, 220 min, 480 max
- editor `max-w-[760px]`
- tab `w-52` / 208px maximum
- editor pane header `h-9`
- workspace leaf titlebar `h-11`

Inset working surfaces must be achieved inside these tracks, not by changing them.

## 4. Repeated primitives to consolidate

### Icon button

Repeated across:

- titlebar
- sidebar headers
- ribbon
- file explorer
- editor pane header
- graph toolbar
- PDF toolbar
- status bar

Needed variants:

- quiet
- selected
- danger
- toolbar
- static/no press motion

### Menu

Repeated class constants exist in:

- `flux-tabs.tsx`
- `workspace-tab.tsx`
- `vault-explorer.tsx`
- `markdown-editor.tsx`
- status bar and other feature files

Create one shared Base UI/COSS-derived menu family before retheming individual menus.

### Fields

Repeated input/select/number styles occur heavily in `settings-dialog.tsx` and feature dialogs.
Create shared Input, Select, NumberField, Field, and Button primitives first.

### Dialog surface

Multiple dialogs use local `rounded-xl border ... shadow-2xl`. Replace with named shared dialog
surface and elevation tokens.

## 5. Recommended implementation order

### Phase 0 — visual baselines

- capture current light/dark shell
- capture minimum/maximum sidebar widths
- capture split and stacked states
- record active/inactive window behavior

No styling changes.

### Phase 1 — tokens and font roles

- create token files
- keep current values behind compatibility aliases
- add role variables
- verify no visual regression

### Phase 2 — shared primitives

- introduce selected COSS/Base UI components
- migrate Tooltip, Menu, Dialog, Button, Field, Switch
- preserve current public component APIs where practical

### Phase 3 — shell appearance

- apply window well
- inset left/main/right working surfaces inside current tracks
- update active/inactive window states
- update resize handle appearance
- verify no geometry/persistence regression

### Phase 4 — chrome

- update tab treatment
- update rail states
- update sidebars and status bar
- remove non-zero bounce

### Phase 5 — editor and content

- apply font roles
- rebalance headings
- update selection, inline code, callouts, embeds, tables, and images
- verify editor/live/read parity

### Phase 6 — secondary surfaces

- settings
- plugin manager
- graph controls
- PDF/browser/media toolbars
- all dialogs, menus, popovers, tooltips, and toasts

### Phase 7 — stress verification

Run full matrix from the visual specification. Fix systemically, not with per-screen exceptions.

## 6. Known cleanup targets

- `settings-dialog.tsx` uses `transition-all` on the toggle thumb
- tab layout springs use bounce `0.06`
- stacked workspace layout spring uses bounce `0.04`
- dialog/popover surfaces overuse `shadow-2xl`
- border/radius values are repeated instead of tokenized
- global CSS combines unrelated responsibilities
- several toolbar buttons omit an explicit focus treatment
- current selected state is a standalone hardcoded `.bg-sidebar-selected`

These are implementation targets, not authorization to change code yet.

## 7. Review gates

Stop for review after each:

1. light/dark tokens
2. one representative menu/dialog/field set
3. shell surface treatment
4. tabs + rail + sidebars
5. editor typography
6. secondary surfaces

Do not run a whole-app mechanical replacement without visual review.
