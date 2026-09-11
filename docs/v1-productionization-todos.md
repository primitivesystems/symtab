# Flux v1 productionization TODOs

This checklist reflects the current **v1 shipping scope** in the live app path:

- onboarding
- workspace / vault management
- markdown note explorer CRUD
- graph
- search / backlinks / tags that support note navigation

The following systems remain in the repo but are intentionally **out of the live v1 path**:

- plugins
- MCP connections
- model providers / BYOM
- AI / agent mode
- VCS / source control UI
- publishing

## Done in this branch

- Removed non-v1 activity-bar placeholders from the live workbench surface.
- Hid the live AI toggle unless chat is explicitly wired.
- Removed the live popout affordance from editor actions when no implementation is provided.
- Fixed managed onboarding so “existing workspace” can open the workspace picker instead of acting like a dead file dialog path.
- Allowed managed workspace creation from the vault manager after onboarding.
- Filtered the live explorer to folders + Markdown notes.
- Tightened live note creation / rename flows to `.md` notes.
- Disabled plugin / MCP / model-provider / agent routes from the default server bootstrap.
- Added backend route coverage that asserts deferred systems stay absent from the default API surface.
- Reconciled `docs/flux-high-level-design.md` with the actual v1 shipping scope.
- Disabled menu-bar / launch-at-login startup behavior for the desktop v1 path.
- Removed non-v1 desktop menu entries for calendar / today-note navigation.

## Remaining blockers / hardening work

### Release hardening

- [ ] Sign the macOS app.
- [ ] Enable hardened runtime and notarization.
- [ ] Decide whether Windows/Linux are actually part of v1; if not, document mac-only support.

### Editor and file correctness

- [ ] Reconcile open editor tabs when files change externally.
- [ ] Add explicit UX for conflict recovery when a file changes outside the current editor.
- [ ] Decide whether restore-from-trash should stay Markdown-only or support broader vault assets.

### Graph confidence

- [ ] Add integration-style tests around the graph renderer, not just graph-model shaping.
- [ ] Validate performance and interaction behavior on larger real vaults.

### Test coverage / CI

- [ ] Add `bun run test:v1` to CI as the minimum release gate.
- [ ] Add app-core/shared-ui test execution to the main CI path if those packages are part of release-critical UX.
- [ ] Add one end-to-end onboarding + create workspace + create note + graph smoke test.

### Product cleanup

- [x] Reconcile `docs/flux-high-level-design.md` with the actual v1 shipping scope.
- [ ] Decide whether Quick Capture is in or out for v1 and trim native menus accordingly.
- [ ] If deferred systems are reintroduced later, do it behind explicit feature flags rather than implicit route availability.
