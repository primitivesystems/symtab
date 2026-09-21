# Symtab Plugin SDK

Typed manifest and capability API for sandboxed Symtab plugins.

```ts
import { definePlugin } from "@flux/plugin-sdk";

export default definePlugin({
  async activate(context) {
    const { results } = await context.capabilities.invoke("vault.search", { query: "hello" });
    console.info(results);
  },
});
```

Declare every used capability in `flux.plugin.json`. Runtime approval remains authoritative.

Views can request one safe host surface and either a built-in icon or packaged SVG:

```json
{
  "contributes": {
    "views": [{
      "id": "example.plugin.panel",
      "title": "Example",
      "entry": "dist/view.html",
      "location": "right-sidebar",
      "icon": "panel-right",
      "iconPath": "dist/icon.svg"
    }]
  }
}
```

`location` supports `modal`, `left-sidebar`, `right-sidebar`, or `workspace`; omission
selects the plugin in Symtab's left sidebar, like Files or Search. Modal placement must
be explicit. `icon` supports `puzzle`, `sparkles`, `panel-left`,
`panel-right`, `layout-dashboard`, `calendar`, `list`, or `git-branch`. `iconPath` takes
precedence, must point to a packaged SVG no larger than 64 KiB, and is rendered only as
an image; plugins still cannot inject host DOM.
