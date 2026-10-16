import { isFilterGroup, type BoardItem, type FilterGroup, type FilterNode, type FilterOp, type FilterRule, type PropertyConfig } from '../types';
import { asArray, asBoolean, asDate, asNumber, optionFor } from '../render/values';
import { formatDate, parseDateString } from '../formula/evaluate';

/** Operators that don't take a value. */
export const VALUELESS_OPS: FilterOp[] = ['empty', 'notempty', 'checked', 'unchecked'];
/** Operators whose value is a list of option values. */
export const LIST_OPS: FilterOp[] = ['anyOf', 'noneOf'];

/** The operators offered for a property, by type (the first is the default). */
export function opsForProperty(prop: PropertyConfig | undefined): FilterOp[] {
  switch (prop?.type) {
    case 'number':
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty'];
    case 'date':
      return ['eq', 'before', 'after', 'onOrBefore', 'onOrAfter', 'empty', 'notempty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
    case 'select':
      return ['eq', 'ne', 'anyOf', 'noneOf', 'empty', 'notempty'];
    case 'multi':
      return ['anyOf', 'noneOf', 'eq', 'ne', 'contains', 'empty', 'notempty'];
    case 'image':
      return ['empty', 'notempty'];
    default:
      return ['contains', 'notContains', 'eq', 'ne', 'startsWith', 'endsWith', 'gt', 'lt', 'empty', 'notempty'];
  }
}

/** Whether a value counts as "empty" for filter purposes. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return asArray(value).length === 0;
  return false;
}

/** A filter date value: `YYYY-MM-DD`, or `today` (± `N` days, e.g. `today-7`). */
export function filterDate(value: unknown): Date | null {
  const s = String(value ?? '').trim().toLowerCase();
  const rel = /^today\s*([+-]\s*\d+)?$/.exec(s);
  if (rel) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (rel[1] ? Number(rel[1].replace(/\s/g, '')) : 0));
  }
  return parseDateString(s);
}

const dayKey = (d: Date): string => formatDate(d, 'YYYY-MM-DD');

/** Texts a value can match as: raw values plus option labels, lower-cased. */
function texts(raw: unknown, prop: PropertyConfig | undefined): string[] {
  const list = raw instanceof Date ? [dayKey(raw)] : asArray(raw);
  if (prop?.type === 'select' || prop?.type === 'multi') {
    return list.flatMap((v) => [v, optionFor(prop, v).label]).map((v) => v.toLowerCase());
  }
  return list.map((v) => v.toLowerCase());
}

/** Evaluate one filter rule against an item. Rules on unknown properties read the raw value as text. */
export function matchesRule(item: BoardItem, rule: FilterRule, prop: PropertyConfig | undefined): boolean {
  const raw = item.values[rule.property];
  const want = String(rule.value ?? '').toLowerCase();

  switch (rule.op) {
    case 'empty':
      return isEmpty(raw);
    case 'notempty':
      return !isEmpty(raw);
    case 'checked':
      return asBoolean(raw) === true;
    case 'unchecked':
      return asBoolean(raw) !== true;
    case 'anyOf':
    case 'noneOf': {
      const set = new Set(asArray(rule.value).map((v) => v.toLowerCase()));
      if (set.size === 0) return true;
      const hit = asArray(raw).some((v) => set.has(v.toLowerCase()));
      return rule.op === 'anyOf' ? hit : !hit;
    }
    case 'contains':
    case 'notContains': {
      const hit = texts(raw, prop).join('\n').includes(want);
      return rule.op === 'contains' ? hit : !hit;
    }
    case 'startsWith':
      return texts(raw, prop).some((t) => t.startsWith(want));
    case 'endsWith':
      return texts(raw, prop).some((t) => t.endsWith(want));
    case 'before':
    case 'after':
    case 'onOrBefore':
    case 'onOrAfter':
      return compareDates(raw, rule.value, rule.op);
    case 'eq':
    case 'ne': {
      let hit: boolean;
      if (prop?.type === 'date') hit = compareDates(raw, rule.value, 'eq');
      else if (prop?.type === 'number' || typeof raw === 'number') hit = asNumber(raw) !== null && asNumber(raw) === asNumber(rule.value);
      else hit = texts(raw, prop).includes(want);
      return rule.op === 'eq' ? hit : !hit;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = asNumber(raw);
      const b = asNumber(rule.value);
      if (a === null || b === null) return false;
      if (rule.op === 'gt') return a > b;
      if (rule.op === 'gte') return a >= b;
      if (rule.op === 'lt') return a < b;
      return a <= b;
    }
    default:
      return true;
  }
}

/** Compare a value's day with the rule's date (time of day ignored). */
function compareDates(raw: unknown, value: unknown, op: 'eq' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'): boolean {
  const a = asDate(raw);
  const b = filterDate(value);
  if (!a || !b) return false;
  const x = dayKey(a);
  const y = dayKey(b);
  switch (op) {
    case 'eq': return x === y;
    case 'before': return x < y;
    case 'after': return x > y;
    case 'onOrBefore': return x <= y;
    case 'onOrAfter': return x >= y;
  }
}

/** A rule still being written (no value yet) doesn't hide anything. */
function isIncomplete(rule: FilterRule): boolean {
  if (VALUELESS_OPS.includes(rule.op)) return false;
  if (LIST_OPS.includes(rule.op)) return asArray(rule.value).length === 0;
  return rule.value === undefined || rule.value === null || String(rule.value).trim() === '';
}

/** Evaluate a node (rule or nested group) against an item. */
function matchesNode(item: BoardItem, node: FilterNode, byName: Map<string, PropertyConfig>): boolean {
  if (isFilterGroup(node)) return matchesGroup(item, node, byName);
  if (isIncomplete(node)) return true;
  return matchesRule(item, node, byName.get(node.property));
}

/** Evaluate a group: AND = every condition, OR = some condition. */
function matchesGroup(item: BoardItem, group: FilterGroup, byName: Map<string, PropertyConfig>): boolean {
  const active = group.conditions.filter((c) => isFilterGroup(c) || !isIncomplete(c));
  if (active.length === 0) return true;
  return group.conjunction === 'or'
    ? active.some((c) => matchesNode(item, c, byName))
    : active.every((c) => matchesNode(item, c, byName));
}

/** Apply the root filter group to a list of items. */
export function applyFilter(items: BoardItem[], filter: FilterGroup | undefined, properties: PropertyConfig[]): BoardItem[] {
  if (!filter || filter.conditions.length === 0) return items;
  const byName = new Map(properties.map((p) => [p.name, p]));
  return items.filter((item) => matchesGroup(item, filter, byName));
}

/** Count the leaf rules in a filter group (for the "N active" label / chip). */
export function countFilterRules(group: FilterGroup | undefined): number {
  if (!group) return 0;
  return group.conditions.reduce((n, c) => n + (isFilterGroup(c) ? countFilterRules(c) : 1), 0);
}
