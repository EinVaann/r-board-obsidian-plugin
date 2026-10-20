/**
 * The ```factory block and its recipes. A block names a recipe source (a
 * `.table` file and/or inline `recipe:` lines), what to make and at what rate,
 * or what input rate to work from. See README → Factory planner.
 */

import type { PropertyConfig, TableRow } from '../types';

export interface Amount {
  item: string;
  qty: number;
}

export interface FactoryRecipe {
  name: string;
  machine: string;
  /** Seconds per craft. */
  time: number;
  inputs: Amount[];
  /** The first output is the recipe's main product; the rest are byproducts. */
  outputs: Amount[];
}

export type Per = 'sec' | 'min' | 'hour';
export const PER_SECONDS: Record<Per, number> = { sec: 1, min: 60, hour: 3600 };

export interface FactorySpec {
  /** A `.table` file holding recipes (link or path). */
  file?: string;
  /** `.table` files mapping items to transport types, and transport tiers. */
  itemsFile?: string;
  transportFile?: string;
  /** Default tier names (one per transport type), e.g. "Belt Mk2". */
  tiers: string[];
  /** Recipes written in the block itself. */
  recipes: FactoryRecipe[];
  /** The item to make. */
  make: string;
  /** Output rate of `make` (output mode). */
  rate?: number;
  /** Input mode: this much of `input.item` is available; make as much as it allows. */
  input?: Amount;
  per: Per;
  /** Items bought / mined rather than crafted, even if a recipe makes them. */
  raw: string[];
  /** Recipe names to always use for their main product. */
  use: string[];
  /** Recipe names never to use. */
  avoid: string[];
  /** Crafting speed per machine (1 = the recipe's time). */
  speed: Record<string, number>;
  /** Weight of each raw item when ranking plans (default 1). */
  cost: Record<string, number>;
  height?: number;
  /** Problems found while parsing. */
  errors: string[];
}

/** Item key: case- and space-insensitive. */
export const itemKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

const PER_ALIASES: Record<string, Per> = {
  s: 'sec', sec: 'sec', secs: 'sec', second: 'sec', seconds: 'sec',
  m: 'min', min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
};

/** "60 Iron Plate/min" → { qty: 60, item: "Iron Plate", per: "min" }. The number is optional. */
export function parseRate(text: string): { qty?: number; item: string; per?: Per } {
  let t = text.trim();
  let per: Per | undefined;
  const m = /\s*\/\s*([a-z]+)\s*$/i.exec(t);
  if (m && PER_ALIASES[m[1].toLowerCase()]) {
    per = PER_ALIASES[m[1].toLowerCase()];
    t = t.slice(0, m.index).trim();
  }
  const n = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:x|×)?\s+(.+)$/i.exec(t);
  return n ? { qty: Number(n[1]), item: n[2].trim(), per } : { item: t, per };
}

/** "3 Iron Ingot, 1 Water" (also "3x Iron Ingot", "Iron Ingot x3", "+" or new lines) → amounts. */
export function parseAmounts(value: unknown): Amount[] {
  const text = Array.isArray(value) ? value.map(String).join(',') : value == null ? '' : String(value);
  const out: Amount[] = [];
  for (const part of text.split(/[,;\n]|\s\+\s/)) {
    const p = part.trim();
    if (!p) continue;
    const lead = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:x|×)?\s+(.+)$/i.exec(p);
    const tail = /^(.+?)\s+(?:x|×)\s*(\d+(?:\.\d+)?)$/i.exec(p);
    if (lead) out.push({ item: lead[2].trim(), qty: Number(lead[1]) });
    else if (tail) out.push({ item: tail[1].trim(), qty: Number(tail[2]) });
    else out.push({ item: p, qty: 1 });
  }
  return out.filter((a) => a.qty > 0);
}

/** "6", "6s", "1.5 min", "2h" → seconds. */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number') return value > 0 ? value : null;
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)\s*$/i.exec(String(value ?? ''));
  if (!m) return null;
  const per = m[2] ? PER_ALIASES[m[2].toLowerCase()] : 'sec';
  if (!per) return null;
  const s = Number(m[1]) * PER_SECONDS[per];
  return s > 0 ? s : null;
}

/** "Assembler = 1.5" / "Assembler: 1.5" / "Assembler 1.5" → [name, number]. */
function parseNamedNumber(text: string): [string, number] | null {
  const m = /^(.+?)\s*[=:]?\s*(\d+(?:\.\d+)?|\.\d+)\s*$/.exec(text.trim());
  return m ? [m[1].trim(), Number(m[2])] : null;
}

const unlink = (v: string): string => v.replace(/^\[\[|\]\]$/g, '').trim();

const list = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);

/** Parse the body of a ```factory block. */
export function parseFactory(source: string): FactorySpec {
  const spec: FactorySpec = { recipes: [], make: '', per: 'min', raw: [], use: [], avoid: [], speed: {}, cost: {}, tiers: [], errors: [] };
  let perSet = false;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      spec.errors.push(`Not understood: "${line}"`);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    switch (key) {
      case 'recipes':
      case 'file':
        spec.file = unlink(value);
        break;
      case 'items':
        spec.itemsFile = unlink(value);
        break;
      case 'transport':
        spec.transportFile = unlink(value);
        break;
      case 'tier':
      case 'tiers':
        spec.tiers.push(...list(value));
        break;
      case 'make':
      case 'target':
      case 'output': {
        const r = parseRate(value);
        spec.make = r.item;
        if (r.qty !== undefined) spec.rate = r.qty;
        if (r.per && !perSet) spec.per = r.per;
        break;
      }
      case 'input': {
        const r = parseRate(value);
        if (r.qty === undefined) spec.errors.push(`input: needs a rate, e.g. "input: 120 ${r.item || 'Iron Ore'}"`);
        else spec.input = { item: r.item, qty: r.qty };
        if (r.per && !perSet) spec.per = r.per;
        break;
      }
      case 'per': {
        const p = PER_ALIASES[value.toLowerCase()];
        if (p) {
          spec.per = p;
          perSet = true;
        } else spec.errors.push(`per: should be sec, min or hour (got "${value}")`);
        break;
      }
      case 'raw':
        spec.raw.push(...list(value));
        break;
      case 'use':
        spec.use.push(...list(value));
        break;
      case 'avoid':
        spec.avoid.push(...list(value));
        break;
      case 'speed':
      case 'cost':
        for (const part of list(value)) {
          const nn = parseNamedNumber(part);
          if (nn) spec[key][itemKey(nn[0])] = nn[1];
          else spec.errors.push(`${key}: expected "Name = number" (got "${part}")`);
        }
        break;
      case 'height': {
        const h = Number(value);
        if (h > 0) spec.height = h;
        break;
      }
      case 'recipe': {
        const r = parseInlineRecipe(value);
        if (typeof r === 'string') spec.errors.push(r);
        else spec.recipes.push(r);
        break;
      }
      default:
        spec.errors.push(`Unknown setting "${m[1]}:"`);
    }
  }
  if (!spec.make) spec.errors.push('Add a "make:" line, e.g. "make: 60 Iron Plate".');
  else if (spec.rate === undefined && !spec.input) spec.errors.push(`Give a rate: "make: 60 ${spec.make}", or an "input:" line.`);
  if (!spec.file && !spec.recipes.length) spec.errors.push('Add a "recipes:" line naming a .table file, or "recipe:" lines.');
  return spec;
}

/** `name | machine | time | inputs | outputs` */
export function parseInlineRecipe(text: string): FactoryRecipe | string {
  const f = text.split('|').map((s) => s.trim());
  if (f.length !== 5) return `recipe: needs 5 parts "name | machine | time | inputs | outputs" (got "${text}")`;
  return toRecipe(f[0], f[1], f[2], f[3], f[4]);
}

function toRecipe(name: string, machine: unknown, time: unknown, inputs: unknown, outputs: unknown): FactoryRecipe | string {
  const outs = parseAmounts(outputs);
  const label = name || outs[0]?.item || 'recipe';
  if (!outs.length) return `Recipe "${label}" has no outputs.`;
  const secs = parseDuration(time);
  if (secs === null) return `Recipe "${label}": time "${String(time ?? '')}" is not a duration (e.g. 6, 6s, 1.5 min).`;
  return { name: label, machine: String(machine ?? '').trim() || 'Machine', time: secs, inputs: parseAmounts(inputs), outputs: outs };
}

const COLUMN_NAMES = {
  name: ['recipe', 'name', 'title'],
  machine: ['machine', 'building', 'machines', 'factory'],
  time: ['time', 'time (s)', 'seconds', 'duration', 'craft time', 'processing time'],
  inputs: ['inputs', 'input', 'ingredients', 'consumes'],
  outputs: ['outputs', 'output', 'products', 'product', 'produces', 'result'],
};

/** Recipes from `.table` rows: columns are matched by label or key (Recipe, Machine, Time, Inputs, Outputs). */
export function recipesFromTable(properties: PropertyConfig[], rows: TableRow[], titleProperty?: string): { recipes: FactoryRecipe[]; errors: string[] } {
  const find = (names: string[]): PropertyConfig | undefined =>
    properties.find((p) => names.includes((p.label ?? p.name).trim().toLowerCase())) ?? properties.find((p) => names.includes(p.name.toLowerCase()));
  const col = {
    name: find(COLUMN_NAMES.name) ?? properties.find((p) => p.name === titleProperty),
    machine: find(COLUMN_NAMES.machine),
    time: find(COLUMN_NAMES.time),
    inputs: find(COLUMN_NAMES.inputs),
    outputs: find(COLUMN_NAMES.outputs),
  };
  const missing = (['time', 'outputs'] as const).filter((k) => !col[k]);
  if (missing.length) {
    return { recipes: [], errors: [`The recipe table needs ${missing.map((k) => `a "${k[0].toUpperCase()}${k.slice(1)}"`).join(' and ')} column.`] };
  }
  // Select cells store option values; show their labels.
  const cell = (p: PropertyConfig | undefined, row: TableRow): unknown => {
    if (!p) return undefined;
    const v = row.cells[p.name];
    if (!p.options?.length) return v;
    const label = (x: unknown): unknown => p.options!.find((o) => o.value === x)?.label ?? x;
    return Array.isArray(v) ? v.map(label) : label(v);
  };
  const recipes: FactoryRecipe[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    if (row.cells[col.outputs!.name] == null && row.cells[col.time!.name] == null) continue;
    const r = toRecipe(String(cell(col.name, row) ?? '').trim(), cell(col.machine, row), cell(col.time, row), cell(col.inputs, row), cell(col.outputs, row));
    if (typeof r === 'string') errors.push(r);
    else recipes.push(r);
  }
  return { recipes, errors };
}

// ---------------------------------------------------------------- transport tables

export interface TransportTier {
  name: string;
  /** e.g. "Belt", "Pipe". */
  type: string;
  /** Items per minute one lane carries. */
  rate: number;
}

const findColumn = (properties: PropertyConfig[], names: string[]): PropertyConfig | undefined =>
  properties.find((p) => names.includes((p.label ?? p.name).trim().toLowerCase())) ?? properties.find((p) => names.includes(p.name.toLowerCase()));

/** A cell as text, select values shown by their labels. */
function cellText(p: PropertyConfig | undefined, row: TableRow): string {
  if (!p) return '';
  const v = row.cells[p.name];
  const label = (x: unknown): string => String(p.options?.find((o) => o.value === x)?.label ?? x ?? '');
  return (Array.isArray(v) ? v.map(label).join(', ') : label(v)).trim();
}

/** Items table: Item · Transport (a transport type). Item key → type. */
export function itemsFromTable(properties: PropertyConfig[], rows: TableRow[], titleProperty?: string): { types: Map<string, string>; errors: string[] } {
  const item = findColumn(properties, ['item', 'name', 'title']) ?? properties.find((p) => p.name === titleProperty);
  const type = findColumn(properties, ['transport', 'type', 'transport type', 'carrier']);
  if (!item || !type) return { types: new Map(), errors: ['The items table needs an "Item" and a "Transport" column.'] };
  const types = new Map<string, string>();
  for (const row of rows) {
    const i = cellText(item, row);
    const t = cellText(type, row);
    if (i && t) types.set(itemKey(i), t);
  }
  return { types, errors: [] };
}

/** Transport table: Name · Type · Rate (per minute; "13/s" and "780/min" also work). */
export function transportFromTable(properties: PropertyConfig[], rows: TableRow[], titleProperty?: string): { tiers: TransportTier[]; errors: string[] } {
  const name = findColumn(properties, ['name', 'tier']) ?? properties.find((p) => p.name === titleProperty);
  const type = findColumn(properties, ['type', 'kind', 'transport type', 'transport']);
  const rate = findColumn(properties, ['rate', 'capacity', 'speed', 'throughput', 'rate (/min)']);
  if (!name || !type || !rate) return { tiers: [], errors: ['The transport table needs "Name", "Type" and "Rate" columns.'] };
  const tiers: TransportTier[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    const n = cellText(name, row);
    if (!n) continue;
    const raw = row.cells[rate.name];
    let perMin: number | null = typeof raw === 'number' ? raw : null;
    if (perMin === null) {
      const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:\/\s*([a-z]+))?\s*$/i.exec(String(raw ?? ''));
      const per = m?.[2] ? PER_ALIASES[m[2].toLowerCase()] : 'min';
      perMin = m && per ? (Number(m[1]) * 60) / PER_SECONDS[per] : null;
    }
    if (!perMin || perMin <= 0) errors.push(`Transport "${n}": rate "${String(raw ?? '')}" is not a number per minute.`);
    else tiers.push({ name: n, type: cellText(type, row) || 'Belt', rate: perMin });
  }
  return { tiers, errors };
}
