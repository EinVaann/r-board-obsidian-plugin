import type { Aggregate, BoardItem, ChartConfig, PropertyConfig } from '../types';
import { categoriesOf, orderKeys } from '../data/group';
import { asDate, asNumber, optionFor } from '../render/values';

/** Series colors when nothing else picks one (readable in light and dark themes). */
export const PALETTE = ['#4ECDC4', '#FF6B9D', '#FFB347', '#A78BFA', '#34D399', '#FB923C', '#60A5FA', '#F87171', '#FACC15', '#94A3B8'];

export interface Category {
  key: string;
  label: string;
}

export interface Series {
  key: string;
  name: string;
  color: string;
  /** One value per category (null = no items). */
  data: (number | null)[];
}

export interface ScatterPoint {
  x: number;
  y: number;
  id: string;
}

export interface ChartData {
  categories: Category[];
  series: Series[];
  /** Scatter only: one list of points per series. */
  points?: ScatterPoint[][];
  /** Item ids behind each (category, series) cell, for drill-down. */
  itemsAt: Map<string, string[]>;
  itemCount: number;
  /** Set when the settings can't be drawn yet. */
  problem?: string;
}

export const cellKey = (cat: string, series: string): string => `${cat}\u0000${series}`;

const isPie = (c: ChartConfig): boolean => c.type === 'pie' || c.type === 'donut';
const hasOptions = (p: PropertyConfig | null | undefined): p is PropertyConfig => !!p && (p.type === 'select' || p.type === 'multi');

function aggregate(values: number[], count: number, agg: Aggregate): number | null {
  if (agg === 'count') return count;
  if (!values.length) return null;
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
  }
}

/** A value as a plotted number (checkboxes count as 0 / 1). */
function numberOf(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return asNumber(v);
}

/**
 * Chart pipeline over already filtered items: group by x (with date buckets),
 * split into series, aggregate. Pure, so views and embeds draw the same numbers.
 */
export function buildChartData(chart: ChartConfig, properties: PropertyConfig[], items: BoardItem[], today = new Date()): ChartData {
  const prop = (name: string | null): PropertyConfig | null => (name ? properties.find((p) => p.name === name) ?? null : null);
  const xProp = prop(chart.x);
  const splitProp = isPie(chart) ? null : prop(chart.splitBy);
  const valueProps = chart.values.map(prop).filter((p): p is PropertyConfig => !!p);
  const itemsAt = new Map<string, string[]>();

  if (chart.type === 'scatter') return buildScatter(chart, items, xProp, splitProp, valueProps, itemsAt);

  const multiValue = !splitProp && valueProps.length > 1;
  const catMap = new Map<string, Category>();
  const serMap = new Map<string, { key: string; name: string; colorHint?: string }>();
  const acc = new Map<string, { values: number[]; count: number }>();

  const addTo = (cat: Category, serKey: string, id: string, value: number | null): void => {
    catMap.set(cat.key, cat);
    const k = cellKey(cat.key, serKey);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { values: [], count: 0 }));
    a.count++;
    if (value !== null) a.values.push(value);
    const list = itemsAt.get(k);
    if (list) list.push(id);
    else itemsAt.set(k, [id]);
  };

  items.forEach((item, i) => {
    const cats: Category[] = xProp
      ? categoriesOf(item, xProp, chart.dateBucket === 'none' && xProp.type === 'date' ? 'day' : chart.dateBucket, today)
      : [{ key: String(i).padStart(6, '0'), label: item.title || `#${i + 1}` }];
    if (xProp && cats.length === 0) cats.push({ key: '￿', label: 'No value' });
    if (multiValue) {
      for (const vp of valueProps) {
        serMap.set(vp.name, { key: vp.name, name: vp.label ?? vp.name });
        for (const cat of cats) addTo(cat, vp.name, item.id, numberOf(item.values[vp.name]));
      }
      return;
    }
    const value = valueProps[0] ? numberOf(item.values[valueProps[0].name]) : null;
    let splits: Category[] = splitProp ? categoriesOf(item, splitProp, 'none', today) : [{ key: '', label: '' }];
    if (splitProp && splits.length === 0) splits = [{ key: '￿', label: 'No value' }];
    for (const s of splits) {
      const hint = hasOptions(splitProp) && s.key !== '￿' ? optionFor(splitProp, s.key).color : undefined;
      serMap.set(s.key, { key: s.key, name: splitProp ? s.label : valueProps[0] ? valueProps[0].label ?? valueProps[0].name : 'Count', colorHint: hint });
      for (const cat of cats) addTo(cat, s.key, item.id, value);
    }
  });

  const agg: Aggregate = valueProps.length ? chart.aggregate : 'count';
  const ordered = (p: PropertyConfig | null, keys: string[]): string[] => {
    const empty = keys.filter((k) => k === '￿');
    return [...(p ? orderKeys(p, keys.filter((k) => k !== '￿')) : keys), ...empty];
  };
  let categories = ordered(xProp, [...catMap.keys()]).map((k) => catMap.get(k)!);
  const seriesDefs = splitProp ? ordered(splitProp, [...serMap.keys()]).map((k) => serMap.get(k)!) : [...serMap.values()];

  const series: Series[] = seriesDefs.map((s, i) => ({
    key: s.key,
    name: s.name,
    color: chart.colors[s.name] ?? s.colorHint ?? PALETTE[i % PALETTE.length],
    data: categories.map((c) => {
      const a = acc.get(cellKey(c.key, s.key));
      return a ? aggregate(a.values, a.count, agg) : null;
    }),
  }));

  if (chart.sort !== 'x' && categories.length) {
    const totals = categories.map((_, ci) => series.reduce((t, s) => t + (s.data[ci] ?? 0), 0));
    const order = categories.map((_, i) => i).sort((a, b) => (chart.sort === 'value-asc' ? totals[a] - totals[b] : totals[b] - totals[a]));
    categories = order.map((i) => categories[i]);
    for (const s of series) s.data = order.map((i) => s.data[i]);
  }

  return { categories, series, itemsAt, itemCount: items.length };
}

function buildScatter(
  chart: ChartConfig,
  items: BoardItem[],
  xProp: PropertyConfig | null,
  splitProp: PropertyConfig | null,
  valueProps: PropertyConfig[],
  itemsAt: Map<string, string[]>,
): ChartData {
  const yProp = valueProps[0];
  if (!yProp) return { categories: [], series: [], points: [], itemsAt, itemCount: items.length, problem: 'Pick a value property for the Y axis.' };
  const groups = new Map<string, { name: string; color?: string; pts: ScatterPoint[] }>();
  items.forEach((item, i) => {
    const raw = xProp ? item.values[xProp.name] : i + 1;
    const x = xProp?.type === 'date' || raw instanceof Date ? asDate(raw)?.getTime() ?? null : numberOf(raw);
    const y = numberOf(item.values[yProp.name]);
    if (x === null || y === null) return;
    const splits = splitProp ? categoriesOf(item, splitProp, 'none') : [{ key: '', label: yProp.label ?? yProp.name }];
    for (const s of splits) {
      let g = groups.get(s.key);
      if (!g) groups.set(s.key, (g = { name: s.label, color: hasOptions(splitProp) ? optionFor(splitProp, s.key).color : undefined, pts: [] }));
      g.pts.push({ x, y, id: item.id });
    }
  });
  const list = [...groups.entries()];
  return {
    categories: [],
    series: list.map(([key, g], i) => ({ key, name: g.name, color: chart.colors[g.name] ?? g.color ?? PALETTE[i % PALETTE.length], data: [] })),
    points: list.map(([, g]) => g.pts),
    itemsAt,
    itemCount: items.length,
  };
}

/** Slice colors for pie charts: the x property's option colors where available. */
export function categoryColors(chart: ChartConfig, properties: PropertyConfig[], cats: Category[]): string[] {
  const xProp = chart.x ? properties.find((p) => p.name === chart.x) : undefined;
  return cats.map((c, i) => chart.colors[c.label] ?? (hasOptions(xProp) ? optionFor(xProp, c.key).color : PALETTE[i % PALETTE.length]));
}
