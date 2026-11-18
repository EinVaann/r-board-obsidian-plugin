# styles/ui

The UI components are shadcn components in `src/components/ui/` (generated with `npx shadcn add`,
configured by `components.json`) and styled with `rb:`-prefixed Tailwind classes. Their colours,
sizes and radii come from the `--rb-*` tokens through `styles/tailwind.css`.

Only what Tailwind classes can't reach lives here (e.g. the colours of a native `<select>`'s open
option list). Everything else: edit the component's classes, or a token.

Rules for which component to use where: `styles/RULES.md`.
