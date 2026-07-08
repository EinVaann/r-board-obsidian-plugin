# Recipe scaling tokens — spec

A design + implementation plan for scalable recipes in R Board. A recipe is a
plain note; its scalable parts live in a fenced ` ```recipe ` block that the
plugin renders interactively. Amounts and cooking times are written as
**scaling tokens** — a small expression language for "a number that knows how
to scale with the portion count."

This document is the source of truth for the token grammar, resolution
semantics, error handling, and the implementation breakdown. Write the parser
and resolver to match it exactly.

---

## 1. How it fits the plugin

Two independent layers that compose:

1. **A `Recipes` board** (existing feature) — each recipe is a note carrying the
   database's source tag. Frontmatter holds browse/filter/sort fields
   (`cuisine`, `rating`, `total_time`, `cover`). Nothing new here.
2. **An interactive `recipe` code block** (new) — the scalable ingredient list
   and method. Registered via `registerMarkdownCodeBlockProcessor('recipe', …)`
   in `main.ts`, next to the existing `registerView` / `registerExtensions`
   calls. Renders a portions stepper; changing it recomputes every token live.
   No file writes — the chosen portion count is in-memory UI state.

The two never depend on each other. The board browses recipe notes; opening a
note shows its interactive block.

---

## 2. The `recipe` block format

Fenced block, YAML-ish body:

````markdown
```recipe
portions: 2
ingredients:
  - 200 g spaghetti
  - 100 g guanciale
  - 2 egg yolks
  - 1 pinch salt {const}
steps:
  - Boil the pasta for {9 min:const} in salted water.
  - Fry the guanciale for {6 min:sqrt} until crisp.
  - Whisk yolks with pecorino, toss off heat.
```
````

- `portions:` — the recipe's **base / anchor** portion count. Default `1` if
  omitted. This is the anchor every token scales from unless a token overrides
  it with its own `POINT`.
- `ingredients:` — a list. Each line is `VALUE NAME` where the leading `VALUE`
  is a scaling token (bare or braced — see §3.3). The rest is the ingredient
  name, untouched.
- `steps:` — a list of method strings. Any `{…}` inside a step is a scaling
  token (typically a time); the surrounding prose is untouched.

### 2.1 Defaults per section

The section tells us the sensible default so most lines need **no tag**:

- **Ingredient amounts** default to `linear` (almost every ingredient scales
  1:1 with portions).
- **Step times** default to `const` (doubling portions rarely doubles cook
  time). A time is recognised by a duration unit (`sec`, `min`, `hr`, `h`,
  `hour`, `hours`, `minute(s)`, `second(s)`). Tag it `{6 min:sqrt}` or
  `{6 min:linear}` to make it grow.

Everything below is how a token resolves once we have it.

---

## 3. Token grammar

```
TOKEN  = "{" ENTRY ("," ENTRY)* "}"
ENTRY  = VALUE ( ":" TAG )*
VALUE  = number unit?          e.g.  200g   9 min   0.5 tsp   2   1 pan
TAG    = MODE | POINT | ROUND | BOUND
MODE   = "const" | "linear" | "sqrt" | "pow=" k | "step"
POINT  = Np | ">"Np | "<"Np | ">="Np | "<="Np | N"-"M"p"     (p = portions)
ROUND  = "int" | "round" | "round=" step | "ceil" | "floor"
BOUND  = "min=" val | "max=" val
```

- `number` — integer or decimal (`200`, `0.5`, `1.5`).
- `unit` — any run of non-space, non-`:`, non-`,`, non-`}` chars after the
  number (`g`, `min`, `tsp`, `pan`). May be empty (`2` egg yolks).
- `k` in `pow=k` — a decimal exponent.
- `step` in `round=step` — a decimal grid (`round=0.25` snaps to quarters).
- `Np` — portions selector: `2p`, `>3p`, `<=4p`, `2-4p`. `p` is literal.
- `val` in `min=`/`max=` — a `number unit?` in the same unit as VALUE.
- Whitespace around `:` `,` and inside VALUE is insignificant (`9min` == `9 min`).

### 3.1 MODE — how a value scales

Given portions `p` and anchor `a` (the entry's `POINT`, else the block's
`portions:`):

| MODE      | Formula          | Meaning                | Typical use                        |
| --------- | ---------------- | ---------------------- | ---------------------------------- |
| `const`   | `v`              | never changes          | oven temp, resting time, "a pinch" |
| `linear`  | `v · p/a`        | scales 1:1             | almost every ingredient            |
| `sqrt`    | `v · √(p/a)`     | sub-linear             | frying/boiling time, salt, water   |
| `pow=k`   | `v · (p/a)^k`    | custom curve           | anything between (0=const,1=linear)|
| `step`    | see §4           | thresholds, no interp  | pans, trays, "×2 above 6"          |

`const`, `linear`, `sqrt` are named shorthands for `pow=0`, `pow=1`, `pow=0.5`.
`pow=k` is the escape hatch — no new keywords needed for other curves.

### 3.2 POINT — where an entry applies (piecewise)

A `POINT` scopes an entry to a range of portion counts:

| Form     | Matches p when      |
| -------- | ------------------- |
| `Np`     | `p == N` (exact)    |
| `>Np`    | `p > N`             |
| `<Np`    | `p < N`             |
| `>=Np`   | `p >= N`            |
| `<=Np`   | `p <= N`            |
| `N-Mp`   | `N <= p <= M`       |

A single-entry token with one `POINT` treats that point as its **anchor**
(`{200g:2p}` = "200 g at 2 portions", then `linear` by default). Multiple
entries form a **piecewise curve** (§4).

### 3.3 Braced vs. bare

- **Bare** (ingredient lines only): `200 g spaghetti`. The leading
  `number unit` is parsed as a one-entry token with the section default mode.
- **Braced**: `{…}`. Required anywhere inside step prose, and used on
  ingredient lines when you need tags or multiple entries.

Both parse to the same `Token` structure.

---

## 4. Resolution — `resolve(token, p)`

Deterministic and **total**: always returns a number (plus an optional error).
One principle: **most specific match wins; ties break last-wins; anything
ambiguous or unresolvable is flagged** (§5).

A token has one of two shapes, and that decides how a value is produced:

- **Single entry = a formula.** A bare value or an **exact** point scales by its
  MODE (an exact point overrides the anchor, so `{200g:2p}` scales from 2). A
  **bound/range** point is a conditional — it produces a value only where it
  applies, and is unresolvable (→ base + mark) outside its region.
- **Multiple entries = piecewise.** Pointed breakpoints contribute their value
  **literally** (MODE does not re-scale them — a `27min:>=3p` plateau stays 27,
  it is not `27·p/3`). Only the no-POINT **formula** entry scales by its MODE.

To resolve a multi-entry token at `p` portions:

1. **Match.** Collect entries whose `POINT` contains `p`. An entry with no
   `POINT` matches all `p` (lowest priority).
2. **Exactly one match** → the formula entry scales by its MODE (anchored at
   block `portions:`); a pointed breakpoint contributes its literal value.
3. **Several match (overlap)** → pick by the specificity ladder; on a tie, take
   the last in source order **and record a lint error** (§5).
4. **No match (gap)** → interpolate between the nearest defined neighbours
   below and above `p`:
   - both exist → linear interpolation of their values (or hold-lower if the
     token is `step`).
   - only one side → clamp/hold that neighbour (not an error).
   - neither side → **unresolvable**; record a "missing" error (§5).
5. **Post-process** the winning value: apply `ROUND`, then clamp with `BOUND`.

### 4.1 Specificity ladder (overlap tie-break)

Most specific first:

| Rank | POINT kind         | Example          |
| ---- | ------------------ | ---------------- |
| 1    | exact              | `4p`             |
| 2    | range              | `2-4p`           |
| 3    | open bound         | `>=4p`, `<4p`    |
| 4    | no POINT (formula) | `{200g:linear}`  |

Only ties **within the same rank** are conflicts. A higher rank cleanly
beating a lower rank is **not** an error — that is the intended
"formula + override" pattern:

```
{200g:linear, 250g:4p}
```

| p (base 2) | 1   | 2   | 3   | 4       | 5   |
| ---------- | --- | --- | --- | ------- | --- |
| grams      | 100 | 200 | 300 | **250** | 500 |

At 4 portions the exact point (rank 1) overrides the linear formula (rank 4);
everywhere else the formula runs. No mark.

### 4.2 `step` mode

`step` disables interpolation — pick the value of the matching segment as-is.
For non-numeric-ish values (`1 pan` / `2 pans`) this is the only sensible mode:

```
{1 pan:<=4p, 2 pans:>4p:step}
```

### 4.3 Worked examples

Base = 2 portions.

| Token                                   | p=1   | p=2   | p=4   | p=6   |
| --------------------------------------- | ----- | ----- | ----- | ----- |
| `{9 min:const}`                         | 9     | 9     | 9     | 9     |
| `{9 min:linear}`                        | 4.5   | 9     | 18    | 27    |
| `{6 min:sqrt}`                          | 4     | 6     | 8     | 10    |
| `{200g:2p}` (linear default)            | 100   | 200   | 400   | 600   |
| `{2:linear:int}` (eggs)                 | 1     | 2     | 4     | 6     |
| `{9min:1p, 18min:2p, 27min:>=3p}`       | 9     | 18    | 27    | 27    |
| `{1 pan:<=4p, 2 pans:>4p:step}`         | 1 pan | 1 pan | 1 pan | 2 pans|

---

## 5. Errors and the fallback mark

Two outcomes, never a silently-wrong scaled number:

| Outcome      | When                                                                                     | Renders                        |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------ |
| **Clean**    | one match · specificity winner · interpolatable gap                                      | scaled value, no mark          |
| **Fallback** | parse error · unresolvable "missing" (no match, can't interpolate) · lint error (§5.1)   | **base value + error mark**    |

**Base value** = the VALUE exactly as authored, at the anchor portions
(literal `200 g`, unscaled). It is the one figure known to be correct, so it is
the safe fallback. It is deliberately *not* a best-guess linear scale — showing
`200 g` at 4 portions is honestly-wrong-and-flagged; showing a guessed `400 g`
would look right and hide the bug.

### 5.1 What counts as a lint error

- Same-rank overlap tie (two `>=`/`<=`/range/exact selectors matching one `p`).
- Contradictory tags in one entry: two MODEs, two ROUNDs, `min` > `max`, two
  POINTs on one entry. Resolution still proceeds by **last-wins**, but the
  error is recorded.
- Unparseable token (bad number, unknown tag, unbalanced braces).
- Unresolvable "missing": `p` matches nothing and there is no neighbour on one
  side to interpolate from (e.g. only `>=5p` defined, viewing at `p=2`).

### 5.2 The mark

- A small red `⚠` (`alert-triangle` icon) immediately after the value, on the
  **value** not the row, in both reading and editing views.
- Tooltip carries the reason **and** what is shown, e.g.
  *"Can't scale `{200g:<=4p, 300g:>=4p}` — overlapping condition at 4p.
  Showing base (2-portion) amount."*
- A summary strip at the foot of the block lists every error in that recipe
  with its fix hint, so all problems are repairable in one place.
- Resolution is total and deterministic (always a number); the *editing*
  surface carries the friction. Silent-but-wrong is the only disallowed state.

---

## 6. Data model (TypeScript)

```ts
// src/recipe/token.ts

export type Mode =
  | { kind: 'const' }
  | { kind: 'linear' }
  | { kind: 'pow'; k: number }          // sqrt = pow(0.5)
  | { kind: 'step' };

export type Point =
  | { rel: 'eq' | 'gt' | 'lt' | 'gte' | 'lte'; n: number }
  | { rel: 'range'; lo: number; hi: number };

export type Round =
  | { kind: 'none' }
  | { kind: 'int' }
  | { kind: 'nearest'; step: number }   // round / round=<step>
  | { kind: 'ceil' }
  | { kind: 'floor' };

export interface Entry {
  value: number;
  unit: string;                         // '' when none
  mode: Mode;                           // section default already applied at parse
  point: Point | null;                  // null → matches all p (anchor = block)
  round: Round;
  min: number | null;
  max: number | null;
}

export interface Token {
  entries: Entry[];
  raw: string;                          // original source, for the fallback + tooltip
  lint: string[];                       // non-fatal parse issues, surfaced by resolve
}

export interface Resolved {
  value: number;
  unit: string;
  /** Present when the token fell back to its base value; drives the ⚠ mark. */
  error?: { message: string; base: number };
}

export function parseToken(src: string, defaultMode: Mode): Token | { error: string };
export function resolve(token: Token, portions: number, anchor: number): Resolved;
```

`defaultMode` is `linear` for ingredient amounts, `const` for step times
(chosen by the caller from the section + unit detection).

---

## 7. Implementation plan

New directory `src/recipe/`. Order of work, each step independently testable:

1. **`token.ts` — `parseToken()`**
   Tokenise `{…}` / bare source into `Token`. Handle the full grammar (§3),
   whitespace tolerance, and unit capture. Return `{ error }` for unparseable
   input rather than throwing. *Pure; unit-test heavily against §4.3.*

2. **`token.ts` — `resolve()`**
   The §4 algorithm: match → specificity → interpolation/gap → post-process,
   returning `Resolved` with an optional `error`. Encodes the fallback rule
   (§5). *Pure; unit-test the worked examples and every error trigger.*

3. **`parse.ts` — `parseRecipe(source)`**
   Parse the ` ```recipe ` block body into
   `{ portions: number; ingredients: IngredientLine[]; steps: StepLine[] }`.
   Split each ingredient line into `{ token, name }`; scan each step for `{…}`
   tokens with their surrounding text. Pick the default mode per token
   (amounts → linear; times, detected by unit, → const).

4. **`render.ts` — `renderRecipe(el, recipe, plugin)`**
   Build the DOM: header + portions stepper, ingredient table, ordered method
   list. Reuse the `createDiv` / `createSpan` helpers used across
   `src/render/*`. Keep the current portions in a local variable; a stepper
   click re-runs `resolve()` for every token and repaints. Draw the `⚠` mark
   and tooltip when `Resolved.error` is set; render the summary strip.

5. **CSS** — new `styles/NN-recipe.css` (follow the numbered convention in
   `styles/`). Classes: `.rb-recipe`, `.rb-recipe-portions`, `.rb-recipe-ing`,
   `.rb-recipe-steps`, `.rb-token-error` (red `⚠`), `.rb-recipe-errors` (strip).
   Use existing CSS variables (`--text-accent`, `--text-error`/danger,
   `--background-modifier-border`) for light/dark parity.

6. **`main.ts` — registration**
   In `onload()`:
   ```ts
   this.registerMarkdownCodeBlockProcessor('recipe', (source, el) => {
     const recipe = parseRecipe(source);
     renderRecipe(el, recipe, this);
   });
   ```

7. **Docs + README** — add a "Recipes" section to `README.md` linking here.

### 7.1 Non-goals for v1

- No writing scaled amounts back to the note (portions are ephemeral UI state).
- No shopping-list aggregation across recipes.
- No fractional-portion UI beyond what the stepper offers (integer steps first;
  half-portions can come later — `resolve()` already accepts non-integer `p`).

### 7.2 Testing

Pure `parseToken` / `resolve` are the bulk of the risk — cover §4.3 plus one
case per §5.1 error trigger. Rendering is a thin DOM layer over those.
