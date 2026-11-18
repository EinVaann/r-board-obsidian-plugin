# UI rules

One look per job. Before adding a control, find its job here and use that component.
Never restyle a component for one screen; if a screen needs something new, add a variant here first.

Components: shadcn in `src/components/ui/` (generated with `npx shadcn add`, see `components.json`;
only shadcn files live there). Screens use the value + onChange wrappers in
`src/components/form-controls.tsx`, `settings-layout.tsx` and `settings-list.tsx` (settings screens
import them all from `screens/modals/settings/_components/controls`).

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
| The board's create action (toolbar, empty states, home) | `Button variant="accent"` (graphite, never yellow) | New note, New row, Create board |
| Board toolbar | `size="toolbar"`: view tabs `ghost` + `aria-pressed`, Sort / Filter / tool buttons `chip` | |

Icon-only buttons grow to a 36px tap target on phones (`.is-mobile`), in the Button itself.

Labelled buttons are one height: `--rb-control-h`. `size="sm"` is only for buttons inside dense rows.

## Icons: one meaning each

| Icon | Means | Never use it for |
| --- | --- | --- |
| `chevron-down` (turns up when open) | Expand / collapse **in place** | opening a dialog, a dropdown |
| `chevrons-up-down` (⇅) | A dropdown: pick one or more values from a list | expanding |
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
- A name typed into a row looks like plain text until hovered or focused. A dropdown in a row (a type)
  always shows its box and ⇅, so it never reads as the row's ⌄.
- The list's add action is an `AddRow` directly under the box.

## Backgrounds

Flat colors only: no gradients behind content. Surfaces use `--rb-surface-bg`; the area behind cards
uses `--rb-canvas`. A theme may change the colors, not add gradients.

## Where styles live

- A component's look: `rb:`-prefixed Tailwind classes in its file in `src/components/ui/`. Colours, sizes
  and radii come from `--rb-*` tokens, mapped to Tailwind names in `styles/tailwind.css` (custom names
  also go in `src/lib/utils.ts`, so `cn` merges them right).
- Utilities are `!important`, so screen CSS can't resize a component. Pass a class instead
  (`className="rb:w-20"`). Screen CSS may place components (flex, order, margins), selected by
  `[data-slot]` or the screen's own classes, never by a shared class (`.rb-row-expand` is also the
  table's hover-only expand button, which hid the settings ⌄).
- A theme: token values in `styles/themes/<name>/10-tokens.css`. Slot rules only when a token can't say it.
