import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardItem, ChartConfig, PropertyConfig } from '../types';
import { defaultChartConfig, propertyLabel } from '../config';
import { useBoardContext } from '../board/context';
import { TitleLink, useFieldEnv } from '../components/Card';
import { fieldNode } from '../components/fields';
import { asNumber, formatNumber } from '../render/values';
import { buildChartData, categoryColors, cellKey } from './data';
import { echarts } from './echarts';
import { buildOption, readTheme, valueFormat } from './option';

interface Props {
  chart: ChartConfig | undefined;
  /** Every property of the database. */
  properties: PropertyConfig[];
  /** Already filtered items. */
  items: BoardItem[];
  /** Properties shown in the drill-down list. */
  detailProperties: PropertyConfig[];
  height?: number;
}

interface Drill {
  title: string;
  ids: string[];
}

/** A chart with a click-to-hide legend and click-a-bar-to-list-its-items drill-down. */
export function ChartView({ chart: config, properties, items, detailProperties, height = 340 }: Props) {
  const { app } = useBoardContext();
  const chart = config ?? defaultChartConfig();
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<Drill | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const clickTimer = useRef<number | null>(null);

  const data = useMemo(() => buildChartData(chart, properties, items), [chart, properties, items]);
  const pie = chart.type === 'pie' || chart.type === 'donut';
  const sliceColors = useMemo(() => (pie ? categoryColors(chart, properties, data.categories) : undefined), [pie, chart, properties, data]);
  const format = valueFormat(chart, properties);
  const xType = chart.x ? properties.find((p) => p.name === chart.x)?.type : undefined;
  const legend = pie ? data.categories.map((c, i) => ({ name: c.label, color: sliceColors![i] })) : data.series.map((s) => ({ name: s.name, color: s.color }));
  const empty = data.problem || (pie ? !data.categories.length : !data.series.length || (!data.categories.length && !data.points?.some((p) => p.length)));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const inst = echarts.init(el, undefined, { renderer: 'svg' });
    instRef.current = inst;
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  // Theme colors are read when drawing, so redraw when the theme changes.
  useEffect(() => {
    const ref = app.workspace.on?.('css-change', () => setThemeTick((t) => t + 1));
    return () => void (ref && app.workspace.offref(ref));
  }, [app]);

  useEffect(() => {
    const inst = instRef.current;
    const el = hostRef.current;
    if (!inst || !el) return;
    inst.setOption(buildOption(data, chart, { theme: readTheme(el), format, hidden, sliceColors, xIsDate: xType === 'date' }), { notMerge: true });
  }, [data, chart, hidden, sliceColors, format, xType, themeTick]);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const onClick = (p: { dataIndex: number; seriesIndex: number; data: unknown }): void => {
      if (chart.type === 'scatter') {
        const id = Array.isArray(p.data) ? (p.data[2] as string) : undefined;
        if (id) setDrill({ title: data.series[p.seriesIndex]?.name ?? '', ids: [id] });
        return;
      }
      const cat = data.categories[p.dataIndex];
      const ser = pie ? data.series[0] : data.series[p.seriesIndex];
      if (!cat || !ser) return;
      const title = pie || data.series.length === 1 ? cat.label : `${cat.label} · ${ser.name}`;
      setDrill((cur) => (cur?.title === title ? null : { title, ids: data.itemsAt.get(cellKey(cat.key, ser.key)) ?? [] }));
    };
    inst.on('click', onClick as never);
    return () => void inst.off('click', onClick as never);
  }, [data, chart.type, pie]);

  // Click: show / hide a series. Double-click: show only it (again: show all).
  const onLegend = (name: string): void => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setHidden((prev) => {
        const others = legend.map((l) => l.name).filter((n) => n !== name);
        return !prev.has(name) && others.every((n) => prev.has(n)) ? new Set() : new Set(others);
      });
    } else {
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        setHidden((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
      }, 220);
    }
  };

  return (
    <div className="rb-chart">
      <div className="rb-chart-canvas" style={{ height }}>
        <div ref={hostRef} className="rb-chart-host" />
        {empty && (
          <div className="rb-chart-empty">
            {data.problem ?? (data.itemCount ? 'Nothing to plot with these settings. Open view settings → Chart.' : 'Nothing matches this view.')}
          </div>
        )}
      </div>
      {chart.showLegend && legend.length > 1 && (
        <div className="rb-legend" title="Click to show / hide · double-click to show only this">
          {legend.map((l) => (
            <span key={l.name} className={hidden.has(l.name) ? 'rb-legend-item rb-off' : 'rb-legend-item'} onClick={() => onLegend(l.name)}>
              <span className="rb-legend-swatch" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
      {drill && (
        <DrillList
          drill={drill}
          items={items}
          properties={detailProperties}
          valueProp={chart.values[0] ? properties.find((p) => p.name === chart.values[0]) : undefined}
          format={format}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

/** The items behind a clicked bar / slice / point. */
function DrillList(p: { drill: Drill; items: BoardItem[]; properties: PropertyConfig[]; valueProp?: PropertyConfig; format: ReturnType<typeof valueFormat>; onClose: () => void }) {
  const env = useFieldEnv();
  const ids = new Set(p.drill.ids);
  const rows = p.items.filter((i) => ids.has(i.id));
  const cols = p.properties.slice(0, 8);
  const total = p.valueProp ? rows.reduce((t, r) => t + (asNumber(r.values[p.valueProp!.name]) ?? 0), 0) : null;
  return (
    <div className="rb-drill">
      <div className="rb-drill-head">
        <span className="rb-drill-title">{p.drill.title}</span>
        <span className="rb-drill-meta">
          {rows.length} item{rows.length === 1 ? '' : 's'}
          {total !== null && ` · total ${formatNumber(total, p.format)}`}
        </span>
        <button className="rb-icon-btn" onClick={p.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="rb-drill-scroll">
        <table className="rb-table">
          <thead>
            <tr>
              <th className="rb-th">Title</th>
              {cols.map((c) => (
                <th key={c.name} className="rb-th">
                  {propertyLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="rb-tr">
                <td className="rb-td">
                  <TitleLink item={r} />
                </td>
                {cols.map((c) => (
                  <td key={c.name} className="rb-td">
                    {fieldNode(env, r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
