# R Board design system

Three layers. Each one only knows about the layer below it.

| Layer | Where | What it holds |
| --- | --- | --- |
| 1. Tokens | `styles/00-tokens.css` | Every size, radius, color and shadow a control uses, as `--rb-*` variables. Defaults follow Obsidian (the Classic look). |
| 2. Primitives | `src/ui/` (React) + `styles/ui/` (shapes) | The components, and their shapes built only from tokens. |
| 3. Theme modules | `styles/themes/<name>/` | A theme: token values, plus slot rules for anything tokens can't express. |

## Primitives (`src/ui`)

Import from `src/ui`, never style a control inline:

```tsx
import { Button, IconButton, Input, NumberInput, Select, MultiSelect, Segmented, Switch,
         Pill, Chip, SimpleCard, Card, CardHeader, LabeledField, SettingRow, Tabs, SortableList } from '../ui';

<Button variant="primary" icon="timer">Log</Button>      // primary | secondary | ghost | danger
<Select size="sm" value={v} options={opts} onChange={set} /> // md (default) | sm (dense rows)
<MultiSelect size="sm" required value={vals} options={opts} onChange={setVals} />
```

Shared types live in `src/ui/types.ts` (`Size`, `ButtonVariant`, `Option`, `NativeProps`…). A new
component reuses them instead of declaring its own unions.

Compound parts (`Card` + `CardHeader` + `CardIcon` + `CardTitle` + `CardDescription` + `CardActions` +
`CardContent` + `CardFooter`; `Field` + `FieldLabel` + `FieldHint` + `FieldControl`…) compose freely;
`SimpleCard` / `LabeledField` are the usual combinations.

## The styling contract

Every part renders:

- `data-slot`: what it is, kebab-case `family-part` (`button`, `card-title`, `multi-select-item`).
- `data-variant`, `data-size`, `data-state`: how it is (`primary`, `sm`, `on` / `checked` / `active`).

Themes and shapes select **only** these attributes, never class names. Class names on primitives are
for layout of the screen using them.

## Changing how things look

| To change… | Edit |
| --- | --- |
| One value everywhere (a radius, the primary color) | a token in `00-tokens.css` (all themes) or in the theme's `10-tokens.css` |
| A control's shape everywhere | its file in `styles/ui/` |
| A control in one theme | the theme's `10-tokens.css`; if a token can't say it, a `[data-slot]` rule in the theme folder |
| One place | pass `className` from that screen |

## Adding a theme

1. Create `styles/themes/<name>/` (the build picks up every folder here, after the shared CSS).
2. `10-tokens.css`: under `body.rb-theme-<name> :is(.rb-root, .rb-home, .rb-embed, .modal.rb-modal, .menu.rb-menu, .rb-drag-ghost)`, set the `--rb-*` tokens. Give theme-private values a prefix (Industrial uses `--rbi-*`).
3. Optional: further files for surfaces (views, canvas) and slot rules, e.g.
   `body.rb-theme-<name> [data-slot='button'][data-variant='secondary'] { … }`.
4. Add the name to `ThemeName` in `src/theme.ts` and to the settings dropdown.

## Moving an old screen over

Older screens still use classes (`rb-prop-select`, `rb-filter-value`…). `styles/ui/input.css` keeps them
on the same tokens meanwhile. When touching a screen, swap its controls for primitives and delete the
old CSS for them.
