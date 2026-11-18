# UI rules

One look per job. Before adding a control, find its job here and use that primitive (`src/ui`).
Never restyle a primitive for one screen; if a screen needs something new, add a variant here first.

## Buttons: which one

| Job | Use | Example |
| --- | --- | --- |
| The one action that finishes a dialog | `Button variant="primary"` | Add, Done, Save |
| Any other action with a label | `Button` (secondary) | Edit filters… |
| Add an item to the list right above it | `AddRow` — full width, dashed, under the list | Add column, Add automation, Add value |
| Add a part *inside* an item (a line in a group) | `Button variant="ghost" size="sm" icon="plus"` | Add trigger, Add effect, Add filter rule |
| Remove something big (a view, a filter set) | `Button variant="danger"`, same size as other buttons, alone at the bottom right | Delete view |
| An action on one row | `IconButton size="sm"` at the row's right end | ⌄ options, bin |
| Remove one row | `IconButton size="sm" tone="danger" icon="trash-2"`, always last in the row | |

Labelled buttons are one height: `--rb-control-h`. `size="sm"` is only for buttons inside dense rows.

## Icons: one meaning each

| Icon | Means | Never use it for |
| --- | --- | --- |
| `chevron-down` (turns up when open) | Expand / collapse **in place** | opening a dialog |
| `sliders-horizontal` | Opens a **settings dialog** (view settings) | expanding a row |
| `settings` (gear) | Opens **board / table settings** | anything else |
| `plus` | Adds | |
| `trash-2` | Removes; red on hover | hiding |
| `eye` / `eye-off` | Shown / hidden (reversible, nothing deleted) | removing |
| `grip-vertical` | Drag to reorder; always first in the row | |
| Property type icons (`PROPERTY_TYPE_ICON`) | The property's type, right after the grip | |

## On / off

- A setting that is on or off: `Switch`, at the row's right end.
- Picking which items appear (fields to ask for, columns to show): also `Switch`, at the row's right end.
- `Checkbox` is only for a value inside the data (a checkbox property).

## Settings lists

Every list of items in settings (columns, views, fields to ask for, values, rules) is a `SettingsList`:
one bordered box, a hairline between rows, rows 40px high. A row is, left to right:

`grip (if reorderable) · type icon · name · [details] · [row actions] · [switch or ⌄]`

- A row that has more options expands **in place** with `⌄` (not a dialog). The open row gets a sunken
  background; its options sit under a hairline, indented to the name.
- Text in a row (a name, a type) looks like plain text until hovered or focused.
- The list's add action is an `AddRow` directly under the box.

## Backgrounds

Flat colors only: no gradients behind content. Surfaces use `--rb-surface-bg`; the area behind cards
uses `--rb-canvas`. A theme may change the colors, not add gradients.

## Where styles live

- A primitive's look: `styles/ui/<primitive>.css`, selected only by `[data-slot]` (and `[data-part]` for
  a piece inside it). Never by a class: class names are global and collide (`.rb-row-expand` is also the
  table's hover-only expand button, which hid the settings ⌄).
- A screen's layout (spacing, columns): the screen's own file, selected by its classes. It never sets a
  primitive's colors, borders or sizes.
- A theme: token values in `styles/themes/<name>/10-tokens.css`. Slot rules only when a token can't say it.
