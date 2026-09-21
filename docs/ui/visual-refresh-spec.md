# Symtab visual refresh specification

## 1. Executive decision

Symtab keeps its existing shell layout. The revamp is a skin and component-quality pass, not an
information-architecture redesign.

Working name for the visual direction: **Quiet Instrument**.

Symtab should feel like a focused desktop instrument:

- calm at rest
- precise under interaction
- dense enough for professional work
- warm enough to avoid sterile SaaS styling
- distinct from Obsidian's edge-to-edge pane grid
- not visibly assembled from stock shadcn defaults

The single aesthetic risk is an **inset surface system**: existing sidebar and workspace footprints
remain unchanged, but their visible working surfaces sit inside a subtle window well. This creates
native depth without cards, gradients, or decorative chrome.

## 2. Layout contract: do not change

The following geometry and behavior are frozen for this revamp.

| Area               | Current contract                           | Revamp rule                       |
| ------------------ | ------------------------------------------ | --------------------------------- |
| Window shell       | `h-svh`, full-window application           | Keep                              |
| Title/tab bar      | 44px                                       | Keep footprint and drag behavior  |
| Workspace rail     | 48px                                       | Keep footprint and order          |
| Left sidebar       | 260px default; 200–480px                   | Keep resize/collapse behavior     |
| Main workspace     | flexible; supports splits and stacked tabs | Keep tree and pane behavior       |
| Right sidebar      | 280px default; 220–480px                   | Keep resize/collapse behavior     |
| Status bar         | 28px                                       | Keep footprint and content        |
| Editor measure     | 760px max content width                    | Keep                              |
| Editor pane header | 36px                                       | Keep                              |
| Active tabs        | up to 208px                                | Keep tab sizing and drag behavior |

Do not:

- move commands between regions
- replace sidebars with drawers
- remove status bar
- change rail, sidebar, or pane order
- turn the editor into a dashboard
- merge chat/agent UI into the editor
- rewrite split-pane or stacked-tab behavior
- introduce responsive mobile navigation in this pass

Appearance may inset a surface by 4px inside its existing grid footprint. It must not change the grid
tracks, resize constraints, collapse thresholds, or persisted layout state.

## 3. What the references contribute

### Inset light editor reference

Borrow:

- full-window neutral well behind content
- rounded left working surface
- rounded main working surface
- quiet icon rail
- selected rows as soft fills, not outlines
- active tab as a contained surface
- native-density spacing

Do not borrow:

- IDE-specific file icons or syntax palette
- oversized search field
- update/account controls
- editor semantics
- exact corner radii or window chrome

### Codex dark conversation reference

Borrow:

- near-black, low-chroma dark theme
- strong reading measure
- large uninterrupted content field
- restrained floating composer treatment as elevation reference
- muted secondary metadata
- tab strip integrated into window chrome
- one elevated boundary around the active control surface

Do not borrow:

- conversation layout
- model branding
- message bubbles
- branch/checkout controls
- large empty gutters where Symtab needs sidebars

### Earlier dashboard and multi-pane references

Borrow only appearance signals:

- quiet white/neutral surfaces
- hairline structural separation
- compact headers
- large content-first center
- controlled use of rounded containers

Do not copy their dashboard or three-column layout. Symtab already has its own shell.

### COSS UI

Use COSS as a component and interaction foundation:

- direct Base UI primitives
- accessible behavior
- component source owned in-repository
- consistent state APIs

Do not adopt COSS branding, font, site composition, or default theme unchanged. COSS styling also
uses a shadcn-like CSS-variable model; Symtab must own its token contract.

## 4. Current Symtab diagnosis

Live Symtab inspection at 1280×720 shows the structure works. Main visual issues:

1. **Every layer is edge-to-edge.** Titlebar, rail, both sidebars, editor, and status bar meet through
   hairlines. This creates the same pane-grid silhouette associated with Obsidian.
2. **Surface hierarchy is nearly flat.** In light mode, `background`, `sidebar`, and chrome are close
   neutrals. In dark mode, pane boundaries depend heavily on separators.
3. **Selected states are generic gray pills.** They work, but do not establish a Symtab identity.
4. **Tabs use a browser-tab merge treatment.** Active tabs attach to the document surface. References
   favor a quiet contained tab inside chrome.
5. **Radius usage is broad, not systematic.** Current source contains 144 `rounded-md`, 22
   `rounded-lg`, 13 `rounded-xl`, plus local arbitrary values.
6. **Elevation is inconsistent.** 14 `shadow-2xl` uses make dialogs/popovers louder than needed, while
   everyday controls rely on solid borders.
7. **Motion is mostly restrained, but tab springs still use non-zero bounce.** Professional chrome
   should have zero bounce.
8. **`globals.css` owns tokens and editor presentation together.** This makes theme ownership harder
   and encourages unrelated visual rules to accumulate globally.
9. **Inter works but contributes no product voice.** Current UI and document use nearly the same
   typographic texture.
10. **Many primitives are repeated class strings.** Menus, icon buttons, inputs, and dialog surfaces
    can drift during a broad appearance change.

The solution is not a new shell. It is a coherent layer model applied to the existing shell.

## 5. Visual thesis

### At rest

- window well visible between major working surfaces
- no strong accent color competing with content
- large surfaces use tonal separation, not shadows
- content remains visually dominant
- controls recede until hovered, focused, selected, or active

### Under interaction

- selected state uses fill + ink contrast
- focus uses a visible two-stage ring
- hover changes only fill/color
- pressed primary controls scale to `0.96`; high-frequency chrome does not
- drag and split targets may use accent tint
- motion is brief, interruptible, and zero-bounce

### Signature

Symtab's signature is **active-flow continuity**:

- active rail item
- active sidebar row
- active tab
- current editor selection/focus

share one low-chroma violet signal. No connecting decorative line is required. The continuity comes
from consistent state color and optical weight across the existing regions.

## 6. Token direction

Final implementation should use OKLCH variables. Hex values below are review-friendly reference
colors, not hardcoded component colors.

### Light

| Token            | Reference | Use                                             |
| ---------------- | --------- | ----------------------------------------------- |
| Window well      | `#ECEDE9` | exposed shell background between inset surfaces |
| Chrome           | `#F2F3F0` | titlebar, rail, status bar                      |
| Working surface  | `#FAFAF8` | editor and sidebar surfaces                     |
| Elevated surface | `#FFFFFF` | menus, dialogs, tooltips                        |
| Ink              | `#20211F` | primary text                                    |
| Muted ink        | `#70736D` | metadata and inactive controls                  |
| Symtab signal      | `#675FD1` | focus, active flow, drag/split state            |

Structural separator: pure black at 7–9% opacity. It is not a palette gray.

### Dark

| Token            | Reference | Use                                  |
| ---------------- | --------- | ------------------------------------ |
| Window well      | `#111210` | exposed shell background             |
| Chrome           | `#171815` | titlebar, rail, status bar           |
| Working surface  | `#1C1D1A` | editor and sidebar surfaces          |
| Elevated surface | `#242521` | menus, dialogs, tooltips             |
| Ink              | `#F0F1EC` | primary text                         |
| Muted ink        | `#989B93` | metadata and inactive controls       |
| Symtab signal      | `#948AF0` | focus, active flow, drag/split state |

Structural separator: pure white at 7–9% opacity.

### Semantic rules

- Accent is not the primary button fill by default. Primary buttons may use ink/inverse-ink.
- Violet appears for focus, active navigation, link/selection state, drag targets, and progress.
- Destructive remains red; warning remains amber; success remains green.
- Document highlights and callouts keep semantic colors but should be converted to OKLCH.
- Avoid blue-gray, slate, zinc, or tinted separators.
- Avoid pure black editor backgrounds; reserve `#000` for media canvases when required.

## 7. Surface hierarchy

Use four layers.

### Layer 0 — window well

- shell background
- titlebar/rail/status chrome sits on it
- no shadow
- full bleed

### Layer 1 — working surfaces

- left sidebar body
- main workspace body
- right sidebar body
- 4px visual inset inside current footprint
- 9px radius
- no drop shadow
- optional pure-neutral 1px inner outline at 6–8% opacity

Titlebar and status bar stay full bleed. The rail stays full bleed. Only working bodies are inset.

When a sidebar is collapsed, remaining surfaces expand exactly as they do now. No new animation or
layout calculation is introduced.

### Layer 2 — contained controls

- active tabs
- selected rows
- text fields
- segmented controls
- banners
- 6–8px radius
- tonal fill or shadow-ring, depending on interactivity

Use spacing before separators. Keep separators only where dense structure requires them.

### Layer 3 — floating surfaces

- popovers
- context menus
- dialogs
- tooltips
- command surfaces
- 10–12px radius
- layered neutral shadow in light mode
- white 8–13% shadow-ring in dark mode

Replace routine `shadow-2xl` with named elevation tokens. Reserve strongest elevation for blocking
dialogs only.

## 8. Region treatment

### Titlebar and tab strip

- retain 44px height and drag zones
- active tab becomes a self-contained 30–32px rounded surface
- inactive tabs remain transparent
- remove attached browser-tab bottom edge
- active tab fill equals working surface, with a subtle neutral ring
- inactive tab hover uses ≤100ms background-color transition
- close action appears on hover/focus as today
- tab separator appears only when needed between inactive tabs
- plus/menu actions use 28px hit visuals inside existing accessible targets
- no spring bounce during add, close, reorder, or stack

### Workspace rail

- retain 48px width and vertical order
- icons render at 16px on native grid
- default stroke: 1.5px
- active icon gets quiet 30×30 fill and stronger ink
- do not fill every icon
- use one separator only before plugin-contributed tools
- rail background remains chrome, not working surface

### Left and right sidebars

- retain widths, resize handles, controls, and content
- visible body becomes inset working surface
- toolbar background becomes transparent inside surface
- file/reference rows remain compact
- selected row uses signal at 8–12% tint plus primary ink
- hover uses neutral fill, not signal tint
- nesting guides reduce to 6–8% opacity
- toolbar groups rely on gap; avoid repeated divider lines
- empty states remain plain, not cards

### Resize handles

- default hairline remains visually quiet
- hover/focus expands hit affordance without changing layout width
- active resize line uses Symtab signal
- no full-pane glow

### Main workspace

- outer workspace becomes one inset working surface
- internal split panes share that surface
- split boundaries remain hairlines; do not turn each leaf into a card
- active leaf may receive a subtle signal focus line only while another split is present
- stacked tabs keep current geometry and vertical writing behavior

### Editor pane header

- retain 36px height
- transparent over working surface
- title remains centered
- navigation and menu actions use quiet neutral hover
- no bottom border unless content scroll makes separation necessary

### Editor content

- retain 760px measure
- retain current content padding as baseline
- reduce visual weight of H1/H2 slightly; current headings dominate at 1280×720
- editor title remains strong but not display-sized
- document content background stays identical to workspace surface
- selection uses signal at 18–24% opacity
- inline code uses contained neutral fill
- code/source view may use mono font; prose remains sans by default
- reading view may later expose a serif preference; do not force serif in this pass

### Status bar

- retain 28px height and current content
- chrome background, not sidebar surface
- reduce separators; keep only between unrelated status groups
- status text uses 11–12px utility styling with tabular numbers
- hover/focus controls use compact neutral fills
- error text remains visible but should not dominate the whole center forever

### Banners and degraded states

- banner sits 8–12px inside workspace surface
- use contained neutral surface + semantic leading indicator
- avoid heavy shadow for persistent degraded state
- action remains obvious

### Menus, dialogs, tooltips

- migrate behavior to Base UI/COSS patterns
- use one menu item height and one submenu rhythm
- replace repeated local menu class constants with shared primitives
- dialogs use named elevation, not unconditional `shadow-2xl`
- modal overlay uses neutral black opacity; blur only where content remains legible
- tooltips stay compact and should not imitate mini dialogs

## 9. Typography

### Roles

| Role                              | Direction          |
| --------------------------------- | ------------------ |
| UI and document default           | Mona Sans Variable |
| Source, paths, metadata, counters | Commit Mono        |
| Optional reading preference       | Source Serif 4     |

All are open-source options. Do not use Cal Sans, CursorGothic, or another reference brand face.

If adding fonts is deferred, retain Inter temporarily but implement role variables now:

```css
--font-ui
--font-document
--font-mono
```

### Scale

| Role             | Size / line height | Weight  |
| ---------------- | ------------------ | ------- |
| Status utility   | 11px / 16px        | 450     |
| Sidebar metadata | 11px / 16px        | 450     |
| Sidebar/menu row | 12px / 18px        | 450–500 |
| UI body          | 13px / 20px        | 450     |
| Editor prose     | 15px / 25px        | 400–450 |
| Editor H3        | 17px / 24px        | 600     |
| Editor H2        | 21px / 28px        | 620     |
| Editor H1        | 28px / 34px        | 650     |
| Document title   | 28px / 34px        | 650     |

Use tabular figures for counts, performance stats, line numbers, and timestamps. Use sentence case.
Avoid uppercase tracking labels except compact technical identifiers.

## 10. Radius and spacing

### Radius

| Token         | Value | Use                          |
| ------------- | ----- | ---------------------------- |
| `--radius-xs` | 3px   | marks and tiny inline chips  |
| `--radius-sm` | 5px   | compact row controls         |
| `--radius-md` | 7px   | buttons, fields, active tabs |
| `--radius-lg` | 9px   | working surfaces             |
| `--radius-xl` | 12px  | dialogs and floating panels  |

Nested surfaces must be concentric: outer radius = inner radius + inset padding. Do not apply the
same radius to close nested layers.

### Spacing

Keep a 4px base:

- 4px: icon-to-icon and very tight internal alignment
- 8px: row/internal control gap
- 12px: adjacent filled controls
- 16px: section padding
- 24px: unrelated groups

Professional density remains compact. Visual hit areas may be 28–32px where accessible hit targets
are already expanded by component implementation.

## 11. Icon system

- keep Lucide; do not mix icon families in core shell
- render shell icons at native 16px
- regular text pairing: 1.5px stroke
- semibold pairing: 2px stroke
- use `currentColor`
- outline default; fill only when state meaning benefits
- preserve physical-object direction in RTL; flip navigation chevrons/arrows
- optically correct asymmetric glyphs instead of adding random margins per usage
- bookmark fill remains meaningful; generic nav icons stay outline

## 12. Motion

Motion budget:

| Interaction             | Duration          | Properties                           |
| ----------------------- | ----------------- | ------------------------------------ |
| row/icon hover          | 80–100ms          | background-color, color, opacity     |
| focus/pressed           | 100–120ms         | ring/shadow, scale where appropriate |
| popover/dialog          | 140–180ms         | opacity, transform                   |
| sidebar collapse/expand | current 140–180ms | transform, opacity, grid track       |
| tab add/close/reorder   | 160–200ms         | opacity, width, transform            |

Rules:

- bounce is always `0`
- transitions must be interruptible
- never use `transition-all`
- no page-load animation for default chrome
- no animation on every keystroke
- no expressive hover animation
- primary buttons may press-scale to `0.96`
- high-frequency tab, row, and rail controls use instant or ≤100ms feedback
- honor reduced motion by removing spatial movement
- only add `will-change` after observed first-frame stutter

Existing non-zero tab bounce (`0.06`, `0.04`) should be removed during implementation.

## 13. COSS/Base UI adoption boundary

Use COSS selectively, not as a one-command visual overwrite.

1. Copy/install selected registry components into `packages/shared-ui`.
2. Prefer MIT-licensed source under COSS's `apps/ui` scope; record upstream path and revision.
3. Replace Radix behavior component-by-component.
4. Keep Symtab class names and token variables at the styling boundary.
5. Do not import Cal.com fonts or brand assets.
6. Do not make downstream Symtab plugins import application internals.
7. Publish only stable Symtab theme variables as the plugin-facing contract.

Initial primitives:

- Button
- Tooltip
- Menu / Context Menu
- Dialog / Alert Dialog
- Popover
- Input / Field
- Checkbox / Switch
- Tabs where behavior replacement is useful

Do not replace custom Symtab layout, resize, workspace tree, editor, or tab state models.

## 14. CSS ownership

Split the current global file by responsibility:

```text
packages/shared-ui/src/styles/
  tokens.css       theme roles and Tailwind mappings
  base.css         reset, root sizing, focus defaults
  shell.css        named Symtab shell surface classes
  editor.css       reading/markdown presentation
  print.css        print-only rules
  globals.css      imports only
```

Rules:

- components own their state and composition classes
- global CSS owns tokens, shell contracts, editor document semantics, and print
- no component-specific one-off selector enters `globals.css`
- no app consumes COSS's entire global preset without review
- plugin views receive stable tokens, not private component classes

## 15. Acceptance criteria

Revamp is successful when:

- screenshot silhouette is recognizably Symtab, not Obsidian
- current shell geometry and persisted layout behavior are unchanged
- light and dark themes share the same hierarchy
- active tab, active rail item, selected file, and editor focus feel related
- editor remains strongest visual region
- sidebars remain useful at minimum width
- split panes read as one workspace, not separate cards
- inactive window state remains legible
- all menus and dialogs use one elevation/radius language
- no routine surface uses `shadow-2xl`
- no interaction uses non-zero bounce
- no new `transition-all` is introduced; existing one is removed
- reduced motion removes spatial animation
- current desktop and web shells render consistently

## 16. Verification matrix for implementation

Test:

- 1280×720, 1440×900, 1728×1117
- light and dark
- active and inactive desktop window
- left sidebar open/closed/min/max width
- right sidebar open/closed/min/max width
- one tab, many tabs, pinned tab, stacked tabs
- horizontal and vertical workspace splits
- editor live/source/read modes
- file tree deep nesting and long names
- backlinks, tags, outline, properties, source control
- graph, PDF, browser, media preview
- settings, plugin manager, vault picker, destructive dialog
- hover, focus-visible, pressed, open, selected, disabled, loading, degraded
- 200% zoom
- reduced motion
- keyboard-only navigation
- RTL smoke test for directional chrome
- long-string/pseudo-localized labels

## 17. Explicit non-goals

- no dashboard redesign
- no editor workflow redesign
- no new navigation model
- no mobile redesign
- no marketing site
- no Figma design-system project
- no new animation library
- no wholesale shadcn or COSS preset
- no implementation before review
