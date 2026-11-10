# UI primitives: shapes

One file per primitive in `src/ui/primitives/`. Rules here:

- Select parts by `[data-slot]` (plus `[data-variant]`, `[data-size]`, `[data-state]`), never by class.
- Use only `--rb-*` tokens from `styles/00-tokens.css`. No colors or pixel sizes typed in.
- Wrap the scope in `:where(...)` (zero specificity) so a slot rule always beats generic element rules from Obsidian, and a theme's `[data-slot]` rule beats these.

To change a control everywhere: edit its file here (shape) or a token (value).
To change it for one theme: set tokens or add a slot rule in `styles/themes/<name>/`.
To change one place: pass `className` to the component.
