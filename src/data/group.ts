import type { BoardItem, GroupColumnConfig, PropertyConfig } from '../types';
import { asArray } from '../render/values';

/** Label for the bucket of items missing the group property. */
export const UNCATEGORIZED_LABEL = 'Uncategorized';

/** A bucket of items sharing one value of the group property. */
export interface ItemGroup {
  /** The group value (null = missing/empty). */
  key: string | null;
  label: string;
  items: BoardItem[];
}

/** The group value of an item for a property: a single scalar string, or null. */
export function groupValueOf(item: BoardItem, prop: PropertyConfig): string | null {
  const raw = item.frontmatter[prop.name];
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) {
    const arr = asArray(raw);
    return arr.length > 0 ? arr[0] : null;
  }
  return String(raw);
}

/**
 * Partition items into groups by a property. With `order`, those values lead
 * (in the given order, always present even when empty); remaining values follow
 * sorted alphabetically; the Uncategorized bucket is last (omitted when empty
 * and not explicitly ordered). `groupConfig` applies custom labels and hides
 * columns marked hidden (their items are not shown).
 */
export function groupItems(
  items: BoardItem[],
  prop: PropertyConfig,
  order?: string[],
  groupConfig?: Record<string, GroupColumnConfig>,
): ItemGroup[] {
  const buckets = new Map<string, BoardItem[]>();
  const uncategorized: BoardItem[] = [];

  for (const item of items) {
    const value = groupValueOf(item, prop);
    if (value === null) {
      uncategorized.push(item);
      continue;
    }
    const list = buckets.get(value);
    if (list) list.push(item);
    else buckets.set(value, [item]);
  }

  const colLabel = (key: string): string => groupConfig?.[key]?.label ?? key;
  const isHidden = (key: string): boolean => groupConfig?.[key]?.hidden === true;

  const groups: ItemGroup[] = [];
  const seen = new Set<string>();

  if (order) {
    for (const value of order) {
      seen.add(value);
      if (isHidden(value)) continue;
      groups.push({ key: value, label: colLabel(value), items: buckets.get(value) ?? [] });
    }
  }

  const rest = [...buckets.keys()]
    .filter((k) => !seen.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const value of rest) {
    if (isHidden(value)) continue;
    groups.push({ key: value, label: colLabel(value), items: buckets.get(value) ?? [] });
  }

  if (uncategorized.length > 0) {
    groups.push({ key: null, label: UNCATEGORIZED_LABEL, items: uncategorized });
  }

  return groups;
}
