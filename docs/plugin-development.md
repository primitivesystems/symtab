# Symtab plugin development

Plugin source stays outside Symtab monorepo. Generator creates template; app installs packaged
`.symtab-plugin`.

## Published toolchain

```sh
bunx create-symtab-plugin ~/Code/my-symtab-plugin
cd ~/Code/my-symtab-plugin
bun install
bun run validate
bun run pack
```

## Local monorepo toolchain

Use this until `create-symtab-plugin` and `@symtab/plugin-sdk` are published:

```sh
cd /path/to/symtab
bun run --cwd packages/create-symtab-plugin build
cd packages/create-symtab-plugin && bun link
cd ../plugin-sdk && bun link

cd ~/Code
node /path/to/symtab/packages/create-symtab-plugin/dist/cli.js my-symtab-plugin
cd my-symtab-plugin
bun link create-symtab-plugin
bun link @symtab/plugin-sdk
bun run validate
bun run pack
```

`pack` prints artifact path and SHA-256. Repeated packs overwrite the previous artifact.

Installing that artifact through **Install from file…** is a normal, bounded production install.
Symtab does not poll locally installed plugins or infer development mode from their source.

## Install and run

1. Open target vault in Symtab.
2. Open Plugins → Manage plugins → Installed.
3. Select **Install from file…** and choose generated `.symtab-plugin`.
4. Review staged permissions, activate version, then enable it for current vault.
5. Click **Run Search welcome notes**. Success toast proves worker activated, event handler ran,
   and declared `vault.search` capability completed.
6. Check plugin card for failure count or last error when command fails.

Plugin package is global app metadata. Permission grants, enablement, settings, worker, and errors
are per vault. Installing does not silently enable plugin in every vault.

## Development loop

```sh
bun run dev
```

`dev` watches `src/` and `symtab.plugin.json`, runs the plugin's `build` script, and uploads each
successful build to the authenticated local Symtab desktop daemon. Open plugin views refresh while
you edit; keeping Plugins or a plugin view open also reloads worker code. Keep Symtab desktop
running and use a disposable test vault.

Running `dev` is the explicit opt-in to development mode. Only plugin versions installed through
that command are checked for live updates while their view or the plugin manager is open.
Development reload is desktop-only and never inferred for file or marketplace installs. It may
update a same-version manifest, but cannot expand required permissions. Disable and reinstall to
review new permissions. Stop watcher with `Ctrl+C`.

For production, increment manifest version, run `bun run pack`, then install the artifact.

## UI

Views are sandboxed HTML webviews. Bundle React/shadcn and CSS into `dist`; do not import Symtab
React components or address host DOM. Use themeable CSS plus keyboard and ARIA semantics.
Current stable contribution points are commands, settings, and modal views. Ribbon, sidebar,
editor-tab, and status-bar placements require explicit future manifest contracts; arbitrary DOM
injection will not be supported.
