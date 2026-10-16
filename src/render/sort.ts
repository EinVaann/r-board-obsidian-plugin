import type { BoardItem, PropertyConfig, SortSpec } from '../types';
import { NO_SORT_KEY, TITLE_SORT_KEY } from '../config';
import { asBoolean, asDate, asNumber, fieldValue } from './values';

/** A comparable key for a value: numbers for numeric/date/checkbox/select, else lower-cased text. */
function sortKey(prop: PropertyConfig, v: unknown): string | number {
  switch (prop.type) {
    case 'number':
      return asNumber(v) ?? Number.NEGATIVE_INFINITY;
    case 'checkbox':
      // Unchecked (false/absent) sorts before checked.
      return asBoolean(v) ? 1 : 0;
    case 'date':
      return asDate(v)?.getTime() ?? Number.NEGATIVE_INFINITY;
    case 'select': {
      // Listed options sort in their configured order; free values after them.
      const i = prop.options?.findIndex((o) => o.value === v) ?? -1;
      if (v == null || v === '') return Number.NEGATIVE_INFINITY;
      return i >= 0 ? i : (prop.options?.length ?? 0) + 1;
    }
    case 'formula':
      if (typeof v === 'number') return v;
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'boolean') return v ? 1 : 0;
      return String(v ?? '').toLowerCase();
    default:
      return String(v ?? '').toLowerCase();
  }
}

/** Return a new array of items sorted by `sort`. */
export function applySort(
  items: BoardItem[],
  sort: SortSpec,
  properties: PropertyConfig[],
): BoardItem[] {
  if (sort.property === NO_SORT_KEY) return items;
  const prop = sort.property === TITLE_SORT_KEY
    ? undefined
    : properties.find((p) => p.name === sort.property);
  const factor = sort.dir === 'desc' ? -1 : 1;

  const out = [...items];
  out.sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (!prop) {
      av = a.title.toLowerCase();
      bv = b.title.toLowerCase();
    } else {
      av = sortKey(prop, fieldValue(a, prop));
      bv = sortKey(prop, fieldValue(b, prop));
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return out;
}
