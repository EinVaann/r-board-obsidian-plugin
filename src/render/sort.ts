import type { BoardItem, PropertyConfig, SortSpec } from '../types';
import { TITLE_SORT_KEY } from '../config';
import { asNumber, fieldValue } from './values';

/** Return a new array of items sorted by `sort`. */
export function applySort(
  items: BoardItem[],
  sort: SortSpec,
  properties: PropertyConfig[],
): BoardItem[] {
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
    } else if (prop.type === 'number') {
      av = asNumber(fieldValue(a, prop)) ?? Number.NEGATIVE_INFINITY;
      bv = asNumber(fieldValue(b, prop)) ?? Number.NEGATIVE_INFINITY;
    } else {
      av = String(fieldValue(a, prop) ?? '').toLowerCase();
      bv = String(fieldValue(b, prop) ?? '').toLowerCase();
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return out;
}
