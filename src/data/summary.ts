import type { BoardItem, Calculation, PropertyConfig } from '../types';
import { asArray, asBoolean, asNumber, formatNumber } from '../render/values';
import { toText } from '../formula/evaluate';

export const CALCULATION_LABELS: Record<Calculation, string> = {
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
  filled: 'Count filled',
  empty: 'Count empty',
  checked: 'Checked',
  unchecked: 'Unchecked',
};

/** The calculations offered for a property: number math for numeric columns, counts for all. */
export function calculationsFor(prop: PropertyConfig): Calculation[] {
  if (prop.type === 'checkbox') return ['checked', 'unchecked'];
  if (prop.type === 'number' || prop.type === 'formula') return ['sum', 'avg', 'min', 'max', 'filled', 'empty'];
  return ['filled', 'empty'];
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && asArray(v).length === 0);

/** The value of a calculation over items: a number, or null when there is nothing to compute. */
export function calculate(items: BoardItem[], prop: PropertyConfig, calc: Calculation): number | null {
  const values = items.map((i) => i.values[prop.name]);
  switch (calc) {
    case 'filled':
      return values.filter((v) => !isEmpty(v)).length;
    case 'empty':
      return values.filter(isEmpty).length;
    case 'checked':
      return values.filter((v) => asBoolean(v) === true).length;
    case 'unchecked':
      return values.filter((v) => asBoolean(v) !== true).length;
  }
  const nums = values.map(asNumber).filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  switch (calc) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
  }
}

/** A calculation's result as text: number math in the column's format, counts as plain numbers. */
export function calculationText(value: number | null, prop: PropertyConfig, calc: Calculation): string {
  if (value === null) return '—';
  const counting = calc === 'filled' || calc === 'empty' || calc === 'checked' || calc === 'unchecked';
  if (counting) return String(value);
  const n = prop.format ? formatNumber(value, prop.format) : toText(Math.round(value * 100) / 100);
  return `${prop.prefix ?? ''}${n}${prop.suffix ?? ''}`;
}
