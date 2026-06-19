# R Board

A native Obsidian plugin that renders configurable **board views** (Gallery, Kanban, Table) driven by your notes' frontmatter and tags. No Datacore, no dataview queries — boards are plain `.board` config files read through Obsidian's own metadata cache.

## How it works

A board is a `.board` file (JSON) stored anywhere in your vault. Opening it shows a board pane with a toolbar to switch between Gallery, Kanban, and Table views.

> **File naming.** Obsidian identifies a file by the extension after its last dot, so a `.board.json` file would register as a generic `.json` file (and hijack every JSON file in the vault). R Board instead uses the single `.board` extension — the file content is still JSON, exactly like Obsidian's own `.canvas` files. Name your boards e.g. `Games.board`.

Run the **"Create new board"** command to drop a starter `.board` file and open it.

## Board config

```json
{
  "name": "Game Backlog",
  "sourceTag": "backlog",
  "fields": [
    { "name": "cover", "type": "image", "render": "fill" },
    { "name": "title", "type": "text" },
    { "name": "genre", "type": "multi", "render": "pills" },
    { "name": "rating", "type": "number", "render": "stars", "max": 5 },
    { "name": "score", "type": "number", "render": "bar", "max": 100 },
    { "name": "progress", "type": "number", "render": "circle", "max": 100 }
  ],
  "kanban": {
    "groups": ["to-play", "playing", "completed", "on-hold", "dropped"]
  },
  "defaultView": "gallery"
}
```

### Field types

| Type     | Description                       | Render options                  |
|----------|-----------------------------------|---------------------------------|
| `image`  | Wikilink/path/URL to an image     | `fill` (default), `fit`         |
| `text`   | Plain string                      | `plain`, `badge`, `pill`        |
| `multi`  | Array of strings                  | `pills`, `tags`                 |
| `number` | Numeric value                     | `text`, `stars`, `bar`, `circle`|

- Image `fill` crops to fill the card (`object-fit: cover`); `fit` shrinks to fit without cropping (`object-fit: contain`).
- `stars` / `bar` / `circle` use the field's `max`.
- Add `"searchable": true` to a field to include it in the search bar (by default the title plus all text/multi fields are searched).

## Data source

- Notes are matched via Obsidian's native metadata cache — any note whose tags include `sourceTag` (frontmatter `tags` or inline `#tags`).
- Notes named `_template` are excluded from every board.

## Views

- **Gallery** — masonry (CSS `column-count`) of cards; click a cover to open it fullscreen. Not draggable.
- **Kanban** — one column per `kanban.groups` entry (group `playing` → tag `#playing`), plus an **Uncategorized** column for notes with the source tag but no group tag. Cards are sorted by `score` descending and can be dragged between columns, which rewrites the note's group tag in frontmatter (the base `sourceTag` is always kept). Columns are collapsible.
- **Table** — one row per note, a column per field; click a header to sort.

Shared across views: a search bar, "View More" pagination (50 items per page), and note titles that link to the source note.

The active view is remembered per board.

## Development

```bash
npm install      # restore dependencies
npm run dev      # watch build (main.js + styles.css)
npm run build    # production build
```

CSS lives as numbered partials under `styles/` and is concatenated into `styles.css` by `build-css.mjs`.

## Out of scope (v0.1)

Chart view, single-note ingestion, formulas, cross-board references, mobile layout tuning.
