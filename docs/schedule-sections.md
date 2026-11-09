# Schedule sections — proposal

Replaces the fixed status roles (`statuses`, `live`) and the hard-coded
right-click menu with a list of **sections** defined by filters. Notes stay the
source of truth: changing a property anywhere (Kanban, the note, a menu) moves
the item in the schedule. The plan itself (pins, queue order, not-before, lane
numbers) stays in the view config.

## Config

```ts
interface ScheduleSection {
  name: string;
  kind: 'lanes' | 'queue' | 'live' | 'side' | 'finished' | 'dropped' | 'hidden';
  /** AND of conditions; see "Filters" below. */
  conditions: SectionCondition[];
}

type SectionCondition =
  | { property: string; op: 'is'; value: string }          // select
  | { property: string; op: 'anyOf'; value: string[] }     // select
  | { property: string; op: 'checked' | 'unchecked' };     // checkbox

// ScheduleConfig: `sections: ScheduleSection[]` replaces `statuses` and `live`.
```

| Kind | Shown as | Engine role |
|---|---|---|
| `lanes` | Timeline (one section only) | Running items; extra items beyond the lane count are listed with "N playing, M lanes" |
| `queue` | Fills the lanes (one section only) | Pool, picked by score − penalty, pins apply |
| `live` | Cards, left column of the live-side group | Live band: counts toward live pace; its sessions are `live` |
| `side` | Cards, right column of the live-side group | Running outside the lanes; its sessions are `detour` |
| `finished` | Not shown | Ended; teaches the overrun factor |
| `dropped` | Not shown | Ended; not used for overrun |
| `hidden` | Not shown | Ignored (e.g. on hold) |

Several `live`, `side`, `finished`, `dropped` and `hidden` sections are allowed.

## Filters

Only properties with fixed options, so every section can be written to:

| Property type | Conditions | Written on "Move to" |
|---|---|---|
| Select | is, is any of | the value (first one for "any of") |
| Checkbox | checked, unchecked | true / false |

Conditions combine with AND. Text, number, date and multi-select properties,
and negative conditions ("is not", "none of"), are not allowed.

## Matching

Sections are checked top to bottom; **the first match wins**, so an item is in
at most one section. An item matching none is ignored.

Default sections for a game backlog (guessed from the status property and the
checkbox properties):

```
Live          status is playing,  live-service checked   → live
Also playing  status is playing,  casual checked         → side
Lanes         status is playing                          → lanes
Queue         status is planned                          → queue
On hold       status is on-hold                          → hidden
Completed     status is completed                        → finished
Dropped       status is dropped                          → dropped
```

## Layout

Top to bottom: week panel, **live-side group**, lane timeline, footer.

### Live-side group

One block above the lanes: a single **wrapping grid** of cards, live items
first, then side items, each in section order.

- Each item is a **card** like a lane entry: cover image, title, and the same
  hint line (e.g. average weekly hours for live). No date range; one Log time
  button, like running lane entries.
- Cards have a fixed minimum width and wrap to as many per row as fit
  (`grid-template-columns: repeat(auto-fill, minmax(…, 1fr))`), so narrow
  widths just get fewer per row.
- **Color tells them apart**, the way lane entries use a left accent bar:
  live cards get one tint and side cards another. Both are muted theme colors
  at low strength (e.g. `rgba(var(--color-blue-rgb), …)` for live,
  `rgba(var(--color-green-rgb), …)` for side) on the left bar and a faint
  background, with a small kind tag ("Live" / section name) on the card.
- The group's header shows the counts (e.g. "3 live · 1 also playing").
- Right-click opens the same short menu as everywhere else (Move…, Log time,
  Open note).
- The group is hidden when it has no items.
- The group collapses as one, like other sections; the collapsed state is
  saved with the view.

## Menu

The right-click menu is short: **Move…**, Log time, Open note. Every kind of
move happens in one modal.

### Move modal

One modal for an item, whatever section it is in. It has two tabs, opened on
the one holding the item's current section:

**Plan** — sections that are shown (`lanes`, `queue`, `live`, `side`):

1. **Section** — a list of these sections; the current one selected.
2. **Place** — only for `lanes` and `queue`:
   - `queue`: pick a lane, then a slot in its queue (Next / After X / Last),
     plus **Let the schedule decide** (removes the pin).
   - `lanes`: pick a lane; a busy lane is marked and the item waits in the
     overflow until it frees up.
3. **Not before** — optional date, only for `queue`; clearing it removes the
   hold.
4. **Move** applies everything at once.

**End** — sections that are not shown (`finished`, `dropped`, `hidden`), one
button each, in section order (e.g. Completed / Dropped / On hold). One click
applies it. When this frees a lane, the "Lane B is free" bar appears.

This replaces Move up / Move down / Move to position / Move to lane / Pin /
Unpin / Not before / Start now / Finish / Drop / Put on hold. Insert before
goes away: move the other item to that slot instead. Dragging a bar still works
and does the same as picking its slot in the modal. Running entries keep no
buttons of their own besides Log time.

### Double-click to pin

Double-clicking a **queued** entry toggles its pin:

- Unpinned → pinned at the place it's shown now (lane and position), so the
  schedule stops moving it.
- Pinned → unpinned; the schedule places it again. A not-before date is kept
  (like Re-plan), since it's a separate choice; clear it in the Move modal.

The pin marker on the entry flips at once. Double-clicks on the title link or
on buttons keep their own meaning. Running entries and live-side cards have
nothing to pin, so double-click does nothing there.

### Changing section

Picking another section:

1. Writes the target's conditions.
2. For each section **above** the target that the item would still match,
   flips a checkbox condition of that section that the target doesn't fix.
3. If a section above can't be escaped that way (only select conditions the
   target doesn't fix), that section is disabled in the modal; the settings
   warn about it.

Example: Also playing → Lanes writes `status: playing` and unticks `casual`.

Leaving `queue` drops the item's pin and not-before; leaving `lanes` drops its
lane number.

## Freed lanes

When a lane empties, from any source, the view shows a "Lane B is free" bar
with the next pick, two alternatives and Random. Nothing opens by itself.

## Migration

An existing config with `statuses` / `live` is turned into the default
sections above using its own values. `assign` keeps lane numbers only; the
`-1` side-game value is dropped (side games come from a `side` section).
