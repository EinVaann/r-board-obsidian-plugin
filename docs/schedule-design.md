# Schedule view — design

A view that forecasts a backlog worked through a few items at a time, from
logged time. It suggests what to start next, and re-plans whenever something
is logged, finished, dropped, pinned or reordered. Nothing in it is a deadline:
dates are estimates and move freely.

The example configuration throughout is a game backlog (`Backlog.board` plus
`Backlog timelog.table`), but nothing in the code is game-specific.

## Usage

**Setup (once)**

1. In a board, add a **Schedule** view.
2. Point it at the properties it reads (duration, score, "must vary" property,
   status, live flag, start/end dates) and at a log table (its link, hours,
   date and optional type columns).
3. Set lanes (2), "long" threshold (40 h), week start (Monday), and starting
   estimates for weekly and live hours (used until there is log history).
4. Optionally add similar-value groups, e.g. `JRPG ≈ Visual novel`.

**Day to day**

- After playing, log a session (game, hours, date). Type is inferred.
- Open the view for this week's split and the forecast. It is guidance only.
- Finish or drop a game by changing its status (Kanban, note, or the bar's
  menu). The freed lane offers the next pick, two alternatives and Random.
- Reorder by dragging (pins the item), insert anything between two bars, or
  pin "not before" a date (e.g. a release).

## Data

Nothing new is required in notes beyond what the board already has.

| Read from notes | Example |
|---|---|
| status | `planned` = pool, `playing` = running, `completed`/`dropped` = ended, `on-hold` = paused, others ignored |
| live flag | `live-service: true` + `playing` → live band |
| duration | `play-hours` (estimate) |
| must vary | `genre` |
| rank | `score` |
| start / end dates | `start-date`, `end-date` (filled by auto-dates, below) |

The view only writes `status` (Start / Finish / Drop buttons) and log rows.
The plan itself (pins, inserts, settings) is stored in the view's config in
the `.board` file.

**Log table** (`Backlog timelog.table`): one row per session — a link to the
item's note, hours, date, and an optional **Type**: `lane` / `live` / `detour`
/ `trial`. Only logged hours count; an unlogged week is a week with no play.

## Config

Stored as `ViewConfig.schedule`:

```ts
interface ScheduleConfig {
  log: { file: string; item: string; hours: string; date: string; type?: string };
  duration: string;
  score?: string;
  vary: string;                 // property whose values must not repeat
  similar: string[][];          // groups of values that count as the same
  status: string;
  statuses: { pool: string; active: string; done: string[]; paused: string[] };
  live?: string;                // checkbox property
  startDate?: string;
  endDate?: string;
  lanes: number;                // 2
  longOver: number;             // 40 (hours)
  weekStart: 'mon' | 'sun';     // 'mon'
  estimates: { weekly: number; live: number }; // until history exists
  paceWeeks: number;            // 4
  penalties: { running: number; previous: number; long: number; similarFactor: number }; // 3, 2, 4, 0.5
  pins: { item: string; lane: number; position: number; notBefore?: string }[];
}
```

## Rules

**Conflict.** Two items conflict when they share any value of the `vary`
property, or when one has a value and the other a value in the same `similar`
group (e.g. JRPG next to a visual novel).

Nothing is forbidden. Conflicts are **penalties** subtracted from a candidate's
score, and the lane takes the best `score − penalty` (ties: higher score, then
oldest note). Defaults, configurable as `penalties`:

| Conflict | Penalty |
|---|---|
| shares a value with the item running in another lane | 3 |
| shares a value with the item that just ended in this lane | 2 |
| a similar-group match instead of an exact one | × 0.5 |
| a second item longer than `longOver` beside a long one | 4 |

Each lane entry carries its penalty and the reasons in words, shown as a hint.
Pins and inserts are placed as given; their penalty is shown the same way.

## Engine (`src/schedule/engine.ts`)

A pure function: items, sessions, config and today in; a forecast out. No
Obsidian or React imports, so it is unit-tested directly.

1. **Classify items.** Pool, lane (active, not live), live (active + live),
   side (active, not live, chosen to stay out of lanes), ended, paused.
2. **Classify sessions.** The Type cell if set; otherwise live item → `live`,
   item in a lane on that date → `lane`, anything else → `detour`. `trial` is
   only set by hand.
3. **Remaining** = duration − lane hours logged. Past the estimate: +10% of
   the estimate, marked "past estimate", with no warning.
4. **Pace** (averages over the last `paceWeeks` full weeks, blended with
   `estimates` while history is short):
   lane pace = weekly − live − detour/trial.
5. **Simulate.** Advance to whichever lane frees first; fill it from pins,
   else `pick()`; repeat until the pool is empty. A lane's share of lane pace:
   an item finishing this week gets what it needs, else a long item gets 55%,
   else an even split.
6. **Ranges.** Each date is a range: early = remaining at the current pace;
   late = remaining × overrun at the current pace. Overrun starts at 1.3 and
   becomes the median actual/estimate ratio of finished items once there are
   five or more.
7. **Paused.** A lane item with no logged time for three weeks is flagged ⏸
   (keep / on-hold / drop).

Output: this week (logged hours by type, suggested split of what's left), each
lane's items with start/end ranges and pin / penalty / ⏸ markers, the live band
with average weekly hours per item, and an overall finish range.

## View (`src/views/ScheduleView.tsx`)

- **Week panel**: logged vs. budget by type, suggested split, Log session.
- **Live band**: running live items and their average weekly hours.
- **Lane timeline**: bars with cover and title, labelled with a date range
  (`Dec 18–28`). Drag to reorder (pins); click for Start / Finish / Drop /
  Unpin / Open note; "Insert here" between bars.
- **Next-pick modal** when a lane frees: the next item, two alternatives,
  Random (among the least penalised items), or any item.
- Embeddable in notes with an ```` ```rboard ```` block like other views.

## Build order

**Phase 0 — groundwork** (general features, useful on their own)
1. Auto-dates: board rules like `playing → start-date`,
   `completed, dropped → end-date`; fill only empty dates; triggered by
   `metadataCache` changes comparing the last seen status.
2. `appendTableRow(app, file, cells)` extracted from quick-add, shared by
   quick-add and the schedule view.
3. Link cells in `.table` files follow note renames.
4. `npm run deploy` targets the test vault:
   `Clone-workspace/test/Test Plugin/.obsidian/plugins/r-board/`.

**Phase 1 — engine and tests**, checked against a snapshot of real data.

**Phase 2 — read-only view**: view type wiring (`types.ts`, `config.ts`,
`table/format.ts`, `BoardApp.tsx`), Schedule settings tab, `useLinkedTable()`,
week panel, live band, timeline.

**Phase 3 — interaction**: log form, bar menu, next-pick modal, drag / pin /
insert / not-before, paused and trial prompts.

**Phase 4 — polish**: Playwright tests, phone layout, README section,
suggested chart views on the log, release.
