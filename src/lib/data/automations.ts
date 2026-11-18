import type { Automation, AutomationEffect, AutomationTrigger, EffectOp, PropertyConfig, PropertyType, TriggerOp } from '../../types/database';
import type { StoredValue } from './properties';
import { toStored } from './properties';
import { asArray, asBoolean, asNumber, parseLink } from '../render/values';
import { formatDate, toText, type FValue } from '../formula/evaluate';
import { referencedNames } from '../formula/tokenize';
import { FormulaEvaluator } from './compute';

/** The triggers each property type offers, in menu order. */
export const TRIGGER_OPS: Record<PropertyType, TriggerOp[]> = {
  select: ['becomes', 'stopsBeing', 'changes', 'filled', 'empty'],
  multi: ['gains', 'loses', 'changes', 'filled', 'empty'],
  checkbox: ['checked', 'unchecked'],
  number: ['above', 'below', 'equals', 'changes', 'filled', 'empty'],
  date: ['filled', 'empty', 'changes'],
  text: ['becomes', 'contains', 'changes', 'filled', 'empty'],
  url: ['filled', 'empty', 'changes'],
  links: ['gains', 'loses', 'changes', 'filled', 'empty'],
  image: ['filled', 'empty', 'changes'],
  formula: ['changes', 'above', 'below', 'equals', 'becomes', 'filled', 'empty'],
};

/** The effects each property type offers (formulas are computed, so none). */
export const EFFECT_OPS: Record<PropertyType, EffectOp[]> = {
  select: ['set', 'clear'],
  multi: ['add', 'remove', 'set', 'clear'],
  checkbox: ['check', 'uncheck'],
  number: ['set', 'increment', 'clear'],
  date: ['today', 'set', 'clear'],
  text: ['set', 'clear'],
  url: ['set', 'clear'],
  links: ['set', 'add', 'remove', 'clear'],
  image: ['set', 'clear'],
  formula: [],
};

/** How a trigger reads in the editor, by property type where it differs. */
export function triggerLabel(op: TriggerOp, type: PropertyType): string {
  const setLike = type === 'date' || type === 'url' || type === 'image';
  switch (op) {
    case 'changes':
      return 'changes';
    case 'becomes':
      return 'becomes';
    case 'stopsBeing':
      return 'stops being';
    case 'gains':
      return type === 'links' ? 'gains a link to' : 'gains';
    case 'loses':
      return type === 'links' ? 'loses a link to' : 'loses';
    case 'contains':
      return 'starts to contain';
    case 'filled':
      return setLike ? 'is set' : 'becomes filled';
    case 'empty':
      return setLike ? 'is cleared' : 'becomes empty';
    case 'checked':
      return 'becomes checked';
    case 'unchecked':
      return 'becomes unchecked';
    case 'above':
      return 'goes above';
    case 'below':
      return 'goes below';
    case 'equals':
      return 'becomes';
  }
}

export function effectLabel(op: EffectOp, type: PropertyType): string {
  switch (op) {
    case 'set':
      return type === 'date' ? 'set to date' : 'set to';
    case 'clear':
      return 'clear';
    case 'add':
      return 'add';
    case 'remove':
      return 'remove';
    case 'check':
      return 'check';
    case 'uncheck':
      return 'uncheck';
    case 'today':
      return 'set to today';
    case 'increment':
      return 'add to it';
  }
}

/** Triggers that need values / a number, and effects that need a value / number. */
export const triggerNeedsValues = (op: TriggerOp): boolean => op === 'becomes' || op === 'stopsBeing' || op === 'gains' || op === 'loses' || op === 'contains';
export const triggerNeedsNumber = (op: TriggerOp, type: PropertyType): boolean => op === 'above' || op === 'below' || (op === 'equals' && type !== 'select');
export const effectNeedsValue = (op: EffectOp): boolean => op === 'set' || op === 'add' || op === 'remove';
/** Effects where "only if empty" means something. */
export const effectCanSkipFilled = (op: EffectOp): boolean => op === 'set' || op === 'today' || op === 'increment';

const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** A trigger or effect that is filled in enough to run. */
const triggerReady = (t: AutomationTrigger): boolean => !['becomes', 'stopsBeing', 'contains'].includes(t.op) || (t.values ?? []).length > 0;
const effectReady = (e: AutomationEffect): boolean => !effectNeedsValue(e.op) || hasValue(e.value);

// ---------------------------------------------------------------- reading values

const norm = (s: string): string => s.trim().toLowerCase();

/** A link compared by note name (or URL), so `[[Games/Hades|Hades]]` matches `[[Hades]]`. */
function linkKey(s: string): string {
  const l = parseLink(s);
  if (!l) return norm(s);
  if (l.url) return l.url.toLowerCase();
  return norm(l.linkpath.split('/').pop()!.replace(/\.md$/i, ''));
}

/** A value's list entries as comparable keys. */
function keys(prop: PropertyConfig, v: unknown): string[] {
  const list = prop.type === 'formula' ? (Array.isArray(v) ? (v as FValue[]).map(toText) : v == null || v === '' ? [] : [toText(v as FValue)]) : asArray(v);
  return list.map(prop.type === 'links' ? linkKey : norm).filter((k) => k !== '');
}

const blank = (prop: PropertyConfig, v: unknown): boolean => (prop.type === 'checkbox' ? asBoolean(v) !== true : keys(prop, v).length === 0);

/** A value in one comparable string: lists as sets, numbers and booleans normalized. */
function canon(prop: PropertyConfig, v: unknown): string {
  if (prop.type === 'checkbox') return String(asBoolean(v) === true);
  if (prop.type === 'number') return String(asNumber(v) ?? '');
  const k = keys(prop, v);
  return prop.type === 'multi' || prop.type === 'links' ? [...k].sort().join('\u0001') : k.join('\u0001');
}

function num(prop: PropertyConfig, v: unknown): number | null {
  if (prop.type === 'formula') return typeof v === 'number' ? v : asNumber(v);
  return asNumber(v);
}

/** Whether a trigger's condition holds for one value (its state, ignoring the change). */
export function holds(t: AutomationTrigger, prop: PropertyConfig, v: unknown): boolean {
  const want = (t.values ?? []).map(prop.type === 'links' ? linkKey : norm).filter(Boolean);
  const have = keys(prop, v);
  switch (t.op) {
    case 'becomes':
    case 'stopsBeing':
      return have.length > 0 && want.includes(have.join(', '));
    case 'gains':
      return want.length ? have.some((h) => want.includes(h)) : have.length > 0;
    case 'loses':
      return want.length ? !want.some((w) => have.includes(w)) : true;
    case 'contains':
      return want.some((w) => have.join(', ').includes(w));
    case 'filled':
      return !blank(prop, v);
    case 'empty':
      return blank(prop, v);
    case 'checked':
      return asBoolean(v) === true;
    case 'unchecked':
      return asBoolean(v) !== true;
    case 'above':
      return (num(prop, v) ?? -Infinity) > (t.number ?? 0);
    case 'below':
      return num(prop, v) !== null && num(prop, v)! < (t.number ?? 0);
    case 'equals':
      return num(prop, v) === (t.number ?? 0);
    case 'changes':
      return true;
  }
}

/** Whether a trigger just happened: its value went from `before` to `after`. */
export function fired(t: AutomationTrigger, prop: PropertyConfig, before: unknown, after: unknown): boolean {
  if (canon(prop, before) === canon(prop, after)) return false;
  switch (t.op) {
    case 'changes':
      return true;
    case 'stopsBeing':
      return holds(t, prop, before) && !holds(t, prop, after);
    case 'gains':
    case 'loses': {
      const want = (t.values ?? []).map(prop.type === 'links' ? linkKey : norm).filter(Boolean);
      const [from, to] = t.op === 'gains' ? [keys(prop, before), keys(prop, after)] : [keys(prop, after), keys(prop, before)];
      return to.some((k) => !from.includes(k) && (!want.length || want.includes(k)));
    }
    case 'becomes':
      if (t.from?.length && !t.from.map(norm).includes(keys(prop, before).join(', '))) return false;
      return holds(t, prop, after) && !holds(t, prop, before);
    default:
      return holds(t, prop, after) && !holds(t, prop, before);
  }
}

// ---------------------------------------------------------------- running

/** Automations that can run: on, with known properties and at least one trigger and effect. */
export function activeAutomations(autos: Automation[] | undefined, properties: PropertyConfig[]): Automation[] {
  const byName = new Map(properties.map((p) => [p.name, p]));
  const out: Automation[] = [];
  for (const a of autos ?? []) {
    if (a.disabled) continue;
    const triggers = a.triggers.filter((t) => {
      const p = byName.get(t.property);
      return p && TRIGGER_OPS[p.type].includes(t.op) && triggerReady(t);
    });
    const effects = a.effects.filter((e) => {
      const p = byName.get(e.property);
      return p && EFFECT_OPS[p.type].includes(e.op) && effectReady(e);
    });
    // "All": a half-filled condition would widen it, so the automation waits until it's complete.
    if (a.match === 'all' && triggers.length < a.triggers.length) continue;
    if (triggers.length && effects.length) out.push({ ...a, triggers, effects });
  }
  return out;
}

/** Values with formula results filled in, when a trigger watches a formula. */
function withFormulas(autos: Automation[], properties: PropertyConfig[], values: Record<string, unknown>, title: string): Record<string, unknown> {
  const formulas = new Set(properties.filter((p) => p.type === 'formula').map((p) => p.name));
  if (!autos.some((a) => a.triggers.some((t) => formulas.has(t.property)))) return values;
  return new FormulaEvaluator(properties).apply({ id: '', title, values, tags: [] }).values;
}

/**
 * The automations a change sets off. `before` is undefined for a record not
 * seen before (read as empty). Pass `activeAutomations` output.
 */
export function firedAutomations(
  autos: Automation[],
  properties: PropertyConfig[],
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  title = '',
): Automation[] {
  if (!autos.length) return [];
  const byName = new Map(properties.map((p) => [p.name, p]));
  const b = withFormulas(autos, properties, before ?? {}, title);
  const a = withFormulas(autos, properties, after, title);
  return autos.filter((auto) => {
    const states = auto.triggers.map((t) => {
      const p = byName.get(t.property)!;
      return { happened: fired(t, p, b[t.property], a[t.property]), now: t.op !== 'changes' && holds(t, p, a[t.property]) };
    });
    if (!states.some((s) => s.happened)) return false;
    return auto.match === 'all' ? states.every((s) => s.happened || s.now) : true;
  });
}

/** The value an effect writes over `current`, or undefined to leave it as it is. */
export function effectValue(prop: PropertyConfig, e: AutomationEffect, current: unknown, now: Date): StoredValue | undefined {
  if (e.onlyIfEmpty && effectCanSkipFilled(e.op) && !blank(prop, current)) return undefined;
  let next: StoredValue;
  switch (e.op) {
    case 'clear':
      next = null;
      break;
    case 'check':
      next = true;
      break;
    case 'uncheck':
      next = false;
      break;
    case 'today': {
      const d = new Date(now);
      d.setDate(d.getDate() + (e.number ?? 0));
      next = formatDate(d, e.includeTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD');
      break;
    }
    case 'increment':
      next = (asNumber(current) ?? 0) + (e.number ?? 1);
      break;
    case 'set':
      next = toStored(prop, (e.value ?? null) as StoredValue);
      break;
    case 'add':
    case 'remove': {
      const list = asArray(current);
      const change = asArray(e.value);
      const key = prop.type === 'links' ? linkKey : norm;
      const changeKeys = change.map(key);
      next =
        e.op === 'add'
          ? [...list, ...change.filter((v, i) => !list.some((l) => key(l) === changeKeys[i]))]
          : list.filter((l) => !changeKeys.includes(key(l)));
      next = toStored(prop, next);
      break;
    }
  }
  return canon(prop, next) === canon(prop, current) ? undefined : next;
}

/**
 * Apply the effects of `autos` to `values`, in order (a later effect sees an
 * earlier one's result). Returns only the properties that change; null clears.
 */
export function applyEffects(autos: Automation[], properties: PropertyConfig[], values: Record<string, unknown>, now: Date): Record<string, StoredValue> {
  const byName = new Map(properties.map((p) => [p.name, p]));
  const work = { ...values };
  const out: Record<string, StoredValue> = {};
  for (const auto of autos) {
    for (const e of auto.effects) {
      const p = byName.get(e.property);
      if (!p) continue;
      const v = effectValue(p, e, work[e.property], now);
      if (v === undefined) continue;
      work[e.property] = v;
      out[e.property] = v;
    }
  }
  return out;
}

/**
 * Table rows after an edit, with automations applied to each row the edit
 * changed (a new row counts as changed from empty). Effects are applied once
 * and don't set off other automations. Returns `next` itself when nothing applies.
 */
export function automateRows<R extends { id: string; cells: Record<string, unknown> }>(
  autos: Automation[],
  properties: PropertyConfig[],
  titleProperty: string | undefined,
  prev: R[],
  next: R[],
  now: Date,
): R[] {
  if (!autos.length) return next;
  const old = new Map(prev.map((r) => [r.id, r]));
  let out: R[] | null = null;
  next.forEach((row, i) => {
    const was = old.get(row.id);
    if (was === row) return;
    const title = titleProperty ? asArray(row.cells[titleProperty]).join(', ') : '';
    const fired = firedAutomations(autos, properties, was?.cells, row.cells, title);
    const changes = applyEffects(fired, properties, row.cells, now);
    if (!Object.keys(changes).length) return;
    const cells = { ...row.cells };
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) delete cells[k];
      else cells[k] = v;
    }
    out ??= [...next];
    out[i] = { ...row, cells };
  });
  return out ?? next;
}

// ---------------------------------------------------------------- chains

/** One automation's effect could set off another automation's (or its own) trigger. */
export interface Chain {
  from: Automation;
  effect: AutomationEffect;
  to: Automation;
  trigger: AutomationTrigger;
}

/** The properties a formula reads, following other formulas. */
function formulaInputs(prop: PropertyConfig, properties: PropertyConfig[], seen = new Set<string>()): Set<string> {
  const byKey = new Map<string, PropertyConfig>();
  for (const p of properties) for (const n of [p.label, p.name]) if (n) byKey.set(n.trim().toLowerCase(), p);
  const out = new Set<string>();
  if (seen.has(prop.name)) return out;
  seen.add(prop.name);
  for (const ref of referencedNames(prop.formula ?? '')) {
    const p = byKey.get(ref.trim().toLowerCase());
    if (!p) continue;
    out.add(p.name);
    if (p.type === 'formula') for (const n of formulaInputs(p, properties, seen)) out.add(n);
  }
  return out;
}

/** What an effect leaves in its property, as far as it can be known ahead. */
type Known = { kind: 'value'; v: unknown } | { kind: 'add' | 'remove'; v: string[] } | { kind: 'unknown' };

function knownAfter(prop: PropertyConfig, e: AutomationEffect): Known {
  switch (e.op) {
    case 'clear':
      return { kind: 'value', v: null };
    case 'check':
      return { kind: 'value', v: true };
    case 'uncheck':
      return { kind: 'value', v: false };
    case 'set':
      return { kind: 'value', v: toStored(prop, (e.value ?? null) as StoredValue) };
    case 'today':
      return { kind: 'value', v: '2000-01-01' };
    case 'add':
    case 'remove':
      return { kind: e.op, v: asArray(e.value) };
    case 'increment':
      return { kind: 'unknown' };
  }
}

/** Whether writing `e` could make `t` (on the same property) happen. */
function couldFireSame(prop: PropertyConfig, e: AutomationEffect, t: AutomationTrigger): boolean {
  if (t.op === 'changes') return true;
  const k = knownAfter(prop, e);
  if (k.kind === 'unknown') return true;
  const want = (t.values ?? []).map(prop.type === 'links' ? linkKey : norm).filter(Boolean);
  const key = prop.type === 'links' ? linkKey : norm;
  if (k.kind === 'add') {
    if (t.op === 'gains') return !want.length || k.v.some((x) => want.includes(key(x)));
    return t.op === 'filled' || t.op === 'contains';
  }
  if (k.kind === 'remove') {
    if (t.op === 'loses') return !want.length || k.v.some((x) => want.includes(key(x)));
    return t.op === 'empty';
  }
  if (t.op === 'stopsBeing') return !holds(t, prop, k.v);
  if (t.op === 'loses') return true;
  return holds(t, prop, k.v);
}

/** Effects that could set off a trigger, across all (or the given) automations. */
export function findChains(autos: Automation[] | undefined, properties: PropertyConfig[]): Chain[] {
  const active = activeAutomations(autos, properties);
  const byName = new Map(properties.map((p) => [p.name, p]));
  const out: Chain[] = [];
  for (const from of active) {
    for (const effect of from.effects) {
      const prop = byName.get(effect.property)!;
      for (const to of active) {
        for (const trigger of to.triggers) {
          const tp = byName.get(trigger.property)!;
          const hit =
            trigger.property === effect.property
              ? couldFireSame(prop, effect, trigger)
              : tp.type === 'formula' && formulaInputs(tp, properties).has(effect.property);
          if (hit) out.push({ from, effect, to, trigger });
        }
      }
    }
  }
  return out;
}

/** A chain as one sentence for warnings. */
export function describeChain(c: Chain, properties: PropertyConfig[], name: (a: Automation) => string): string {
  const label = (n: string): string => {
    const p = properties.find((x) => x.name === n);
    return p?.label?.trim() || n;
  };
  const self = c.from.id === c.to.id;
  return self
    ? `“${name(c.from)}” changes ${label(c.effect.property)}, which could set itself off again.`
    : `“${name(c.from)}” changes ${label(c.effect.property)}, which could set off “${name(c.to)}”.`;
}

/** Chains in `next` that aren't in `prev` (so an edit that adds one can be refused). */
export function newChains(prev: Automation[] | undefined, next: Automation[] | undefined, properties: PropertyConfig[]): Chain[] {
  const sig = (c: Chain): string => `${c.from.id}|${c.effect.property}|${c.to.id}|${c.trigger.property}`;
  const old = new Set(findChains(prev, properties).map(sig));
  return findChains(next, properties).filter((c) => !old.has(sig(c)));
}
