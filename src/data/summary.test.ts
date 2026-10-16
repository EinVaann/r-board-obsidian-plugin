import { describe, expect, it } from 'vitest';
import type { BoardItem, PropertyConfig } from '../types';
import { calculate, calculationText, calculationsFor } from './summary';

const item = (values: Record<string, unknown>): BoardItem => ({ id: String(Math.random()), title: '', values, tags: [] });
const items = [item({ n: 10, t: 'a', c: true }), item({ n: '5', t: '' }), item({ n: null, t: 'b', c: false })];
const n: PropertyConfig = { name: 'n', type: 'number', format: { style: 'plain', grouping: true, decimals: 0 }, suffix: ' ₫' };
const t: PropertyConfig = { name: 't', type: 'text' };
const c: PropertyConfig = { name: 'c', type: 'checkbox' };

describe('summary row', () => {
  it('sums, averages and bounds numbers, skipping blanks', () => {
    expect(calculate(items, n, 'sum')).toBe(15);
    expect(calculate(items, n, 'avg')).toBe(7.5);
    expect(calculate(items, n, 'min')).toBe(5);
    expect(calculate(items, n, 'max')).toBe(10);
    expect(calculate([], n, 'sum')).toBeNull();
  });

  it('counts filled, empty and checked values', () => {
    expect(calculate(items, t, 'filled')).toBe(2);
    expect(calculate(items, t, 'empty')).toBe(1);
    expect(calculate(items, c, 'checked')).toBe(1);
    expect(calculate(items, c, 'unchecked')).toBe(2);
  });

  it('offers calculations by type and writes results in the column format', () => {
    expect(calculationsFor(t)).toEqual(['filled', 'empty']);
    expect(calculationsFor(c)).toEqual(['checked', 'unchecked']);
    expect(calculationText(4284058, n, 'sum')).toBe('4,284,058 ₫');
    expect(calculationText(3, n, 'filled')).toBe('3');
    expect(calculationText(null, n, 'sum')).toBe('—');
  });
});
