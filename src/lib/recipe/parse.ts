/**
 * Parse the body of a ```recipe code block into a structured `Recipe`.
 *
 * The format is a small YAML-ish subset (no dependency): a `portions:` line,
 * an `ingredients:` list, and a `steps:` list. Each ingredient line is a
 * scaling token followed by a name; each step is prose with zero or more inline
 * `{…}` tokens. See `docs/recipe-tokens.md` §2.
 */

import { type Mode, parseToken, type Token } from './token';

const LINEAR: Mode = { kind: 'linear' };
const CONST: Mode = { kind: 'const' };

/** Units that mark a token as a duration (→ `const` default, times don't scale). */
const TIME_UNITS = new Set([
  'sec', 'secs', 'second', 'seconds', 's',
  'min', 'mins', 'minute', 'minutes', 'm',
  'hr', 'hrs', 'hour', 'hours', 'h',
]);

/** A parsed token cell: either a usable `token` or a `parseError`, plus its source. */
export interface TokenCell {
  raw: string;
  token: Token | null;
  parseError: string | null;
}

export interface Ingredient {
  /** The scaling token, or null for a static line with no leading number. */
  cell: TokenCell | null;
  /** The ingredient name (everything after the token). */
  name: string;
}

export type StepPart = { kind: 'text'; text: string } | { kind: 'token'; cell: TokenCell };

export interface Step {
  parts: StepPart[];
}

export interface Recipe {
  portions: number;
  ingredients: Ingredient[];
  steps: Step[];
}

/** Build a `TokenCell` from source, picking the section's default mode. */
function makeCell(raw: string, defaultMode: Mode): TokenCell {
  const parsed = parseToken(raw, defaultMode);
  return 'error' in parsed
    ? { raw, token: null, parseError: parsed.error }
    : { raw, token: parsed, parseError: null };
}

/** Default mode for a step token: `const` for a time, else `linear`. */
function stepDefaultMode(tokenSrc: string): Mode {
  const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/.exec(tokenSrc);
  return m && TIME_UNITS.has(m[2].toLowerCase()) ? CONST : LINEAR;
}

/** Parse one ingredient line into its leading token (if any) and name. */
function parseIngredient(line: string): Ingredient {
  const s = line.trim();
  if (s.startsWith('{')) {
    const close = s.indexOf('}');
    if (close !== -1) {
      const raw = s.slice(0, close + 1);
      const name = s.slice(close + 1).trim();
      return { cell: makeCell(raw, LINEAR), name };
    }
  }
  // Bare: a leading number is the token (unit stays in the name, unscaled).
  const m = /^(-?\d+(?:\.\d+)?)(\s+.*)?$/.exec(s);
  if (m) {
    return { cell: makeCell(m[1], LINEAR), name: (m[2] ?? '').trim() };
  }
  return { cell: null, name: s };
}

/** Split a step string into alternating text and `{…}` token parts. */
function parseStep(line: string): Step {
  const parts: StepPart[] = [];
  const re = /\{[^}]*\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', text: line.slice(last, m.index) });
    parts.push({ kind: 'token', cell: makeCell(m[0], stepDefaultMode(m[0])) });
    last = re.lastIndex;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return { parts };
}

/**
 * Extract the inner source of the first ```recipe fenced block from a whole
 * note body (fences stripped), or null if there is none. Used by the Recipe
 * view, which reads notes directly rather than through a code-block processor.
 */
export function extractRecipeBlock(noteBody: string): string | null {
  const m = /`{3,}[ \t]*recipe[^\n]*\n([\s\S]*?)\n[ \t]*`{3,}/.exec(noteBody);
  return m ? m[1] : null;
}

export function parseRecipe(source: string): Recipe {
  const recipe: Recipe = { portions: 1, ingredients: [], steps: [] };
  let section: 'ingredients' | 'steps' | null = null;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') continue;

    const portions = /^\s*portions:\s*(\d+(?:\.\d+)?)/i.exec(line);
    if (portions) {
      recipe.portions = Number(portions[1]);
      section = null;
      continue;
    }
    if (/^\s*ingredients:\s*$/i.test(line)) {
      section = 'ingredients';
      continue;
    }
    if (/^\s*steps:\s*$/i.test(line)) {
      section = 'steps';
      continue;
    }

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && section === 'ingredients') recipe.ingredients.push(parseIngredient(item[1]));
    else if (item && section === 'steps') recipe.steps.push(parseStep(item[1]));
  }

  return recipe;
}
