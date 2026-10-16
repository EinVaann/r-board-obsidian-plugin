# R Board

A native Obsidian plugin that turns your notes into **databases** with multiple configurable **views** (Gallery, Kanban, Table, Chart), driven by note frontmatter and tags. No Datacore, no dataview queries — a database is a plain `.board` config file read through Obsidian's own metadata cache.

It also has **tables**: `.table` files whose rows live in the file itself, edited in a spreadsheet grid, with formulas and charts — the same views and settings as boards. (Tables replace the separate R Sheet plugin; its `.table` files open directly.)

It also renders **interactive content blocks** inside notes — starting with [**Recipes**](#recipes), where ingredient amounts and cooking times scale with a portions stepper.

## Concepts

- **Database** — pick a base tag (`sourceTag`) and define its **properties**. Every note carrying that tag is a row in the database.
- **Property** — a frontmatter key with a type and render style (e.g. `rating` as stars). Defined once on the database.
- **View** — a saved layout over the database (Gallery / Kanban / Table). Each view has its own:
  - **property visibility** (which properties show, and in what order)
  - **load limit** (`10`, `50`, `100`, or `"none"`)
  - **filter** (conditions on properties)
  - **group** (a property to split items into sections — and, for Kanban, the column field)

A database is a single `.board` file (JSON). Opening it shows the board pane with a tab per view.

> **File naming.** Obsidian identifies a file by the extension after its last dot, so a `.board.json` file would register as a generic `.json` file (hijacking every JSON file in the vault). R Board uses the single `.board` extension instead — content is still JSON, exactly like Obsidian's own `.canvas` files. Name databases e.g. `Games.board`.

## Using it

- **Ribbon icon** (or the **"Open R Board"** command) opens the **home** screen, which lists every board in your vault and has a **Create board** button.
- **Create board** opens a **setup wizard**: name the database, choose the base tag, and define properties. (The **"Create new database"** command opens the same wizard.) New boards start with **no views**.
- Opening an empty/unconfigured `.board` file shows the same wizard.
- **Add a view** with the **＋** button next to the view tabs, then pick Gallery / Kanban / Table — the view's settings open so you can configure it.
- The board toolbar's right side has **Sort**, **Filter**, **View settings** (gear), and **Board settings** buttons. Board settings edit the name/tag/properties; view settings edit everything about the active view.
- You don't have to hand-edit JSON — everything is editable through these dialogs (the `.board` file is just where it's saved).

## Schema

```json
{
  "name": "Game Backlog",
  "sourceTag": "backlog",
  "properties": [
    { "name": "cover", "type": "image", "render": "fill" },
    { "name": "genre", "type": "multi", "render": "pills" },
    { "name": "status", "type": "text", "render": "badge" },
    { "name": "rating", "type": "number", "render": "stars", "max": 5 },
    { "name": "score", "type": "number", "render": "bar", "max": 100 }
  ],
  "views": [
    {
      "name": "Gallery",
      "type": "gallery",
      "limit": 50,
      "properties": ["cover", "genre", "rating", "score"],
      "filter": {
        "conjunction": "and",
        "conditions": [{ "property": "rating", "op": "gte", "value": 4 }]
      }
    },
    {
      "name": "Board",
      "type": "kanban",
      "limit": "none",
      "group": "status",
      "columns": ["to-play", "playing", "completed", "on-hold", "dropped"],
      "properties": ["cover", "score"]
    },
    {
      "name": "Table",
      "type": "table",
      "limit": 100,
      "properties": ["status", "genre", "rating", "score"]
    }
  ],
  "defaultView": "Gallery"
}
```

### Property types

| Type     | Description                     | Render options                  |
|----------|---------------------------------|---------------------------------|
| `image`  | Wikilink / path / URL to image  | `fill` (default), `fit`         |
| `text`   | Plain string                    | `plain`, `badge`, `pill`        |
| `multi`  | Array of strings                | `pills`, `tags`                 |
| `number` | Numeric value                   | `text`, `stars`, `bar`, `circle`|
| `checkbox` | true / false                  | `check`, `box`, `toggle`        |
| `links`  | Wikilinks / URLs                | `list`, `pills`                 |
| `select` | One value from a list of options (label + color each) | `pill`, `plain` |
| `date`   | `YYYY-MM-DD` (optionally with time) | `plain`, `relative` ("in 3 days") |
| `url`    | A web link                      | —                               |
| `formula`| Computed from other properties, e.g. `{Price} * {Qty}` | as `number`     |

- `select` and `multi` properties can list **options** (`{ "value", "label", "color" }`): they set the order of groups and kanban columns and the colors of pills, columns and chart series. Values not listed still work.
- **Formulas** refer to properties by label or key in braces (`{Amount}`) and to the title as `{Title}`; functions include `if`, `round`, `sum`, `concat`, `dateAdd`, `dateDiff`, `formatDate`, `today` (full list in the property editor). A table row can override a formula with its own `=expr` or a fixed value.
- `number` and `formula` properties take a **format** (plain, currency, percent, compact; decimals; thousands separators).
- Image `fill` crops to fill (`object-fit: cover`); `fit` shrinks without cropping (`object-fit: contain`).
- `stars` / `bar` / `circle` use the property's `max`. `stars` renders fractional values (e.g. `4.3` fills three and a bit stars).
- Add `"searchable": true` to a property to include it in the search bar (by default the title plus all visible text/multi properties are searched).

### View config

- **`properties`** — names of the properties to show, in order. Omit to show all. An `image` property becomes the card cover; `title` is always shown as a link.
- **`limit`** — `10` | `50` | `100` | `"none"`. Page size for the "View More" button (applied per column/section when grouped). `"none"` shows everything.
- **`filter`** — a nested filter group: `{ "conjunction": "and" | "or", "conditions": [...] }`, where each condition is a rule `{ "property", "op", "value" }` or another group. Operators: `eq`, `ne`, `contains`, `gt`, `gte`, `lt`, `lte`, `empty`, `notempty`. (A legacy flat array of rules is still accepted and read as one AND group.) Edit it visually with the **Filter** button — a Notion-style builder with AND/OR and nested groups.
- **`group`** — a property name. In Gallery/Table it splits items into labelled sections; in Kanban it is **required** and defines the columns (each distinct value = a column, plus an Uncategorized column).
- **`columns`** — optional explicit order of group/column values; any others follow, sorted; Uncategorized is last.
- **`sort`** — `{ "property", "dir" }` where `property` is a property name or `"$title"`, and `dir` is `"asc"` / `"desc"`. **Defaults to title ascending.** Applies to every view type (clicking a table header sets it too).
- **`cardSize`** (gallery/kanban) — `"small"` | `"medium"` | `"large"`. Kanban cards are a fixed size per setting.
- **`showContent`** (gallery/kanban) — `true` renders an excerpt of each note's body on the card, and a **content-type badge** (e.g. `Recipe`) when the body matches a known type.
- **`layout`** (gallery) — `"masonry"` (default) or `"grid"` (fixed tiles).
- **`paging`** (table) — `"more"` (default: a "View More" button grows the list) or `"pages"` (numbered pages; `limit` is the page size).

## Data source

- Notes are matched via Obsidian's native metadata cache — any note whose tags include `sourceTag` (frontmatter `tags` or inline `#tags`).
- Notes named `_template` are excluded from every database.

## Views

- **Gallery** — masonry or fixed grid of cards; optional note-content excerpts. Not draggable.
- **Kanban** — one column per value of the `group` property (text, select, date, checkbox, number or formula), plus an Uncategorized column; optionally split into **rows (swimlanes)** by a second property (`subGroup`). Cards can be dragged between cells, which **rewrites the group (and row) property** (dropping into Uncategorized clears it); columns reorder by dragging their header; every cell has a **New** button that pre-fills its values. On phones and tablets, drag is off so the board scrolls cleanly; move cards with the card's ⋯ menu. Fixed card size.
- **Table** — a spreadsheet grid: one row per item, a column per visible property. Click / shift-click / drag to select cells, arrows and Tab to move, type or tap a selected cell to edit, copy and paste as TSV, Delete to clear. Click a header to sort, drag to reorder, drag its edge to resize; right-click a row for its menu.
- **Chart** — bar, line, area, pie, donut or scatter over the view's filtered items (`chart` settings: categories, date grouping, series split, values and how they combine). Click a bar or slice to list its items.
- **Recipe** — one card per note showing its title, properties, and full interactive [recipe block](#recipes). The card isn't click-to-open (so the portions stepper stays usable); the title link opens the note.

Shared across views: a search bar, "View More" pagination, sort & filter (typed operators: *is any of*, *is before*, *is checked*, …), and grouping — dates can group relative to today (Older … Today, Tomorrow … Later) or by week / month / quarter / year, collapsed groups are saved with the view, and a group's **＋** adds an item already in it. **Clicking an item opens its note** in every view (Ctrl/Cmd-click opens in a new tab); clicking a cover image opens it fullscreen instead. The active view is remembered per database.

**Split view** — right-click a view tab → *Show beside* to show another view to its right or below (optionally filtered by the first); drag the divider to resize, × to close.

## Tables

A `.table` file is a database whose rows are stored in the file (one row per line), created with **Create table** on the home screen, the **"Create new table"** command, or a folder's **New table** menu item. Its properties are named columns; one of them is the row's title. Everything else — views, filters, formulas, charts, split view — works as for boards. Rows are edited in the grid, or in a full row editor (the ⤢ button next to a row's title).

R Sheet's `.table` files open directly and are converted on the first edit (R Sheet itself must be disabled: only one plugin can open `.table` files).

## Embeds

Show a view inside any note (right-click a view tab → *Copy embed code*):

````markdown
```rboard
file: Finance/Expenses.table
view: Monthly spending
height: 300
```
````

Edits made in an embed are written to the database file. R Sheet's old ` ```table-chart ` blocks render the matching chart view.

## Recipes

A ` ```recipe ` code block anywhere in a note renders as an interactive card: ingredient amounts and cooking times that **scale with a portions stepper**.

````markdown
```recipe
portions: 2
ingredients:
  - 200 g spaghetti
  - 2 egg yolks
  - {0.5 tsp:sqrt} black pepper
  - salt to taste
steps:
  - Boil the pasta for {9 min:const} in salted water.
  - Fry the guanciale for {6 min:sqrt} until crisp.
```
````

- **`portions:`** — the recipe's base (anchor) portion count. The stepper scales everything relative to it; nothing is written back to the note.
- **Ingredients** — one per line: a leading amount then the name. A bare number scales linearly by default (`200 g` → `400 g` at double portions); the unit stays in the name.
- **Steps** — prose with inline `{…}` tokens; a token with a time unit (`min`, `hr`, `sec`…) stays fixed by default, because doubling portions rarely doubles cook time.

### Scaling tokens

Amounts and times are **scaling tokens** — a small expression for "a number that knows how to scale." Same syntax in both places:

```
{ VALUE (: TAG)* (, ENTRY)* }
```

| Tag                | Meaning                                        | Example                          |
| ------------------ | ---------------------------------------------- | -------------------------------- |
| `const`            | never changes                                  | `{9 min:const}`                  |
| `linear`           | scales 1:1 (default for amounts)               | `{200 g:linear}`                 |
| `sqrt`             | sub-linear (fry/boil time, salt)               | `{6 min:sqrt}`                   |
| `pow=k`            | custom curve (`0`=const, `1`=linear, `0.5`=sqrt)| `{6 min:pow=0.7}`               |
| `Np`, `>Np`, `2-4p`| a portion condition (piecewise / anchor)       | `{9:1p, 18:2p, 27:>=3p}`         |
| `int`, `round=0.25`| round the result                               | `{2:linear:int}`                 |
| `min=`, `max=`     | clamp the result                               | `{1 clove:linear:min=1}`         |

Overlapping conditions resolve by specificity (exact beats range beats bound beats formula); a genuine conflict or an unresolvable/parse error shows the **base value with a ⚠ mark** rather than a silently-wrong number.

**Full grammar, resolution rules, and error handling:** [`docs/recipe-tokens.md`](docs/recipe-tokens.md).

## Development

```bash
npm install      # restore dependencies
npm run dev      # watch build (main.js + styles.css)
npm run build    # production build
npm test         # unit tests + UI smoke tests (vitest)
```

The UI is React 19. `src/BoardView.tsx` is the Obsidian side (file, vault events) and mounts `src/board/BoardApp.tsx`; each open board has its own Zustand store (`src/board/store.ts`), and config edits are Immer recipes so unchanged views and cards keep their identity and skip re-rendering. Libraries: dnd-kit (all drag and drop, touch included), TanStack Virtual (gallery and table only render what's on screen), Radix UI primitives (settings tabs, switches, segmented controls, collapsibles), styled with Obsidian's CSS variables.

`node dev/build-harness.mjs` bundles the real UI with a fake `obsidian` into `dev/out/` for a browser (`?kind=board` for a notes board, `?embed` for embeds, `?mobile` for phone layout).

`npm run dev` bundles React's development build (slower, with extra checks); judge performance with `npm run build`.

CSS lives as numbered partials under `styles/` and is concatenated into `styles.css` by `build-css.mjs`. The recipe token parser/resolver (`src/recipe/token.ts`) is pure and covered by tests; `src/test/board.smoke.test.tsx` renders every view and settings tab against a mock vault (`src/test/obsidian-mock.ts`) under happy-dom.

## Out of scope (for now)

Cross-database references (relations / rollups), undo, writing scaled recipe amounts back to the note, cross-recipe shopping lists.
