# Graph, links, backlinks, and tags

Symtab indexes relationships between Markdown notes and exposes them in the graph and the right sidebar.

## Link notes

Use standard Markdown links or wiki links such as `[[Project plan]]`. Wiki links can target a vault path, relative path, or unique filename. When more than one file could match, Symtab leaves the link unresolved instead of guessing.

## Use the right sidebar

Open the secondary sidebar to inspect the active note. Its views include:

- **Backlinks** — notes that link to the active note, plus optional unlinked mentions;
- **Outgoing links** — targets linked from the active note;
- **Tags** — indexed tags across the vault;
- **Properties** — frontmatter properties;
- **Outline** — headings in the active note.

Select a backlink, outgoing link, or outline item to navigate. Selecting a tag opens a tag-filtered search.

## Use the graph

Open **Graph** from the activity bar. The graph reads the vault index instead of scanning every note in the browser.

You can pan, zoom, drag nodes, fit the graph to the view, and select a file node to open its note. Graph settings provide:

- search;
- tag, attachment, existing-file, and orphan filters;
- query-based color groups;
- labels, arrows, node size, and link thickness;
- center, repel, link, and distance controls.

Press `Home` while the graph has focus to fit it to the view. If graph or backlink results are stale, wait for indexing to finish or use the rebuild action shown by the degraded-index warning.
