/**
 * Recipe scaling tokens — parser and resolver.
 *
 * A token is a small expression for "a number that knows how to scale with the
 * portion count", used for ingredient amounts and cooking times in a `recipe`
 * block. See `docs/recipe-tokens.md` for the full grammar and semantics; this
 * module is the source of truth's implementation.
 *
 * Two pure entry points:
 *   - `parseToken(src, defaultMode)` → a `Token`, or `{ error }` if unparseable.
 *   - `resolve(token, portions, anchor)` → the value at that portion count.
 *
 * Resolution is total and deterministic: it always yields a number. Anything
 * ambiguous or unresolvable (§5.1) falls back to the token's base value and
 * sets `Resolved.error`, which the renderer turns into the ⚠ mark.
 */

export type Mode =
  | { kind: 'const' }
  | { kind: 'linear' }
  | { kind: 'pow'; k: number } // sqrt = pow(0.5)
  | { kind: 'step' };

export type Point =
  | { rel: 'eq' | 'gt' | 'lt' | 'gte' | 'lte'; n: number }
  | { rel: 'range'; lo: number; hi: number };

export type Round =
  | { kind: 'none' }
  | { kind: 'int' }
  | { kind: 'nearest'; step: number } // round / round=<step>
  | { kind: 'ceil' }
  | { kind: 'floor' };

export interface Entry {
  value: number;
  unit: string; // '' when none
  mode: Mode; // section default already applied at parse time
  point: Point | null; // null → matches all portions (anchor = block portions)
  round: Round;
  min: number | null;
  max: number | null;
}

export interface Token {
  entries: Entry[];
  raw: string; // original source, for the fallback value + tooltip
  /** Non-fatal problems found at parse time (§5.1); surfaced by `resolve`. */
  lint: string[];
}

export interface Resolved {
  value: number;
  unit: string;
  /** Present when the token fell back to its base value; drives the ⚠ mark. */
  error?: { message: string; base: number };
}

/** `resolve` and `parseToken` share these named-mode shorthands. */
const NAMED_MODES: Record<string, Mode> = {
  const: { kind: 'const' },
  linear: { kind: 'linear' },
  sqrt: { kind: 'pow', k: 0.5 },
  step: { kind: 'step' },
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a token string into a `Token`. `defaultMode` is the section default
 * (linear for amounts, const for times) used for entries with no explicit mode.
 * Returns `{ error }` only for structurally unusable input (no numeric value,
 * unbalanced braces); recoverable issues become `token.lint`.
 */
export function parseToken(src: string, defaultMode: Mode): Token | { error: string } {
  const trimmed = src.trim();
  const hasOpen = trimmed.startsWith('{');
  const hasClose = trimmed.endsWith('}');
  if (hasOpen !== hasClose) return { error: 'Unbalanced braces' };
  const inner = hasOpen ? trimmed.slice(1, -1) : trimmed;

  const lint: string[] = [];
  const entries: Entry[] = [];
  for (const raw of splitTop(inner)) {
    const part = raw.trim();
    if (part === '') return { error: 'Empty entry' };
    const entry = parseEntry(part, defaultMode, lint);
    if ('error' in entry) return entry;
    entries.push(entry);
  }
  if (entries.length === 0) return { error: 'Empty token' };

  return { entries, raw: trimmed, lint };
}

/** Split on top-level commas (tokens have no nesting, so a plain split works). */
function splitTop(s: string): string[] {
  return s.split(',');
}

function parseEntry(
  src: string,
  defaultMode: Mode,
  lint: string[],
): Entry | { error: string } {
  const [valuePart, ...tagParts] = src.split(':');
  const value = parseValue(valuePart.trim());
  if ('error' in value) return value;

  let mode: Mode | null = null;
  let point: Point | null = null;
  let round: Round = { kind: 'none' };
  let min: number | null = null;
  let max: number | null = null;

  for (const rawTag of tagParts) {
    const tag = rawTag.trim();
    if (tag === '') continue;

    const m = parseMode(tag);
    if (m) {
      if (mode) lint.push(`multiple modes in "${src.trim()}" — using last`);
      mode = m;
      continue;
    }
    const p = parsePoint(tag);
    if (p) {
      if (point) lint.push(`multiple conditions in "${src.trim()}" — using last`);
      point = p;
      continue;
    }
    const r = parseRound(tag);
    if (r) {
      if (round.kind !== 'none') lint.push(`multiple rounding in "${src.trim()}" — using last`);
      round = r;
      continue;
    }
    const b = parseBound(tag);
    if (b) {
      if (b.which === 'min') min = b.n;
      else max = b.n;
      continue;
    }
    lint.push(`unknown tag "${tag}" — ignored`);
  }

  if (min !== null && max !== null && min > max) {
    lint.push(`min ${min} exceeds max ${max} — both ignored`);
    min = null;
    max = null;
  }

  return {
    value: value.n,
    unit: value.unit,
    mode: mode ?? defaultMode,
    point,
    round,
    min,
    max,
  };
}

function parseValue(src: string): { n: number; unit: string } | { error: string } {
  const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(src);
  if (!m) return { error: `No numeric value in "${src}"` };
  return { n: Number(m[1]), unit: m[2].trim() };
}

function parseMode(tag: string): Mode | null {
  if (tag in NAMED_MODES) return NAMED_MODES[tag];
  const m = /^pow=(-?\d+(?:\.\d+)?)$/.exec(tag);
  return m ? { kind: 'pow', k: Number(m[1]) } : null;
}

function parsePoint(tag: string): Point | null {
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)p$/.exec(tag);
  if (range) return { rel: 'range', lo: Number(range[1]), hi: Number(range[2]) };
  const rel = /^(>=|<=|>|<)?(\d+(?:\.\d+)?)p$/.exec(tag);
  if (!rel) return null;
  const n = Number(rel[2]);
  switch (rel[1]) {
    case '>':
      return { rel: 'gt', n };
    case '<':
      return { rel: 'lt', n };
    case '>=':
      return { rel: 'gte', n };
    case '<=':
      return { rel: 'lte', n };
    default:
      return { rel: 'eq', n };
  }
}

function parseRound(tag: string): Round | null {
  if (tag === 'int') return { kind: 'int' };
  if (tag === 'round') return { kind: 'nearest', step: 1 };
  if (tag === 'ceil') return { kind: 'ceil' };
  if (tag === 'floor') return { kind: 'floor' };
  const m = /^round=(\d+(?:\.\d+)?)$/.exec(tag);
  return m ? { kind: 'nearest', step: Number(m[1]) } : null;
}

function parseBound(tag: string): { which: 'min' | 'max'; n: number } | null {
  const m = /^(min|max)=\s*(-?\d+(?:\.\d+)?)/.exec(tag);
  return m ? { which: m[1] as 'min' | 'max', n: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a token at `portions`, anchored to `anchor` (the block's base
 * portions). Returns the scaled value; on any lint or unresolvable condition,
 * returns the token's base value with an `error` set (§5).
 *
 * Two shapes of token:
 *   - a **single entry** is a formula: a bare value or exact point scales by its
 *     mode (the exact point overriding the anchor); a bound/range is a
 *     conditional that leaves the value undefined outside its region.
 *   - **multiple entries** are piecewise: pointed breakpoints contribute their
 *     value literally, only the no-point formula entry scales, and gaps between
 *     points interpolate.
 */
export function resolve(token: Token, portions: number, anchor: number): Resolved {
  const base = token.entries[0];
  const baseValue = base.value;
  const fail = (msg: string, extra: string[] = []): Resolved => ({
    value: baseValue,
    unit: base.unit,
    error: { message: [...token.lint, msg, ...extra].filter(Boolean).join('; '), base: baseValue },
  });

  // Any parse-time lint already means "show base value + mark" (§5).
  const preLint = token.lint.length > 0;
  const ok = (value: number, unit: string): Resolved =>
    preLint ? fail('') : { value, unit };

  // Single entry → formula.
  if (token.entries.length === 1) {
    if (base.point === null || base.point.rel === 'eq') {
      const a = base.point ? base.point.n : anchor;
      return ok(applyPost(base, scaleByMode(base, portions, a)), base.unit);
    }
    if (pointMatches(base.point, portions)) return ok(applyPost(base, base.value), base.unit);
    return fail(`no rule matches ${portions}p`);
  }

  // Multiple entries → piecewise.
  const matches = token.entries.filter((e) => pointMatches(e.point, portions));
  const conflicts: string[] = [];

  if (matches.length >= 1) {
    const rank = (e: Entry) => specificity(e.point);
    const best = Math.min(...matches.map(rank));
    const top = matches.filter((e) => rank(e) === best);
    if (top.length > 1) conflicts.push(`overlapping condition at ${portions}p`);
    const chosen = top[top.length - 1]; // tie → last wins
    if (preLint || conflicts.length > 0) return fail('', conflicts);
    return { value: matchedValue(chosen, portions, anchor), unit: chosen.unit };
  }

  // Gap: interpolate between nearest neighbours (§4 step 4).
  const gap = interpolate(token, portions, anchor);
  if (!gap) return fail(`no rule matches ${portions}p`);
  return ok(gap.value, gap.unit);
}

/** A matched piecewise entry's value: the formula entry scales, a breakpoint is literal. */
function matchedValue(entry: Entry, p: number, blockAnchor: number): number {
  const raw = entry.point === null ? scaleByMode(entry, p, blockAnchor) : entry.value;
  return applyPost(entry, raw);
}

/** True when `point` (null = always) admits `p`. */
function pointMatches(point: Point | null, p: number): boolean {
  if (!point) return true;
  switch (point.rel) {
    case 'eq':
      return p === point.n;
    case 'gt':
      return p > point.n;
    case 'lt':
      return p < point.n;
    case 'gte':
      return p >= point.n;
    case 'lte':
      return p <= point.n;
    case 'range':
      return p >= point.lo && p <= point.hi;
  }
}

/** Specificity rank (lower = more specific): exact < range < bound < formula. */
function specificity(point: Point | null): number {
  if (!point) return 4;
  if (point.rel === 'eq') return 1;
  if (point.rel === 'range') return 2;
  return 3;
}

/** Scale an entry's value by its mode against anchor `a`. */
function scaleByMode(entry: Entry, p: number, a: number): number {
  const ratio = a === 0 ? 1 : p / a;
  switch (entry.mode.kind) {
    case 'const':
    case 'step':
      return entry.value;
    case 'linear':
      return entry.value * ratio;
    case 'pow':
      return entry.value * Math.pow(ratio, entry.mode.k);
  }
}

/** The portion an entry's point anchors scaling to. */
function anchorOf(point: Point): number {
  return point.rel === 'range' ? point.lo : point.n;
}

/** Apply ROUND then BOUND to a scaled value. */
function applyPost(entry: Entry, v: number): number {
  let out = v;
  switch (entry.round.kind) {
    case 'int':
      out = Math.round(out);
      break;
    case 'nearest':
      out = Math.round(out / entry.round.step) * entry.round.step;
      break;
    case 'ceil':
      out = Math.ceil(out);
      break;
    case 'floor':
      out = Math.floor(out);
      break;
    case 'none':
      break;
  }
  if (entry.min !== null) out = Math.max(out, entry.min);
  if (entry.max !== null) out = Math.min(out, entry.max);
  return out;
}

/** A concrete (portion, value) reference for an entry, used as a gap neighbour. */
function reference(entry: Entry): { p: number; value: number } | null {
  if (!entry.point) return null; // a formula would have matched — no gap
  const p = anchorOf(entry.point);
  return { p, value: applyPost(entry, entry.value) }; // breakpoints are literal
}

/** Interpolate (or hold) between the nearest defined points around `p`. */
function interpolate(
  token: Token,
  p: number,
  _anchor: number,
): { value: number; unit: string } | null {
  const isStep = token.entries.some((e) => e.mode.kind === 'step');
  const refs = token.entries
    .map((e) => ({ e, r: reference(e) }))
    .filter((x): x is { e: Entry; r: { p: number; value: number } } => x.r !== null);

  let below: { e: Entry; r: { p: number; value: number } } | null = null;
  let above: { e: Entry; r: { p: number; value: number } } | null = null;
  for (const x of refs) {
    if (x.r.p <= p && (!below || x.r.p > below.r.p)) below = x;
    if (x.r.p >= p && (!above || x.r.p < above.r.p)) above = x;
  }

  if (below && above) {
    if (isStep || below.r.p === above.r.p) return { value: below.r.value, unit: below.e.unit };
    const t = (p - below.r.p) / (above.r.p - below.r.p);
    return { value: below.r.value + t * (above.r.value - below.r.value), unit: below.e.unit };
  }
  if (below) return { value: below.r.value, unit: below.e.unit };
  if (above) return { value: above.r.value, unit: above.e.unit };
  return null;
}
