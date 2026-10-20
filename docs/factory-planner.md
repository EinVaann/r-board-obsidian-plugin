# Factory planner: implementation plan

The ` ```factory ` block (shipped) solves one request in a note. The planner is
a `.factory` file that opens as a full tab: a graph on the left, and Output /
Input / Recipes / Compare tabs on the right, over a shared **recipe book** of
`.table` files. Test vault: `F:/Note/Test Vault` (its `r-board` plugin folder is a junction to this repo and Hot Reload is installed), examples under `Factory Examples/`.

## Data

One `.factory` file holds everything: a **Data** tab (three R Board tables, edited with the
normal table grid, stored inside the file) and a **Planner** tab with one sub-tab per saved
plan (`+` adds one; click the active tab or right-click any tab to rename, duplicate or delete).
File version 2 keeps `plans: [...]` and `active`; version 1 (one plan at the top level) still reads.

| Tab | Holds | Notes |
| --- | --- | --- |
| Recipes | name · machine · time · inputs · outputs (item chips) | first output = main product; typed items register automatically |
| Items | item → transport type | built from the recipes; missing transport is flagged (no silent default) |
| Transport | tiers: name · type · rate (per minute, per lane) | grouped by type |

The Data tab is its own editor (`DataEditor.tsx`, model in `book.ts`), not the `.table` grid. Data saved
by earlier builds as R Board tables is converted on load.

```json
{
  "version": 1,
  "name": "Satisfactory",
  "priority": "output",
  "per": "min",
  "outputs": [{ "item": "Reinforced Iron Plate", "rate": 5 }, { "item": "Screw", "max": 1 }],
  "inputs": [{ "item": "Iron Ore", "mode": "max", "qty": 120 }, { "item": "Iron Ingot", "mode": "free" }],
  "recipes": { "iron ingot": "Pure Iron Ingot" },
  "useUp": ["Heavy Oil Residue"],
  "transport": { "belt": "Belt Mk2" },
  "edges": { "r:Smelter>r:Constructor>iron ingot": "Belt Mk1" },
  "data": {
    "recipes": [{ "id": "r1", "name": "Ingot", "machine": "Smelter", "time": 2, "inputs": [{ "item": "Iron Ore", "qty": 1 }], "outputs": [{ "item": "Iron Ingot", "qty": 1 }] }],
    "items": [{ "name": "Water", "transport": "Pipe" }],
    "transport": [{ "id": "t1", "name": "Belt Mk1", "type": "Belt", "rate": 60 }]
  }
}
```

- `priority`: `output` (rates are delivered; input limits ignored), `input` (as much as the
  limits allow; output numbers are a ratio), `both` (every rule applies).
- `outputs`: a fixed `rate`, or `max` (a ratio weight).
- `inputs`: `free` = ∞, `max` = at most `qty`, `exact` = all of `qty` used. An input also means
  "don't craft this" (recipes making it are dropped, except recycling).
- `recipes`: item key → recipe name. Missing = automatic (each alternative becomes a plan).
- `useUp`: byproducts that must be consumed inside the factory.
- `transport` / `edges`: default tier per transport type / tier per connection. Picking a tier in the
  header (or "Use … for every Belt connection" on an arrow) sets every connection of that type.
- Early files linked their tables (`book`); opening one copies the tables in.

The ```factory``` block can read a `.factory` file's data: `recipes: [[Satisfactory.factory]]`.

## Solver (`src/factory/solve.ts`)

One request model for both the block and the planner:
`{ outputs: Target[], inputs: InputRule[], per, use, avoid, useUp, speed, cost }`.
LP per recipe combination, as today, plus:
- max outputs: `t_i = w_i · z`, maximize `z` (phase 1), then fix it and minimize cost (phase 2);
- input rules: `e ≤ qty` / `e = qty` (no surplus for `exact`);
- `useUp`: no surplus variable for that item.

## Steps

1. ✅ **Solver request model** — several outputs, ratios, input rules, useUp.
2. ✅ **Planner tab** — Output / Input / Recipes tabs, node menu, status bar, priority.
3. **Compare** — per plan: output, machines (built, exact), machines per 1/min output, raw input,
   output per raw, transport lanes; best per row highlighted; rank plans by a row
   (default: fewest built machines).
4. ✅ **Transport** — Items + Transport tables, lanes on edges, tier per type and per connection,
   orange edges and a status warning above one lane.
5. ✅ **One file** — Data tab (three tables) + Planner tab; graph on React Flow + dagre.
6. **Embed** — ```factory``` with `plan: [[X.factory]]` renders the saved plan read-only.

Each step: unit tests, dev harness check (`node dev/build-harness.mjs`, `?factory` / `?planner`),
build, then a test file in the vault.
