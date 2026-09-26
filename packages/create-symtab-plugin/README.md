# create-symtab-plugin

```sh
bunx create-symtab-plugin my-plugin
cd my-plugin
bun install
bun run dev
bun run validate
bun run pack
```

`dev` explicitly enables live development mode, then rebuilds and reloads into running Symtab
desktop. A local `.symtab-plugin` installed from file remains a normal non-polled install. `pack`
creates a ZIP-compatible production `.symtab-plugin` and prints its SHA-256 checksum. Plugin source
stays outside Symtab monorepo.

Local unpublished-toolchain setup, install, activation, and verification:
[`docs/plugin-development.md`](../../docs/plugin-development.md).
