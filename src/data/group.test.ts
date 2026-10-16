import { describe, expect, it } from 'vitest';
import type { BoardItem, PropertyConfig } from '../types';
import { bucketDate, cellForGroup, cellsForGroup, groupItems } from './group';
import { computeItems } from './compute';

const item = (id: string, values: Record<string, unknown>): BoardItem => ({ id, title: id, values, tags: [] });
const today = new Date(2026, 9, 16);
const day = (offset: number): string => {
  const d = new Date(2026, 9, 16 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('grouping', () => {
  const due: PropertyConfig = { name: 'due', type: 'date' };

  it('buckets dates relative to today, in time order, with no-date last', () => {
    const items = [item('a', { due: day(40) }), item('b', { due: day(0) }), item('c', { due: day(-3) }), item('d', { due: day(1) }), item('e', {}), item('f', { due: day(-60) })];
    const groups = groupItems(items, due, { bucket: 'relative', today });
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id).join('')])).toEqual([
      ['Older', 'f'],
      ['Last 7 days', 'c'],
      ['Today', 'b'],
      ['Tomorrow', 'd'],
      ['Later', 'a'],
      ['Uncategorized', 'e'],
    ]);
  });

  it('buckets by month / quarter / week and adds into the period', () => {
    expect(bucketDate(new Date(2026, 7, 14), 'month')).toEqual({ key: '2026-08', label: 'Aug 2026' });
    expect(bucketDate(new Date(2026, 7, 14), 'quarter').key).toBe('2026-Q3');
    expect(bucketDate(new Date(2026, 9, 18), 'week').key).toBe('2026-10-12');
    expect(cellForGroup(due, 'month', '2026-08', today)).toBe('2026-08-01');
    expect(cellForGroup(due, 'month', '2026-10', today)).toBe('2026-10-16');
    expect(cellForGroup(due, 'relative', 'r5', today)).toBe(day(1));
    expect(cellForGroup(due, 'relative', null, today)).toBeNull();
  });

  it('orders checkbox, number and option groups naturally; hides hidden ones', () => {
    const done: PropertyConfig = { name: 'done', type: 'checkbox' };
    expect(groupItems([item('a', { done: false }), item('b', { done: true })], done).map((g) => g.label)).toEqual(['Checked', 'Unchecked']);
    const n: PropertyConfig = { name: 'n', type: 'number' };
    expect(groupItems([item('a', { n: 10 }), item('b', { n: 9 })], n).map((g) => g.key)).toEqual(['9', '10']);
    const s: PropertyConfig = { name: 's', type: 'select', options: [{ value: 'z' }, { value: 'a' }] };
    const groups = groupItems([item('x', { s: 'a' }), item('y', { s: 'free' })], s, { groupConfig: { z: { hidden: true } } });
    expect(groups.map((g) => g.key)).toEqual(['a', 'free']);
  });

  it('new items in a formula group copy the formula inputs from an item in the group', () => {
    const props: PropertyConfig[] = [
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'amt', label: 'Amount', type: 'number' },
      { name: 'month', label: 'Month', type: 'formula', formula: 'formatDate({Date}, "YYYY-MM")' },
    ];
    const items = computeItems([item('a', { date: '2026-08-03', amt: 5 }), item('b', { date: '2026-09-01', amt: 9 })], props);
    const [aug] = groupItems(items, props[2]);
    expect(aug.key).toBe('2026-08');
    expect(cellsForGroup(props[2], props, 'none', aug, aug.items[0])).toEqual({ date: '2026-08-03' });
    expect(cellsForGroup(props[0], props, 'month', groupItems(items, props[0], { bucket: 'month' })[1])).toEqual({ date: '2026-09-01' });
  });
});
