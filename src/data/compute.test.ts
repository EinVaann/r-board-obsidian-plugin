import { describe, expect, it } from 'vitest';
import type { BoardItem, PropertyConfig } from '../types';
import { evaluateFormula, type FValue } from '../formula/evaluate';
import { renameRefs } from '../formula/tokenize';
import { computeItems } from './compute';
import { toStored } from './properties';
import { parseDatabaseConfig, serializeDatabase } from '../config';
import { applySort } from '../render/sort';
import { formatNumber, optionFor, relativeDate } from '../render/values';

const run = (src: string, vals: Record<string, FValue> = {}) =>
  evaluateFormula(src, {
    resolve: (n) => {
      if (!(n in vals)) throw new Error(`Unknown field {${n}}`);
      return vals[n];
    },
  });

describe('formula engine', () => {
  it('evaluates with precedence, refs, lists and dates', () => {
    expect(run('1 + 2 * 3 ^ 2')).toBe(19);
    expect(run('{Unit price} * {Qty}', { 'Unit price': 2.5, Qty: 4 })).toBe(10);
    expect(run('if({t} = "Salary", {a}, -{a})', { t: 'salary', a: 100 })).toBe(100);
    expect(run('contains({tags}, "food")', { tags: ['Food'] })).toBe(true);
    expect(run('formatDate(dateAdd({d}, 1, "month"), "YYYY-MM-DD")', { d: new Date(2026, 0, 31) })).toBe('2026-02-28');
    expect(() => run('1/0')).toThrow(/Division/);
  });

  it('rewrites references on rename', () => {
    expect(renameRefs('{a} + {ab}', 'a', 'Amount')).toBe('{Amount} + {ab}');
  });
});

const props: PropertyConfig[] = [
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'to-play', label: 'To Play', color: '#7066ff' }, { value: 'playing' }] },
  { name: 'score', label: 'Score', type: 'number' },
  { name: 'released', type: 'date' },
  { name: 'double', type: 'formula', formula: '{Score} * 2' },
  { name: 'quad', type: 'formula', formula: '{double} * 2' },
  { name: 'loop', type: 'formula', formula: '{loop} + 1' },
  { name: 'label', type: 'formula', formula: '{Title} & " — " & {Status}' },
];
const item = (title: string, values: Record<string, unknown>): BoardItem => ({ id: `${title}.md`, title, values, tags: [] });

describe('formula properties', () => {
  const [hades, override, empty] = computeItems(
    [item('Hades', { status: 'to-play', score: '9' }), item('Celeste', { score: 8, double: '=100' }), item('Untitled', {})],
    props,
  );

  it('computes formulas from other properties, by label or key, including other formulas', () => {
    expect(hades.values.double).toBe(18);
    expect(hades.values.quad).toBe(36);
    expect(hades.values.label).toBe('Hades — To Play');
  });

  it('reports cycles as errors without failing the rest', () => {
    expect(hades.errors?.loop).toMatch(/Circular/);
    expect(hades.values.loop).toBeNull();
    expect(hades.values.double).toBe(18);
  });

  it('honors per-item overrides ("=expr" or a literal)', () => {
    expect(override.values.double).toBe(100);
    expect(override.values.quad).toBe(200);
    expect(empty.values.double).toBe(0);
  });

  it('leaves items untouched when there are no formulas', () => {
    const plain = [item('A', { score: 1 })];
    expect(computeItems(plain, props.slice(0, 3))).toBe(plain);
  });
});

describe('values', () => {
  it('coerces edited values to what each type stores', () => {
    expect(toStored({ name: 'n', type: 'number' }, '12.5')).toBe(12.5);
    expect(toStored({ name: 'c', type: 'checkbox' }, 'yes')).toBe(true);
    expect(toStored({ name: 'm', type: 'multi' }, 'a, b,, c')).toEqual(['a', 'b', 'c']);
    expect(toStored({ name: 't', type: 'text' }, '')).toBeNull();
    expect(toStored({ name: 's', type: 'select' }, 'playing')).toBe('playing');
  });

  it('labels and colors option values, synthesizing unlisted ones', () => {
    expect(optionFor(props[0], 'to-play')).toEqual({ value: 'to-play', label: 'To Play', color: '#7066ff' });
    expect(optionFor(props[0], 'finished').label).toBe('finished');
    expect(optionFor(props[0], 'finished').color).toBe(optionFor(props[0], 'finished').color);
  });

  it('formats numbers and relative dates', () => {
    expect(formatNumber(1234.5, { style: 'currency', currency: '€', decimals: 2 })).toMatch(/^€1.234.50$/);
    expect(formatNumber(0.25, { style: 'percent' })).toMatch(/25\s?%/);
    const now = new Date(2026, 9, 16, 15);
    expect(relativeDate(new Date(2026, 9, 17), now)).toBe('Tomorrow');
    expect(relativeDate(new Date(2026, 9, 13), now)).toBe('3 days ago');
    expect(relativeDate(new Date(2026, 10, 20), now)).toBe('in 5 weeks');
  });

  it('sorts selects in option order, then free values; dates chronologically', () => {
    const items = [item('a', { status: 'zzz' }), item('b', { status: 'playing' }), item('c', { status: 'to-play' })];
    expect(applySort(items, { property: 'status', dir: 'asc' }, props).map((i) => i.title)).toEqual(['c', 'b', 'a']);
    const dated = [item('x', { released: '2021-01-02' }), item('y', { released: '2020-12-31' })];
    expect(applySort(dated, { property: 'released', dir: 'asc' }, props).map((i) => i.title)).toEqual(['y', 'x']);
  });
});

describe('config', () => {
  it('round-trips the new property settings and keeps old boards readable', () => {
    const raw = JSON.stringify({
      sourceTag: 'game',
      properties: [
        { name: 'status', type: 'select', options: ['a', { value: 'b', label: 'B', color: 'red' }, { value: 'a' }] },
        { name: 'price', type: 'number', format: { style: 'currency', currency: '$', decimals: 2, grouping: false } },
        { name: 'total', type: 'formula', formula: '{price} * 2', render: 'bar', max: 10 },
        { name: 'due', type: 'date', includeTime: true },
        { name: 'legacy', type: 'nonsense' },
      ],
      views: [],
    });
    const parsed = parseDatabaseConfig(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [status, price, total, due, legacy] = parsed.config.properties;
    expect(status.options).toEqual([{ value: 'a' }, { value: 'b', label: 'B', color: 'red' }]);
    expect(price.format).toEqual({ style: 'currency', currency: '$', decimals: 2, grouping: false });
    expect(total.formula).toBe('{price} * 2');
    expect(due.includeTime).toBe(true);
    expect(legacy.type).toBe('text');
    const again = parseDatabaseConfig(serializeDatabase(parsed.config));
    expect(again.ok && again.config.properties).toEqual(parsed.config.properties);
  });
});
