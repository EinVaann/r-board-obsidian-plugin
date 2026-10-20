/**
 * The `.factory` file: a data set (Recipes, Items and Transport tables) and
 * any number of plans over it. JSON, like `.board`. See
 * docs/factory-planner.md.
 */

import { itemKey, PER_SECONDS, type Per } from './parse';
import type { FactoryRequest, InputRule, Target } from './solve';
import { dataJson, newData, parseData, type DataTab, type FactoryData } from './book';
import { itemType, type TransportBook } from './transport';

export const FACTORY_EXTENSION = 'factory';

/**
 * Which rules drive the plan: the output rates (input limits ignored), the
 * input limits (outputs maximised, their numbers a ratio), or both at once.
 */
export type Priority = 'output' | 'input' | 'both';

/** One saved plan. */
export interface PlanSpec {
  name: string;
  priority: Priority;
  per: Per;
  outputs: Target[];
  inputs: InputRule[];
  /** Item key → the recipe to use for it. Missing: automatic. */
  recipes: Record<string, string>;
  /** Byproducts that must be consumed inside the factory. */
  useUp: string[];
  /** Transport type key → default tier name. */
  transport: Record<string, string>;
  /** Connection key (see `haulKey`) → tier name. */
  edges: Record<string, string>;
}

/** The whole file. */
export interface FactoryDoc {
  data: FactoryData;
  plans: PlanSpec[];
  /** Index of the plan shown in the Planner tab. */
  active: number;
}

/** What the planner edits: one plan together with the shared data. */
export type FactoryFile = PlanSpec & { data: FactoryData };

export function newPlan(name = 'Plan 1'): PlanSpec {
  return { name, priority: 'output', per: 'min', outputs: [], inputs: [], recipes: {}, useUp: [], transport: {}, edges: {} };
}

export function newFactoryFile(data: FactoryData = newData()): FactoryFile {
  return { ...newPlan(), data };
}

export function newFactoryDoc(): FactoryDoc {
  return { data: newData(), plans: [newPlan()], active: 0 };
}

/** The active plan with the data, for the planner. */
export function docView(doc: FactoryDoc): FactoryFile {
  return { ...doc.plans[Math.min(doc.active, doc.plans.length - 1)], data: doc.data };
}

/** Write the planner's edit back into the file. */
export function applyView(doc: FactoryDoc, view: FactoryFile): FactoryDoc {
  const { data, ...plan } = view;
  const plans = [...doc.plans];
  plans[Math.min(doc.active, plans.length - 1)] = plan;
  return { ...doc, data, plans };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** An object of string values, keys normalised by `key`. */
const strings = (v: unknown, key: (k: string) => string): Record<string, string> =>
  Object.fromEntries(Object.entries(rec(v)).filter(([, x]) => str(x)).map(([k, x]) => [key(k), str(x)]));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parsePlan(o: Record<string, unknown>, fallbackName: string): PlanSpec {
  const per = str(o.per);
  return {
    name: str(o.name).trim() || fallbackName,
    priority: o.priority === 'input' || o.priority === 'both' ? o.priority : 'output',
    per: per in PER_SECONDS ? (per as Per) : 'min',
    outputs: arr(o.outputs)
      .map(rec)
      .filter((x) => str(x.item))
      .map((x) => (num(x.max) !== undefined ? { item: str(x.item), max: num(x.max) } : { item: str(x.item), rate: num(x.rate) ?? 0 })),
    inputs: arr(o.inputs)
      .map(rec)
      .filter((x) => str(x.item))
      .map((x) => {
        const mode = x.mode === 'max' || x.mode === 'exact' ? x.mode : 'free';
        return mode === 'free' ? { item: str(x.item), mode } : { item: str(x.item), mode, qty: num(x.qty) ?? 0 };
      }),
    recipes: strings(o.recipes, itemKey),
    useUp: arr(o.useUp).map(str).filter(Boolean),
    transport: strings(o.transport, itemKey),
    edges: strings(o.edges, (k) => k),
  };
}

/** An early `.factory` linked its tables (`book`) instead of holding them; the view copies them in. */
export type LegacyBook = Partial<Record<DataTab, string>>;

export function parseFactoryDoc(text: string): { ok: true; doc: FactoryDoc; legacy?: LegacyBook } | { ok: false; error: string } {
  const t = text.trim();
  if (t === '' || t === '{}') return { ok: true, doc: newFactoryDoc() };
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const o = rec(json);
  const data = rec(o.data);
  // Version 1 kept a single plan at the top level.
  const rawPlans = Array.isArray(o.plans) ? o.plans.map(rec) : [o];
  const plans = rawPlans.map((p, i) => parsePlan(p, `Plan ${i + 1}`));
  if (!plans.length) plans.push(newPlan());
  const active = Math.max(0, Math.min(plans.length - 1, Math.floor(num(o.active) ?? 0)));
  const doc: FactoryDoc = {
    data: parseData(data),
    plans,
    active,
  };
  const book = rec(o.book);
  const legacy = o.data ? undefined : (Object.fromEntries((['recipes', 'items', 'transport'] as DataTab[]).map((key) => [key, str(book[key])]).filter(([, v]) => v)) as LegacyBook);
  return legacy && Object.keys(legacy).length ? { ok: true, doc, legacy } : { ok: true, doc };
}

function planJson(p: PlanSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { name: p.name, priority: p.priority, per: p.per, outputs: p.outputs, inputs: p.inputs, recipes: p.recipes, useUp: p.useUp };
  if (Object.keys(p.transport).length) out.transport = p.transport;
  if (Object.keys(p.edges).length) out.edges = p.edges;
  return out;
}

export function serializeFactoryDoc(doc: FactoryDoc): string {
  const out = {
    version: 2,
    active: doc.active,
    plans: doc.plans.map(planJson),
    data: dataJson(doc.data),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

// ---------------------------------------------------------------- plan list (pure)

/** A name not used by another plan: the name itself, or "Iron line (2)". */
export function freeName(doc: FactoryDoc, base: string): string {
  const taken = new Set(doc.plans.map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}

export function addPlan(doc: FactoryDoc): FactoryDoc {
  const cur = doc.plans[doc.active];
  let n = doc.plans.length + 1;
  while (doc.plans.some((p) => p.name.toLowerCase() === `plan ${n}`)) n++;
  // A new plan keeps the rate unit and transport tiers; the request starts empty.
  const plan = { ...newPlan(`Plan ${n}`), per: cur?.per ?? 'min', transport: { ...(cur?.transport ?? {}) } };
  return { ...doc, plans: [...doc.plans, plan], active: doc.plans.length };
}

export function duplicatePlan(doc: FactoryDoc, i: number): FactoryDoc {
  const src = doc.plans[i];
  if (!src) return doc;
  const copy: PlanSpec = JSON.parse(JSON.stringify(src));
  copy.name = freeName(doc, src.name);
  const plans = [...doc.plans];
  plans.splice(i + 1, 0, copy);
  return { ...doc, plans, active: i + 1 };
}

export function renamePlan(doc: FactoryDoc, i: number, name: string): FactoryDoc {
  const n = name.trim();
  if (!n || !doc.plans[i]) return doc;
  const plans = [...doc.plans];
  plans[i] = { ...plans[i], name: n };
  return { ...doc, plans };
}

/** Delete a plan; the last one can't go (it is emptied instead). */
export function deletePlan(doc: FactoryDoc, i: number): FactoryDoc {
  if (doc.plans.length <= 1) return { ...doc, plans: [newPlan(doc.plans[0]?.name)], active: 0 };
  const plans = doc.plans.filter((_, j) => j !== i);
  const active = doc.active > i ? doc.active - 1 : Math.min(doc.active, plans.length - 1);
  return { ...doc, plans, active };
}

export function toRequest(f: FactoryFile): FactoryRequest {
  let { outputs, inputs } = f;
  if (f.priority === 'output') {
    // Outputs rule: every output is a rate; inputs only mean "bring this in", unlimited.
    outputs = outputs.map((o) => (o.max !== undefined ? { item: o.item, rate: o.max } : o));
    inputs = inputs.map((i) => ({ item: i.item, mode: 'free' }));
  } else if (f.priority === 'input') {
    // Inputs rule: make as much as they allow, outputs in the ratio of their numbers.
    outputs = outputs.map((o) => ({ item: o.item, max: o.max ?? o.rate ?? 1 }));
  }
  return { outputs, inputs, per: f.per, use: Object.values(f.recipes), avoid: [], useUp: f.useUp, speed: {}, cost: {} };
}

// ---------------------------------------------------------------- edits (pure: return a new file)

const sameItem = (a: string, b: string): boolean => itemKey(a) === itemKey(b);

/** Bring an item in instead of crafting it (an unlimited input), dropping it as an output. */
export function bringIn(f: FactoryFile, item: string): FactoryFile {
  if (f.inputs.some((i) => sameItem(i.item, item))) return f;
  return { ...f, inputs: [...f.inputs, { item, mode: 'free' }], outputs: f.outputs.filter((o) => !sameItem(o.item, item)) };
}

/** Craft an item again: remove its input rule. */
export function craftInstead(f: FactoryFile, item: string): FactoryFile {
  return { ...f, inputs: f.inputs.filter((i) => !sameItem(i.item, item)) };
}

/** Set (or clear, with null) the input rule for an item. */
export function setInput(f: FactoryFile, item: string, rule: InputRule | null): FactoryFile {
  const rest = f.inputs.filter((i) => !sameItem(i.item, item));
  if (!rule) return { ...f, inputs: rest };
  const at = f.inputs.findIndex((i) => sameItem(i.item, item));
  const inputs = [...rest];
  inputs.splice(at < 0 ? inputs.length : at, 0, rule);
  return { ...f, inputs };
}

/** Pick the recipe for an item (null: automatic). */
export function useRecipe(f: FactoryFile, item: string, recipe: string | null): FactoryFile {
  const recipes = { ...f.recipes };
  if (recipe) recipes[itemKey(item)] = recipe;
  else delete recipes[itemKey(item)];
  return { ...f, recipes };
}

export function setUseUp(f: FactoryFile, item: string, on: boolean): FactoryFile {
  const rest = f.useUp.filter((i) => !sameItem(i, item));
  return { ...f, useUp: on ? [...rest, item] : rest };
}

/** Default tier for a transport type (null: the type's first tier). */
export function setDefaultTier(f: FactoryFile, type: string, tier: string | null): FactoryFile {
  const transport = { ...f.transport };
  if (tier) transport[itemKey(type)] = tier;
  else delete transport[itemKey(type)];
  return { ...f, transport };
}

/** Tier for one connection (null: the plan default). */
export function setEdgeTier(f: FactoryFile, key: string, tier: string | null): FactoryFile {
  const edges = { ...f.edges };
  if (tier) edges[key] = tier;
  else delete edges[key];
  return { ...f, edges };
}

/**
 * Every connection of a transport type on one tier: the plan default becomes
 * `tier` (null: the type's first tier) and per-connection picks for that type
 * are cleared.
 */
export function setAllTier(f: FactoryFile, book: TransportBook, type: string, tier: string | null): FactoryFile {
  const edges = Object.fromEntries(Object.entries(f.edges).filter(([key]) => itemKey(itemType(book, key.split('>').pop() ?? '') ?? '') !== itemKey(type)));
  return { ...setDefaultTier(f, type, tier), edges };
}
