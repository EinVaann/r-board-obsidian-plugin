/**
 * The data set inside a `.factory` file, edited in its Data tab: recipes,
 * items (registered from the recipes; each gets a transport type) and
 * transport tiers. `bookFromData` turns it into what the solver and graph use.
 */

import { newId, parseTableFile } from '../table/format';
import { itemKey, itemsFromTable, recipesFromTable, transportFromTable, type Amount, type FactoryRecipe } from './parse';
import type { TransportBook } from './transport';

export interface RecipeRow {
  id: string;
  name: string;
  machine: string;
  /** Seconds per craft. */
  time: number;
  inputs: Amount[];
  /** The first output is the main product. */
  outputs: Amount[];
  /** An environment the machine must stand in (an Environments row name); empty: none. */
  env?: string;
}

/**
 * An environment some recipes need: a zone kept up by a dispersing machine
 * that burns `rate` of `gas` per minute, whatever it covers.
 */
export interface EnvRow {
  id: string;
  name: string;
  /** The building that makes the zone (e.g. "Gas Dispersing Unit"). */
  source: string;
  gas: string;
  /** Gas per minute, per dispersing machine. */
  rate: number;
}

/** A machine that burns fuel while it works (e.g. a transmuter burning 6 Xiranite a minute). */
export interface MachineRow {
  id: string;
  name: string;
  fuel: string;
  /** Fuel per minute, per machine at full speed. */
  rate: number;
}

export interface ItemRow {
  name: string;
  /** Transport type (e.g. "Belt"); missing = not set yet (flagged). */
  transport?: string;
}

export interface TierRow {
  id: string;
  name: string;
  type: string;
  /** Per minute, per lane. */
  rate: number;
}

export interface FactoryData {
  recipes: RecipeRow[];
  /** Item settings. The full item list also includes every item a recipe names (see `itemList`). */
  items: ItemRow[];
  transport: TierRow[];
  environments: EnvRow[];
  machines: MachineRow[];
}

export type DataTab = keyof FactoryData;
export const DATA_TABS: { key: DataTab; label: string }[] = [
  { key: 'recipes', label: 'Recipes' },
  { key: 'items', label: 'Items' },
  { key: 'transport', label: 'Transport' },
  { key: 'machines', label: 'Machines' },
  { key: 'environments', label: 'Environments' },
];

export function newData(): FactoryData {
  return { recipes: [], items: [], transport: [], environments: [], machines: [] };
}

// ---------------------------------------------------------------- reading / writing

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const amounts = (v: unknown): Amount[] =>
  arr(v)
    .map(rec)
    .filter((a) => str(a.item))
    .map((a) => ({ item: str(a.item), qty: num(a.qty) || 1 }));

/** Early files stored R Board tables (`properties` + `rows`); convert them. */
const isTable = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(rec(v).rows);
function fromTable(v: unknown) {
  const r = parseTableFile(JSON.stringify(v));
  return r.ok ? ([r.table.config.properties, r.table.rows, r.table.config.titleProperty] as const) : null;
}

export function parseData(raw: unknown): FactoryData {
  const o = rec(raw);
  const data = newData();
  const taken: string[] = [];
  const id = (prefix: string): string => {
    const v = newId(prefix, taken);
    taken.push(v);
    return v;
  };

  if (isTable(o.recipes)) {
    const t = fromTable(o.recipes);
    if (t) data.recipes = recipesFromTable(...t).recipes.map((r) => ({ id: id('r'), ...r }));
  } else {
    data.recipes = arr(o.recipes)
      .map(rec)
      .map((r) => ({ id: str(r.id) || id('r'), name: str(r.name), machine: str(r.machine), time: num(r.time), inputs: amounts(r.inputs), outputs: amounts(r.outputs), ...(str(r.env) ? { env: str(r.env) } : {}) }));
  }

  if (isTable(o.items)) {
    const t = fromTable(o.items);
    if (t) data.items = [...itemsFromTable(...t).types].map(([k, type]) => ({ name: k, transport: type }));
  } else {
    data.items = arr(o.items)
      .map(rec)
      .filter((i) => str(i.name))
      .map((i) => (str(i.transport) ? { name: str(i.name), transport: str(i.transport) } : { name: str(i.name) }));
  }

  if (isTable(o.transport)) {
    const t = fromTable(o.transport);
    if (t) data.transport = transportFromTable(...t).tiers.map((x) => ({ id: id('t'), ...x }));
  } else {
    data.transport = arr(o.transport)
      .map(rec)
      .filter((t) => str(t.name))
      .map((t) => ({ id: str(t.id) || id('t'), name: str(t.name), type: str(t.type) || 'Belt', rate: num(t.rate) }));
  }

  data.environments = arr(o.environments)
    .map(rec)
    .filter((e) => str(e.name))
    .map((e) => ({ id: str(e.id) || id('e'), name: str(e.name), source: str(e.source), gas: str(e.gas), rate: num(e.rate) }));

  data.machines = arr(o.machines)
    .map(rec)
    .filter((m) => str(m.name))
    .map((m) => ({ id: str(m.id) || id('m'), name: str(m.name), fuel: str(m.fuel), rate: num(m.rate) }));

  // Item names from old Items tables were keys; give them the spelling the recipes use.
  const spelling = new Map(itemList(data).map((i) => [itemKey(i.name), i.name]));
  data.items = data.items.map((i) => ({ ...i, name: spelling.get(itemKey(i.name)) ?? i.name }));
  return data;
}

/** The data as stored in the file. */
export function dataJson(d: FactoryData): unknown {
  return {
    recipes: d.recipes.map((r) => ({ id: r.id, name: r.name, machine: r.machine, time: r.time, inputs: r.inputs, outputs: r.outputs, ...(r.env ? { env: r.env } : {}) })),
    items: d.items.filter((i) => i.transport).map((i) => ({ name: i.name, transport: i.transport })),
    transport: d.transport.map((t) => ({ id: t.id, name: t.name, type: t.type, rate: t.rate })),
    environments: d.environments.map((e) => ({ id: e.id, name: e.name, source: e.source, gas: e.gas, rate: e.rate })),
    machines: d.machines.map((m) => ({ id: m.id, name: m.name, fuel: m.fuel, rate: m.rate })),
  };
}

// ---------------------------------------------------------------- derived

export interface ItemInfo {
  name: string;
  transport?: string;
  /** Recipes making / using it. */
  made: number;
  used: number;
}

/** Every item: those the recipes name (in recipe order), then items with settings but no recipe. */
export function itemList(d: FactoryData): ItemInfo[] {
  const byKey = new Map<string, ItemInfo>();
  const see = (name: string): ItemInfo => {
    const k = itemKey(name);
    let info = byKey.get(k);
    if (!info) byKey.set(k, (info = { name: name.trim(), made: 0, used: 0 }));
    return info;
  };
  for (const r of d.recipes) {
    for (const a of r.outputs) if (a.item.trim()) see(a.item).made++;
    for (const a of r.inputs) if (a.item.trim()) see(a.item).used++;
  }
  for (const i of d.items) {
    const info = see(i.name);
    if (i.transport) info.transport = i.transport;
  }
  return [...byKey.values()];
}

/** Transport types in table order. */
export function typeNames(d: FactoryData): string[] {
  const seen = new Map<string, string>();
  for (const t of d.transport) if (t.type && !seen.has(itemKey(t.type))) seen.set(itemKey(t.type), t.type);
  return [...seen.values()];
}

export const machineNames = (d: FactoryData): string[] => [...new Set(d.recipes.map((r) => r.machine).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export interface Book {
  recipes: FactoryRecipe[];
  environments: EnvRow[];
  transport?: TransportBook;
  errors: string[];
  /** Items that have no transport type (only when transport tiers exist). */
  unassigned?: string[];
}

export function bookFromData(d: FactoryData): Book {
  const errors: string[] = [];
  const recipes: FactoryRecipe[] = [];
  for (const r of d.recipes) {
    const outputs = r.outputs.filter((a) => a.item.trim() && a.qty > 0);
    const inputs = r.inputs.filter((a) => a.item.trim() && a.qty > 0);
    // No outputs, but inputs and a machine: a treatment recipe that removes them (sewage → nothing).
    if (!outputs.length && !(inputs.length && r.machine.trim())) continue; // a row still being filled in
    const label = r.name || (outputs.length ? outputs[0].item : `Treat ${inputs.map((a) => a.item).join(' + ')}`);
    if (!(r.time > 0)) {
      errors.push(`Recipe "${label}" needs a time.`);
      continue;
    }
    // Fuel burns per minute of work: fold it into each craft (rate × seconds ÷ 60).
    const fuel = d.machines.find((m) => m.fuel.trim() && m.rate > 0 && itemKey(m.name) === itemKey(r.machine));
    if (fuel) inputs.push({ item: fuel.fuel.trim(), qty: (fuel.rate * r.time) / 60 });
    recipes.push({ name: label, machine: r.machine || 'Machine', time: r.time, inputs, outputs, ...(r.env ? { env: r.env } : {}) });
  }
  const tiers = d.transport.filter((t) => t.name && t.rate > 0);
  const environments = d.environments;
  if (!tiers.length) return { recipes, environments, errors };
  const types = new Map<string, string>();
  for (const i of d.items) if (i.transport) types.set(itemKey(i.name), i.transport);
  const unassigned = itemList(d)
    .filter((i) => i.made + i.used > 0 && !i.transport)
    .map((i) => i.name);
  return { recipes, environments, errors, transport: { tiers, types }, unassigned };
}

// ---------------------------------------------------------------- edits (pure)

export function setItemTransport(d: FactoryData, name: string, transport: string | null): FactoryData {
  const rest = d.items.filter((i) => itemKey(i.name) !== itemKey(name));
  return { ...d, items: transport ? [...rest, { name, transport }] : rest };
}

/** Rename an item everywhere: in every recipe and its settings. */
export function renameItem(d: FactoryData, from: string, to: string): FactoryData {
  const name = to.trim();
  if (!name || name === from) return d;
  const fix = (as: Amount[]): Amount[] => as.map((a) => (itemKey(a.item) === itemKey(from) ? { ...a, item: name } : a));
  return {
    ...d,
    recipes: d.recipes.map((r) => ({ ...r, inputs: fix(r.inputs), outputs: fix(r.outputs) })),
    items: d.items.map((i) => (itemKey(i.name) === itemKey(from) ? { ...i, name } : i)),
  };
}

export function newRecipe(d: FactoryData): RecipeRow {
  return { id: newId('r', d.recipes.map((r) => r.id)), name: '', machine: '', time: 1, inputs: [], outputs: [] };
}

export function newTier(d: FactoryData, type: string, name?: string, rate = 60): TierRow {
  const n = d.transport.filter((t) => itemKey(t.type) === itemKey(type)).length + 1;
  return { id: newId('t', d.transport.map((t) => t.id)), name: name ?? `${type} Mk${n}`, type, rate };
}

export function newEnv(d: FactoryData): EnvRow {
  return { id: newId('e', d.environments.map((e) => e.id)), name: '', source: 'Gas Dispersing Unit', gas: '', rate: 6 };
}

/** Environments a plan's recipes need, with the gas each one's dispersers burn. */
export function neededEnvs(recipes: { env?: string }[], envs: EnvRow[]): { name: string; row?: EnvRow }[] {
  const names = [...new Set(recipes.map((r) => r.env).filter((e): e is string => !!e))];
  return names.map((name) => ({ name, row: envs.find((e) => itemKey(e.name) === itemKey(name)) }));
}

export function newMachine(d: FactoryData): MachineRow {
  return { id: newId('m', d.machines.map((m) => m.id)), name: '', fuel: '', rate: 6 };
}
