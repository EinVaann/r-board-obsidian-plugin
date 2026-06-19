import type { BoardItem, FilterRule, PropertyConfig } from '../types';
import { asArray, asNumber } from '../render/values';

/** Whether a value counts as "empty" for filter purposes. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Evaluate one filter rule against an item. */
function matches(item: BoardItem, rule: FilterRule, prop: PropertyConfig | undefined): boolean {
  const raw = item.frontmatter[rule.property];

  switch (rule.op) {
    case 'empty':
      return isEmpty(raw);
    case 'notempty':
      return !isEmpty(raw);
    case 'contains': {
      const hay = Array.isArray(raw) ? asArray(raw).join('\n') : String(raw ?? '');
      return hay.toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    }
    case 'eq':
    case 'ne': {
      const want = String(rule.value ?? '').toLowerCase();
      const hit = Array.isArray(raw)
        ? asArray(raw).some((v) => v.toLowerCase() === want)
        : String(raw ?? '').toLowerCase() === want;
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

/** Apply all rules (combined with AND) to a list of items. */
export function applyFilter(
  items: BoardItem[],
  rules: FilterRule[] | undefined,
  properties: PropertyConfig[],
): BoardItem[] {
  if (!rules || rules.length === 0) return items;
  const byName = new Map(properties.map((p) => [p.name, p]));
  return items.filter((item) => rules.every((rule) => matches(item, rule, byName.get(rule.property))));
}
