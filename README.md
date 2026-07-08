# R Board

A native Obsidian plugin that turns your notes into **databases** with multiple configurable **views** (Gallery, Kanban, Table), driven by note frontmatter and tags. No Datacore, no dataview queries — a database is a plain `.board` config file read through Obsidian's own metadata cache.

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

## Data source

- Notes are matched via Obsidian's native metadata cache — any note whose tags include `sourceTag` (frontmatter `tags` or inline `#tags`).
- Notes named `_template` are excluded from every database.

## Views

- **Gallery** — masonry or fixed grid of cards; optional note-content excerpts. Not draggable.
- **Kanban** — one column per value of the `group` property, plus an Uncategorized column. Cards can be dragged between columns, which **rewrites the group property** in the note's frontmatter (dropping into Uncategorized clears it). Fixed card size.
- **Table** — one row per note, a column per visible property; click a header to sort.

Shared across views: a search bar, "View More" pagination, sort & filter, and grouping. **Clicking an item opens its note** in every view (Ctrl/Cmd-click opens in a new tab); clicking a cover image opens it fullscreen instead. The active view is remembered per database.

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
npm test         # run the unit tests (vitest)
```

CSS lives as numbered partials under `styles/` and is concatenated into `styles.css` by `build-css.mjs`. The recipe token parser/resolver (`src/recipe/token.ts`) is pure and covered by tests.

## Out of scope (for now)

Chart view, cross-database references, writing scaled recipe amounts back to the note, cross-recipe shopping lists, mobile layout tuning.
