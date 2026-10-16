import type { ChartConfig, NumberFormat, PropertyConfig } from '../types';
import { formatNumber } from '../render/values';
import type { ChartData } from './data';
import type { EChartsOption } from './echarts';

/** Theme colors, read from Obsidian's CSS variables (the SVG renderer can't use `var()`). */
export interface Theme {
  bg: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  font: string;
}

export function readTheme(el: HTMLElement): Theme {
  const s = getComputedStyle(el);
  const v = (name: string, d: string): string => s.getPropertyValue(name).trim() || d;
  return {
    bg: v('--background-primary', '#fff'),
    text: v('--text-normal', '#222'),
    muted: v('--text-muted', '#666'),
    faint: v('--text-faint', '#999'),
    border: v('--background-modifier-border', '#ddd'),
    font: v('--font-interface', 'sans-serif'),
  };
}

/** The number format shared by the plotted value properties, if any. */
export function valueFormat(chart: ChartConfig, properties: PropertyConfig[]): NumberFormat | undefined {
  if (!chart.values.length || chart.aggregate === 'count') return undefined;
  const ps = chart.values.map((n) => properties.find((p) => p.name === n)).filter((p): p is PropertyConfig => !!p);
  const f = ps[0]?.format;
  return ps.every((x) => JSON.stringify(x.format) === JSON.stringify(f)) ? f : undefined;
}

const axisFmt = (n: number, f?: NumberFormat): string =>
  Math.abs(n) >= 10000
    ? formatNumber(n, { ...(f ?? { style: 'plain' }), style: f?.style === 'currency' ? 'currency' : 'compact', decimals: undefined }).replace(/(\.\d)\d+/, '$1')
    : formatNumber(n, f);

/** ChartData + settings → an ECharts option, styled from the theme. */
export function buildOption(
  data: ChartData,
  chart: ChartConfig,
  opts: { theme: Theme; format?: NumberFormat; hidden: Set<string>; sliceColors?: string[]; xIsDate?: boolean },
): EChartsOption {
  const { theme, format, hidden } = opts;
  const fmt = (n: unknown): string => (typeof n === 'number' ? formatNumber(n, format) : String(n ?? '—'));
  const base = {
    animationDuration: 300,
    textStyle: { fontFamily: theme.font, color: theme.muted },
    legend: { show: false, selected: Object.fromEntries(data.series.map((s) => [s.name, !hidden.has(s.name)])) },
    tooltip: { confine: true, backgroundColor: theme.bg, borderColor: theme.border, textStyle: { color: theme.text, fontFamily: theme.font, fontSize: 12 } },
  };

  if (chart.type === 'pie' || chart.type === 'donut') {
    const s = data.series[0];
    const colors = opts.sliceColors ?? [];
    return {
      ...base,
      legend: { show: false, selected: Object.fromEntries(data.categories.map((c) => [c.label, !hidden.has(c.label)])) },
      tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: fmt },
      series: [
        {
          type: 'pie',
          radius: chart.type === 'donut' ? ['45%', '72%'] : '72%',
          center: ['50%', '52%'],
          itemStyle: { borderColor: theme.bg, borderWidth: 2, borderRadius: 3 },
          label: { show: chart.showLabels, color: theme.muted, formatter: (p: { name: string; percent: number }) => `${p.name} ${p.percent.toFixed(0)}%` },
          data: data.categories.map((c, i) => ({ name: c.label, value: s?.data[i] ?? 0, itemStyle: { color: colors[i] } })),
        },
      ],
    };
  }

  const grid = { left: 8, right: 16, top: chart.showLabels ? 24 : 16, bottom: 8, containLabel: true };
  const valueAxis = {
    type: 'value',
    axisLabel: { color: theme.faint, formatter: (v: number) => axisFmt(v, format) },
    splitLine: { lineStyle: { color: theme.border, opacity: 0.6 } },
  };

  if (chart.type === 'scatter') {
    return {
      ...base,
      grid,
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (p: { seriesName: string; value: [number, number] }) => `${p.seriesName}<br>${fmt(p.value[0])}, <b>${fmt(p.value[1])}</b>`,
      },
      xAxis: opts.xIsDate ? { type: 'time', axisLabel: { color: theme.faint }, splitLine: { show: false } } : { ...valueAxis, scale: true },
      yAxis: { ...valueAxis, scale: true },
      series: data.series.map((s, i) => ({
        type: 'scatter',
        name: s.name,
        symbolSize: 9,
        itemStyle: { color: s.color, opacity: 0.85 },
        data: (data.points?.[i] ?? []).map((p) => [p.x, p.y, p.id]),
      })),
    };
  }

  const categoryAxis = {
    type: 'category',
    data: data.categories.map((c) => c.label),
    axisLabel: { color: theme.muted, hideOverlap: true },
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
  };
  const bar = chart.type === 'bar';
  return {
    ...base,
    grid,
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: bar ? 'shadow' : 'line' }, valueFormatter: fmt },
    xAxis: chart.horizontal && bar ? valueAxis : categoryAxis,
    yAxis: chart.horizontal && bar ? { ...categoryAxis, inverse: true } : valueAxis,
    series: data.series.map((s) => ({
      type: bar ? 'bar' : 'line',
      name: s.name,
      stack: chart.stacked ? 'total' : undefined,
      data: s.data,
      itemStyle: { color: s.color, borderRadius: bar && !chart.stacked ? 3 : 0 },
      lineStyle: bar ? undefined : { color: s.color, width: 2 },
      areaStyle: chart.type === 'area' ? { opacity: chart.stacked ? 0.55 : 0.2 } : undefined,
      symbol: bar ? undefined : 'circle',
      symbolSize: 6,
      connectNulls: !bar,
      barMaxWidth: 48,
      emphasis: { focus: 'series' },
      label: {
        show: chart.showLabels,
        position: chart.stacked ? 'inside' : chart.horizontal ? 'right' : 'top',
        color: chart.stacked ? '#fff' : theme.muted,
        fontSize: 11,
        formatter: (p: { value: number | null }) => (p.value ? axisFmt(p.value, format) : ''),
      },
    })),
  };
}
