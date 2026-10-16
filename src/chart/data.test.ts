import { describe, expect, it } from 'vitest';
import type { BoardItem, PropertyConfig } from '../types';
import { defaultChartConfig } from '../config';
import { buildChartData, categoryColors, cellKey } from './data';

const props: PropertyConfig[] = [
  { name: 'type', label: 'Type', type: 'select', options: [{ value: 'f', label: 'Food', color: '#f00' }, { value: 'g', label: 'Gas' }] },
  { name: 'amt', label: 'Amount', type: 'number' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'tags', label: 'Tags', type: 'multi' },
];
const item = (id: string, values: Record<string, unknown>): BoardItem => ({ id, title: id, values, tags: [] });
const items = [
  item('a', { type: 'f', amt: 10, date: '2026-08-02', tags: ['x', 'y'] }),
  item('b', { type: 'g', amt: 30, date: '2026-08-20', tags: ['x'] }),
  item('c', { type: 'f', amt: 5, date: '2026-09-01' }),
];

describe('chart data', () => {
  it('sums by month, split into option-colored series, and remembers the items in each cell', () => {
    const d = buildChartData({ ...defaultChartConfig(), x: 'date', dateBucket: 'month', splitBy: 'type', values: ['amt'] }, props, items);
    expect(d.categories.map((c) => c.label)).toEqual(['Aug 2026', 'Sep 2026']);
    expect(d.series.map((s) => [s.name, s.color, s.data])).toEqual([
      ['Food', '#f00', [10, 5]],
      ['Gas', expect.any(String), [30, null]],
    ]);
    expect(d.itemsAt.get(cellKey('2026-08', 'f'))).toEqual(['a']);
  });

  it('counts items when no value is chosen; a multi-select counts in each of its values', () => {
    const d = buildChartData({ ...defaultChartConfig(), x: 'tags' }, props, items);
    expect(d.categories.map((c) => c.key)).toEqual(['x', 'y', '￿']);
    expect(d.series[0].data).toEqual([2, 1, 1]);
  });

  it('orders by value and colors pie slices by option', () => {
    const chart = { ...defaultChartConfig(), type: 'donut' as const, x: 'type', values: ['amt'], sort: 'value-desc' as const };
    const d = buildChartData(chart, props, items);
    expect(d.categories.map((c) => c.label)).toEqual(['Gas', 'Food']);
    expect(d.series[0].data).toEqual([30, 15]);
    expect(categoryColors(chart, props, d.categories)[1]).toBe('#f00');
  });

  it('plots scatter points and asks for a Y value when missing', () => {
    expect(buildChartData({ ...defaultChartConfig(), type: 'scatter', x: 'date' }, props, items).problem).toMatch(/Y axis/);
    const d = buildChartData({ ...defaultChartConfig(), type: 'scatter', x: 'date', values: ['amt'] }, props, items);
    expect(d.points?.[0].map((p) => p.y)).toEqual([10, 30, 5]);
  });
});
