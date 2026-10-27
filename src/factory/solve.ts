/**
 * Turn recipes + a request into production plans.
 *
 * Every plan is a linear program: one variable per recipe (crafts per period),
 * one per raw item (extraction), one surplus per item. Each item must balance:
 * made − used + extracted − surplus = demand. Byproducts and loops (scrap →
 * recycler → ore) fall out of the same equations — no tree walking.
 *
 * Items with more than one recipe make alternatives: each combination of one
 * recipe per such item is solved separately, giving one plan each.
 */

import { minimize } from './simplex';
import { itemKey, PER_SECONDS, type Amount, type FactoryRecipe, type FactorySpec, type Per } from './parse';

/** An output: a fixed rate, or `max` (a ratio weight — several max outputs keep that ratio). */
export interface Target {
  item: string;
  rate?: number;
  max?: number;
}

/**
 * An item brought in from outside: unlimited (`free`), at most `qty` (`max`),
 * or exactly `qty`, all of it used (`exact`). Bringing an item in also means
 * not crafting it: recipes making it are dropped, except recycling ones.
 */
export interface InputRule {
  item: string;
  mode: 'free' | 'max' | 'exact';
  qty?: number;
}

export interface FactoryRequest {
  outputs: Target[];
  inputs: InputRule[];
  per: Per;
  /** Recipe names to always use for their main product. */
  use: string[];
  /** Recipe names never to use. */
  avoid: string[];
  /** Byproducts that must be consumed inside the factory. */
  useUp: string[];
  /** Crafting speed per machine key. */
  speed: Record<string, number>;
  /** Weight per raw item key (default 1). */
  cost: Record<string, number>;
}

export interface PlanRecipe {
  recipe: FactoryRecipe;
  /** Crafts per period. */
  runs: number;
  /** Machines needed (fractional), at the machine's speed. */
  machines: number;
}

export interface Plan {
  recipes: PlanRecipe[];
  /** Items taken in, per period. */
  raw: Amount[];
  /** Items made but not used, per period (excluding the outputs). */
  surplus: Amount[];
  /** The requested outputs, per period, in request order. */
  outputs: Amount[];
  /** Weighted raw intake. */
  cost: number;
  machines: number;
  /** The alternative recipes this plan picked, by name. */
  choices: string[];
}

export interface Alternatives {
  item: string;
  recipes: string[];
}

export interface SolveResult {
  plans: Plan[];
  problems: string[];
  /** Items in this factory that more than one recipe could make, by item key. */
  alternatives: Map<string, Alternatives>;
}

const TINY = 1e-7;
/** Above this many combinations, only the best mix of all recipes is solved. */
const MAX_COMBOS = 64;
const MAX_PLANS = 8;

const own = (o: Record<string, number>, k: string): number | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** The ```factory block's settings as a request. */
export function requestFromSpec(spec: FactorySpec): FactoryRequest {
  const inputs: InputRule[] = spec.raw.map((item) => ({ item, mode: 'free' }));
  const outputs: Target[] = [];
  if (spec.input) {
    inputs.push({ item: spec.input.item, mode: 'max', qty: spec.input.qty });
    outputs.push({ item: spec.make, max: 1 });
  } else if (spec.make) outputs.push({ item: spec.make, rate: spec.rate ?? 0 });
  return { outputs, inputs, per: spec.per, use: spec.use, avoid: spec.avoid, useUp: [], speed: spec.speed, cost: spec.cost };
}

/** Display names for item keys: the spelling first seen. */
function nameBook(recipes: FactoryRecipe[], extra: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const see = (s: string): void => void (names.has(itemKey(s)) || names.set(itemKey(s), s.trim()));
  extra.forEach(see);
  for (const r of recipes) [...r.outputs, ...r.inputs].forEach((a) => see(a.item));
  return names;
}

export function solveFactory(allRecipes: FactoryRecipe[], req: FactoryRequest): SolveResult {
  const problems: string[] = [];
  const alternatives = new Map<string, Alternatives>();
  const empty = (): SolveResult => ({ plans: [], problems, alternatives });
  const recipes = uniqueNames(allRecipes);
  const outputs = req.outputs.filter((t) => t.item.trim() && (t.max !== undefined ? t.max > 0 : (t.rate ?? 0) > 0));
  if (!outputs.length) {
    problems.push('Add an output: an item and a rate, or "max".');
    return empty();
  }
  const targets = outputs.map((t) => itemKey(t.item));
  const names = nameBook(recipes, [...outputs.map((t) => t.item), ...req.inputs.map((i) => i.item)]);
  const inputKeys = new Set(req.inputs.map((i) => itemKey(i.item)));
  for (const t of outputs) if (inputKeys.has(itemKey(t.item))) problems.push(`"${t.item}" is both an output and an input.`);
  if (problems.length) return empty();
  // A treatment recipe (no outputs) is grouped by what it removes.
  const mainOf = (r: FactoryRecipe): string => (isSink(r) ? `sink:${itemKey(r.inputs[0].item)}` : itemKey(r.outputs[0].item));
  const byName = new Map(recipes.map((r) => [itemKey(r.name), r]));

  for (const n of req.avoid) if (!byName.has(itemKey(n))) problems.push(`avoid: no recipe named "${n}".`);
  const avoid = new Set(req.avoid.map(itemKey));
  let pool = recipes.filter((r) => !avoid.has(itemKey(r.name)));
  // Inputs are brought in, not crafted — except by recycling (scrap → ore still counts).
  const recycles = recyclingTest(pool);
  pool = pool.filter((r) => !inputKeys.has(mainOf(r)) || recycles(r));

  for (const t of outputs) {
    if (!pool.some((r) => r.outputs.some((o) => itemKey(o.item) === itemKey(t.item)))) problems.push(`No recipe makes "${t.item}".`);
  }
  if (problems.length) return empty();

  const closure = (from: FactoryRecipe[]): FactoryRecipe[] => {
    const producers = new Map<string, FactoryRecipe[]>();
    for (const r of from) for (const o of r.outputs) producers.set(itemKey(o.item), [...(producers.get(itemKey(o.item)) ?? []), r]);
    const used = new Set<FactoryRecipe>();
    const seen = new Set<string>(targets);
    const queue = [...targets];
    while (queue.length) {
      const item = queue.pop()!;
      for (const r of producers.get(item) ?? []) {
        if (used.has(r)) continue;
        used.add(r);
        for (const i of r.inputs) {
          const k = itemKey(i.item);
          if (!seen.has(k)) {
            seen.add(k);
            queue.push(k);
          }
        }
      }
    }
    // Treatment recipes join for whatever the chain makes, so it can be removed instead of kept.
    const made0 = new Set([...used].flatMap((r) => r.outputs.map((o) => itemKey(o.item))));
    for (const r of from) if (isSink(r) && r.inputs.every((i) => made0.has(itemKey(i.item)))) used.add(r);
    // A recycling recipe only belongs if something here makes what it recycles.
    let kept = from.filter((r) => used.has(r));
    for (let changed = true; changed; ) {
      const made = new Set(kept.flatMap((r) => r.outputs.map((o) => itemKey(o.item))));
      const next = kept.filter((r) => !recycles(r) || r.inputs.every((i) => made.has(itemKey(i.item))));
      changed = next.length !== kept.length;
      kept = next;
    }
    return kept;
  };

  // Alternatives (before pins, so the picker can offer every recipe).
  for (const r of closure(pool)) {
    if (isSink(r)) continue;
    const k = mainOf(r);
    const a = alternatives.get(k) ?? { item: names.get(k) ?? r.outputs[0].item, recipes: [] };
    a.recipes.push(r.name);
    alternatives.set(k, a);
  }
  for (const [k, a] of alternatives) if (a.recipes.length < 2) alternatives.delete(k);

  const pinned = new Map<string, FactoryRecipe>();
  for (const n of req.use) {
    const r = byName.get(itemKey(n));
    if (!r) problems.push(`use: no recipe named "${n}".`);
    else pinned.set(mainOf(r), r);
  }
  pool = pool.filter((r) => !pinned.has(mainOf(r)) || pinned.get(mainOf(r)) === r);

  const base = closure(pool);
  for (const rule of req.inputs) {
    if (rule.mode !== 'free' && !base.some((r) => r.inputs.some((i) => itemKey(i.item) === itemKey(rule.item)))) {
      problems.push(`"${rule.item}" is not used by anything here.`);
    }
  }

  // Alternatives left after pins: each combination of one recipe per item is a candidate.
  const mains = new Map<string, FactoryRecipe[]>();
  for (const r of base) mains.set(mainOf(r), [...(mains.get(mainOf(r)) ?? []), r]);
  const choicePoints = [...mains.entries()].filter(([, rs]) => rs.length > 1);
  const combos = choicePoints.reduce((n, [, rs]) => n * rs.length, 1);

  const candidates: FactoryRecipe[][] = [base];
  if (choicePoints.length && combos <= MAX_COMBOS) {
    const walk = (i: number, chosen: Map<string, FactoryRecipe>): void => {
      if (i === choicePoints.length) {
        candidates.push(closure(pool.filter((r) => !chosen.has(mainOf(r)) || chosen.get(mainOf(r)) === r)));
        return;
      }
      for (const r of choicePoints[i][1]) walk(i + 1, new Map(chosen).set(choicePoints[i][0], r));
    };
    walk(0, new Map());
  } else if (choicePoints.length) {
    problems.push(`${combos} recipe combinations — showing only the best mix. Pick recipes to narrow it down.`);
  }

  const ctx: Ctx = { outputs, targets, inputs: req.inputs, inputKeys, useUp: new Set(req.useUp.map(itemKey)), names, recycles };
  const plans = new Map<string, Plan>();
  let lastProblem = '';
  for (const rs of candidates) {
    const r = solvePlan(rs, req, ctx);
    if (typeof r === 'string') {
      lastProblem = r;
      continue;
    }
    r.choices = r.recipes.filter((p) => (mains.get(mainOf(p.recipe))?.length ?? 0) > 1).map((p) => p.recipe.name);
    const key = r.recipes.map((p) => p.recipe.name).sort().join('\n');
    const prev = plans.get(key);
    if (!prev || better(r, prev)) plans.set(key, r);
  }
  if (!plans.size) problems.push(lastProblem || 'No plan found.');
  const sorted = [...plans.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  return { plans: sorted.slice(0, MAX_PLANS), problems, alternatives };
}

function better(a: Plan, b: Plan): boolean {
  const close = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  const made = (p: Plan): number => p.outputs.reduce((t, o) => t + o.qty, 0);
  if (!close(made(a), made(b))) return made(a) > made(b);
  if (!close(a.cost, b.cost)) return a.cost < b.cost;
  return a.machines < b.machines - 1e-9;
}

/** Recipe names are how plans refer to recipes: make repeats unique. */
function uniqueNames(recipes: FactoryRecipe[]): FactoryRecipe[] {
  const count = new Map<string, number>();
  return recipes.map((r) => {
    const k = itemKey(r.name);
    const n = (count.get(k) ?? 0) + 1;
    count.set(k, n);
    return n === 1 ? r : { ...r, name: `${r.name} (${n})` };
  });
}

interface Ctx {
  outputs: Target[];
  targets: string[];
  inputs: InputRule[];
  inputKeys: Set<string>;
  useUp: Set<string>;
  names: Map<string, string>;
  /** Recycling test over the whole recipe book (not one candidate). */
  recycles: (r: FactoryRecipe) => boolean;
}

/** A treatment recipe: it only removes items (a water treatment unit for sewage). */
export const isSink = (r: FactoryRecipe): boolean => !r.outputs.length;

/** Is a recipe recycling — fed only by byproducts (items some recipe makes, but never as its main product)? */
function recyclingTest(rs: FactoryRecipe[]): (r: FactoryRecipe) => boolean {
  const main = new Set(rs.filter((r) => !isSink(r)).map((r) => itemKey(r.outputs[0].item)));
  const made = new Set(rs.flatMap((r) => r.outputs.map((o) => itemKey(o.item))));
  return (r) => !isSink(r) && r.inputs.length > 0 && r.inputs.every((i) => made.has(itemKey(i.item)) && !main.has(itemKey(i.item)));
}

/**
 * Which items may be taken in raw: inputs, those no recipe makes, and those
 * made only by recycling recipes (like scrap → ore — the ore still has to come
 * from somewhere). With `byproducts`, items that are only ever a byproduct
 * (water from a refinery) may be taken in too; that is the fallback when a
 * plan can't balance.
 */
function rawItems(rs: FactoryRecipe[], items: string[], forced: Set<string>, byproducts: boolean, recycling: (r: FactoryRecipe) => boolean): string[] {
  const main = new Set(rs.filter((r) => !isSink(r)).map((r) => itemKey(r.outputs[0].item)));
  return items.filter((k) => {
    if (forced.has(k)) return true;
    const makers = rs.filter((r) => r.outputs.some((o) => itemKey(o.item) === k));
    return makers.every(recycling) || (byproducts && makers.length > 0 && !main.has(k));
  });
}

function solvePlan(rs: FactoryRecipe[], req: FactoryRequest, ctx: Ctx): Plan | string {
  const first = solveLp(rs, req, ctx, false);
  if (typeof first !== 'string') return first;
  const second = solveLp(rs, req, ctx, true);
  return typeof second === 'string' ? first : second;
}

/** One linear program over a fixed set of recipes. */
function solveLp(rs: FactoryRecipe[], req: FactoryRequest, ctx: Ctx, byproductsRaw: boolean): Plan | string {
  const per = PER_SECONDS[req.per];
  const speedOf = (r: FactoryRecipe): number => own(req.speed, itemKey(r.machine)) ?? 1;
  const name = (k: string): string => ctx.names.get(k) ?? k;

  const items: string[] = [...ctx.targets];
  const net = rs.map(() => new Map<string, number>());
  rs.forEach((r, ri) => {
    for (const a of r.outputs) net[ri].set(itemKey(a.item), (net[ri].get(itemKey(a.item)) ?? 0) + a.qty);
    for (const a of r.inputs) net[ri].set(itemKey(a.item), (net[ri].get(itemKey(a.item)) ?? 0) - a.qty);
    for (const k of net[ri].keys()) if (!items.includes(k)) items.push(k);
  });
  for (const k of ctx.inputKeys) if (!items.includes(k)) items.push(k);
  const raw = rawItems(rs, items, ctx.inputKeys, byproductsRaw, ctx.recycles).filter((k) => !ctx.targets.includes(k));

  // Columns: recipes | raw extraction | surplus per item | z (max outputs) | slack per "max" input.
  const capped = ctx.inputs.filter((i) => i.mode === 'max' && i.qty !== undefined);
  const exact = ctx.inputs.filter((i) => i.mode === 'exact' && i.qty !== undefined);
  const noSurplus = new Set([...ctx.useUp, ...exact.map((i) => itemKey(i.item))]);
  const maxOut = ctx.outputs.map((t, i) => [i, t] as const).filter(([, t]) => t.max !== undefined);
  const R = rs.length;
  const E = R;
  const S = E + raw.length;
  const Z = S + items.length;
  const U = Z + 1;
  const n = U + capped.length;

  const A: number[][] = [];
  const b: number[] = [];
  items.forEach((k, i) => {
    const a = new Array<number>(n).fill(0);
    rs.forEach((_, ri) => (a[ri] = net[ri].get(k) ?? 0));
    const e = raw.indexOf(k);
    if (e >= 0) a[E + e] = 1;
    a[S + i] = -1;
    const t = ctx.targets.indexOf(k);
    const out = t >= 0 ? ctx.outputs[t] : undefined;
    if (out?.max !== undefined) a[Z] = -out.max;
    A.push(a);
    b.push(out && out.max === undefined ? out.rate ?? 0 : 0);
  });
  // Surplus forbidden: the item must be used up (or, for exact inputs, all of it consumed).
  items.forEach((k, i) => {
    if (!noSurplus.has(k)) return;
    const a = new Array<number>(n).fill(0);
    a[S + i] = 1;
    A.push(a);
    b.push(0);
  });
  if (!maxOut.length) {
    const a = new Array<number>(n).fill(0);
    a[Z] = 1;
    A.push(a);
    b.push(0);
  }
  const limit = (rule: InputRule, slack: number): string | null => {
    const e = raw.indexOf(itemKey(rule.item));
    if (e < 0) return null;
    const a = new Array<number>(n).fill(0);
    a[E + e] = 1;
    if (slack >= 0) a[slack] = 1;
    A.push(a);
    b.push(rule.qty!);
    return null;
  };
  capped.forEach((rule, i) => limit(rule, U + i));
  exact.forEach((rule) => limit(rule, -1));

  const machineCost = rs.map((r) => (1e-6 * r.time) / speedOf(r));
  const rawCost = raw.map((k) => own(req.cost, k) ?? 1);
  const costs = (zWeight: number, rawWeight: number): number[] => {
    const c = new Array<number>(n).fill(0);
    machineCost.forEach((v, i) => (c[i] = v));
    rawCost.forEach((v, i) => (c[E + i] = v * rawWeight));
    c[Z] = zWeight;
    return c;
  };

  if (maxOut.length) {
    // First as much output as the inputs allow, then the cheapest way to make exactly that.
    const max = minimize(costs(-1, 1e-6), A, b);
    if (max.status === 'unbounded') {
      const what = maxOut.map(([, t]) => `"${t.item}"`).join(', ');
      return `Nothing limits ${what}: give an input a limit (≤ or =).`;
    }
    if (max.status !== 'optimal') return balanceProblem(ctx);
    const fix = new Array<number>(n).fill(0);
    fix[Z] = 1;
    A.push(fix);
    b.push(max.x[Z] * (1 - 1e-9));
  }
  const res = minimize(costs(0, 1), A, b);
  if (res.status === 'infeasible') return balanceProblem(ctx);
  if (res.status === 'unbounded') return 'The plan is unbounded (a loop makes more than it uses).';
  const x = res.x;

  const recipes: PlanRecipe[] = rs
    .map((r, i) => ({ recipe: r, runs: x[i], machines: (x[i] * r.time) / per / speedOf(r) }))
    .filter((p) => p.runs > TINY);
  const rawOut = raw.map((k, i) => ({ item: name(k), qty: x[E + i] })).filter((a) => a.qty > TINY);
  const surplus = items
    .map((k, i) => ({ k, item: name(k), qty: x[S + i] }))
    .filter((a) => !ctx.targets.includes(a.k) && a.qty > TINY && !raw.includes(a.k))
    .map(({ item, qty }) => ({ item, qty }));
  const outputs = ctx.outputs.map((t, i) => ({
    item: name(ctx.targets[i]),
    qty: (t.max !== undefined ? t.max * x[Z] : t.rate ?? 0) + x[S + items.indexOf(ctx.targets[i])],
  }));
  return {
    recipes,
    raw: rawOut,
    surplus,
    outputs,
    cost: raw.reduce((t, _, i) => t + rawCost[i] * x[E + i], 0),
    machines: recipes.reduce((t, p) => t + p.machines, 0),
    choices: [],
  };
}

function balanceProblem(ctx: Ctx): string {
  if (ctx.inputs.some((i) => i.mode !== 'free')) return 'The outputs need more than the input limits allow.';
  if (ctx.useUp.size) return 'These recipes cannot use up every byproduct you marked "must be used up".';
  return 'These recipes cannot balance — an input can only come from a recipe that needs more of it.';
}
