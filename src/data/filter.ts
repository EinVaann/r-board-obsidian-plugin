import { isFilterGroup, type BoardItem, type FilterGroup, type FilterNode, type FilterRule, type PropertyConfig } from '../types';
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

/** Evaluate a node (rule or nested group) against an item. */
function matchesNode(
  item: BoardItem,
  node: FilterNode,
  byName: Map<string, PropertyConfig>,
): boolean {
  if (isFilterGroup(node)) return matchesGroup(item, node, byName);
  return matches(item, node, byName.get(node.property));
}

/** Evaluate a group: AND = every condition, OR = some condition. */
function matchesGroup(
  item: BoardItem,
  group: FilterGroup,
  byName: Map<string, PropertyConfig>,
): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((c) => matchesNode(item, c, byName));
  return group.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
}

/** Apply the root filter group to a list of items. */
export function applyFilter(
  items: BoardItem[],
  filter: FilterGroup | undefined,
  properties: PropertyConfig[],
): BoardItem[] {
  if (!filter || filter.conditions.length === 0) return items;
  const byName = new Map(properties.map((p) => [p.name, p]));
  return items.filter((item) => matchesGroup(item, filter, byName));
}

/** Count the leaf rules in a filter group (for the "N active" label / chip). */
export function countFilterRules(group: FilterGroup | undefined): number {
  if (!group) return 0;
  return group.conditions.reduce(
    (n, c) => n + (isFilterGroup(c) ? countFilterRules(c) : 1),
    0,
  );
}
