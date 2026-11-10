import { useCallback, useMemo, useState } from 'react';
import { debounce } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type {
  Aggregate,
  CardSize,
  ChartConfig,
  ChartType,
  DatabaseConfig,
  DateBucket,
  GalleryLayout,
  GroupColumnConfig,
  LoadLimit,
  PagingMode,
  PropertyConfig,
  SortDir,
  ViewConfig,
  ViewType,
} from '../types';
import { defaultChartConfig, NO_SORT_KEY, propertyLabel, TITLE_SORT_KEY } from '../config';
import { defaultScheduleConfig } from '../schedule/config';
import { countFilterRules } from '../data/filter';
import { useBoard, useBoardContext } from '../board/context';
import { Icon } from '../react/Icon';
import { PROPERTY_TYPE_ICON } from './PropertyEditor';
import { DragHandle, Field, Segmented, Select, SettingRow, SettingsCard, SettingsTabs, SortableList, TextInput, Toggle, type Option } from './controls';
import { Button, IconButton, Input } from '../ui';
import { ExportSettings } from './ExportSettings';
import { ScheduleSettings } from './ScheduleSettings';

type ViewRecipe = (draft: ViewConfig) => void;

/**
 * View settings modal content: General, Display, (kanban) Columns and Export. Edits
 * the view at `viewIndex` live; `onDelete` removes it (and closes the modal).
 */
export function ViewSettings({ viewIndex, onDelete }: { viewIndex: number; onDelete: () => void }) {
  const config = useBoard((s) => s.config);
  const updateView = useBoard((s) => s.updateView);
  const view = config?.views[viewIndex];
  // Stable, so debounced editors (the column color pickers) keep their timer.
  const edit = useCallback((recipe: ViewRecipe) => updateView(viewIndex, recipe), [updateView, viewIndex]);
  if (!config || !view) return null;

  const tabs = [
    { id: 'general', label: 'General', icon: 'sliders-horizontal', content: <General config={config} view={view} viewIndex={viewIndex} edit={edit} onDelete={onDelete} /> },
    { id: 'display', label: 'Display', icon: 'eye', content: <Display config={config} view={view} edit={edit} /> },
  ];
  if (view.type === 'kanban') tabs.push({ id: 'columns', label: 'Columns', icon: 'columns-3', content: <Columns view={view} edit={edit} /> });
  if (view.type === 'chart') tabs.splice(1, 0, { id: 'chart', label: 'Chart', icon: 'bar-chart-3', content: <ChartSettings config={config} view={view} edit={edit} /> });
  if (view.type === 'schedule') tabs.splice(1, 1, { id: 'schedule', label: 'Schedule', icon: 'calendar-range', content: <ScheduleSettings config={config} view={view} edit={edit} /> });
  else tabs.push({ id: 'export', label: 'Export', icon: 'download', content: <ExportSettings config={config} view={view} /> });
  return <SettingsTabs tabs={tabs} initial={view.type === 'chart' ? 'chart' : view.type === 'schedule' ? 'schedule' : undefined} />;
}

interface TabProps {
  config: DatabaseConfig;
  view: ViewConfig;
  edit: (recipe: ViewRecipe) => void;
}

function General({ config, view, viewIndex, edit, onDelete }: TabProps & { viewIndex: number; onDelete: () => void }) {
  const { actions } = useBoardContext();
  const sort = view.sort ?? { property: TITLE_SORT_KEY, dir: 'asc' as const };
  // Kanban columns need one value per card (lists can't be columns).
  const groupProps =
    view.type === 'kanban'
      ? config.properties.filter((p) => ['text', 'select', 'date', 'checkbox', 'number', 'formula'].includes(p.type))
      : config.properties;
  const filters = countFilterRules(view.filter);
  const groupProp = view.group ? config.properties.find((p) => p.name === view.group) : undefined;
  const subProp = view.subGroup ? config.properties.find((p) => p.name === view.subGroup) : undefined;

  return (
    <>
      <SettingsCard icon="sliders-horizontal" title="View" desc="Name, type and what shows beside it.">
      <SettingRow name="Name">
        <TextInput value={view.name} onChange={(v) => edit((d) => void (d.name = v))} />
      </SettingRow>
      <SettingRow name="Type">
        <Select<ViewType>
          value={view.type}
          options={[
            { value: 'gallery', label: 'Gallery' },
            { value: 'kanban', label: 'Kanban' },
            { value: 'table', label: 'Table' },
            { value: 'recipe', label: 'Recipe' },
            { value: 'chart', label: 'Chart' },
            ...(config.kind === 'table' ? [] : [{ value: 'schedule' as const, label: 'Schedule' }]),
          ]}
          onChange={(v) =>
            edit((d) => {
              d.type = v;
              if (v === 'chart' && !d.chart) d.chart = defaultChartConfig();
              if (v === 'schedule' && !d.schedule) d.schedule = defaultScheduleConfig();
            })
          }
        />
      </SettingRow>
      {/* Charts and schedules use everything that passes the filter: no paging, sort or sections. */}
      {view.type !== 'chart' && view.type !== 'schedule' && (
      <>
      <SettingRow
        name={view.type === 'table' && view.paging === 'pages' ? 'Page size' : 'Load limit'}
        desc={view.type === 'table' && view.paging === 'pages' ? 'Rows per page.' : 'How many items show before a "View More" button.'}
      >
        <Select
          value={String(view.limit ?? 50)}
          options={[
            { value: '10', label: '10' },
            { value: '50', label: '50' },
            { value: '100', label: '100' },
            { value: 'none', label: 'No limit' },
          ]}
          onChange={(v) => edit((d) => void (d.limit = (v === 'none' ? 'none' : Number(v)) as LoadLimit))}
        />
      </SettingRow>
      {view.type === 'table' && (
        <SettingRow name="Paging" desc="Grow the list with a View More button, or split it into numbered pages.">
          <Segmented<PagingMode>
            value={view.paging ?? 'more'}
            options={[
              { value: 'more', label: 'View more' },
              { value: 'pages', label: 'Pages' },
            ]}
            onChange={(v) => edit((d) => void (d.paging = v === 'pages' ? 'pages' : undefined))}
          />
        </SettingRow>
      )}
      {view.type === 'table' && (
        <SettingRow name="Summary row" desc="A row under the table (and each group) with totals. Click a cell in it to choose Sum, Average, Count…" toggle>
          <Toggle checked={!!view.summary} onChange={(on) => edit((d) => void (d.summary = on || undefined))} label="Summary row" />
        </SettingRow>
      )}
      <SettingRow name="Sort by">
        <Select
          value={sort.property}
          options={[
            { value: NO_SORT_KEY, label: 'None' },
            { value: TITLE_SORT_KEY, label: 'Title' },
            ...config.properties.map((p) => ({ value: p.name, label: propertyLabel(p) })),
          ]}
          onChange={(v) => edit((d) => void (d.sort = { property: v, dir: sort.dir }))}
        />
        <Select<SortDir>
          value={sort.dir}
          disabled={sort.property === NO_SORT_KEY}
          options={[
            { value: 'asc', label: 'Ascending' },
            { value: 'desc', label: 'Descending' },
          ]}
          onChange={(v) => edit((d) => void (d.sort = { property: sort.property, dir: v }))}
        />
      </SettingRow>
      <SettingRow name={view.type === 'kanban' ? 'Columns' : 'Group by'} desc={view.type === 'kanban' ? 'Required: the property whose values are the columns.' : 'Optional: section headers.'}>
        <Select
          value={view.group ?? ''}
          options={[
            { value: '', label: view.type === 'kanban' ? '(choose a property)' : 'None' },
            ...groupProps.map((p) => ({ value: p.name, label: propertyLabel(p) })),
          ]}
          onChange={(v) =>
            edit((d) => {
              d.group = v || undefined;
              // Collapsed keys, pinned columns and date buckets belong to the old property.
              d.collapsed = undefined;
              d.groupBucket = undefined;
              if (d.subGroup === d.group) d.subGroup = undefined;
            })
          }
        />
      </SettingRow>
      {groupProp && <BucketRow prop={groupProp} value={view.groupBucket} onChange={(b) => edit((d) => void ((d.groupBucket = b), (d.collapsed = undefined)))} />}
      </>
      )}
      {view.type === 'kanban' && (
        <SettingRow name="Rows" desc="Optional: split the board into swimlanes by another property. Every row has every column.">
          <Select
            value={view.subGroup ?? ''}
            options={[{ value: '', label: 'None' }, ...groupProps.filter((p) => p.name !== view.group).map((p) => ({ value: p.name, label: propertyLabel(p) }))]}
            onChange={(v) =>
              edit((d) => {
                d.subGroup = v || undefined;
                d.subGroupBucket = undefined;
              })
            }
          />
        </SettingRow>
      )}
      {view.type === 'kanban' && subProp && (
        <BucketRow prop={subProp} value={view.subGroupBucket} onChange={(b) => edit((d) => void (d.subGroupBucket = b))} />
      )}
      <SettingRow name="Show beside" desc="Split view: show another view next to this one.">
        <Select
          value={view.companion?.view ?? ''}
          options={[{ value: '', label: 'Nothing' }, ...config.views.filter((v) => v.name !== view.name).map((v) => ({ value: v.name, label: v.name }))]}
          onChange={(v) =>
            edit((d) => {
              d.companion = v ? { view: v, position: d.companion?.position ?? 'right', size: d.companion?.size ?? 40, followFilter: d.companion?.followFilter ?? false } : undefined;
            })
          }
        />
      </SettingRow>
      {view.companion && (
        <>
          <SettingRow name="Position">
            <Segmented<'right' | 'below'>
              value={view.companion.position}
              options={[
                { value: 'right', label: 'Right' },
                { value: 'below', label: 'Below' },
              ]}
              onChange={(position) => edit((d) => void (d.companion && (d.companion.position = position)))}
            />
          </SettingRow>
          <SettingRow name="Follow this view's filter" desc="The other view only shows items that pass this view's filter and search." toggle>
            <Toggle
              checked={view.companion.followFilter}
              onChange={(on) => edit((d) => void (d.companion && (d.companion.followFilter = on)))}
              label="Follow this view's filter"
            />
          </SettingRow>
        </>
      )}
      <SettingRow name="Filters" desc={`${filters} active`}>
        <Button onClick={() => actions.openFilter(viewIndex)}>Edit filters…</Button>
      </SettingRow>
      </SettingsCard>
      <div className="rb-settings-danger">
        <Button variant="danger" onClick={onDelete}>
          Delete view
        </Button>
      </div>
    </>
  );
}

/** Chart tab: chart type, axes, series split, values and look. */
function ChartSettings({ config, view, edit }: TabProps) {
  const chart = view.chart ?? defaultChartConfig();
  const set = (patch: Partial<ChartConfig>): void => edit((d) => void (d.chart = { ...(d.chart ?? defaultChartConfig()), ...patch }));
  const props = config.properties;
  const xProp = props.find((p) => p.name === chart.x);
  const numeric = props.filter((p) => p.type === 'number' || p.type === 'formula' || p.type === 'checkbox');
  const pie = chart.type === 'pie' || chart.type === 'donut';
  const bars = chart.type === 'bar';
  const label = (p: PropertyConfig): Option<string> => ({ value: p.name, label: propertyLabel(p) });

  return (
    <>
      <SettingsCard icon="bar-chart-3" title="Chart" desc="What kind of chart, and what each bar, point or slice stands for.">
        <Field label="Type">
          <Segmented<ChartType>
            value={chart.type}
            options={[
              { value: 'bar', label: 'Bar' },
              { value: 'line', label: 'Line' },
              { value: 'area', label: 'Area' },
              { value: 'pie', label: 'Pie' },
              { value: 'donut', label: 'Donut' },
              { value: 'scatter', label: 'Scatter' },
            ]}
            onChange={(type) => set({ type })}
          />
        </Field>
        <div className="rb-sched-grid">
          <Field label={chart.type === 'scatter' ? 'X axis' : pie ? 'Slices' : 'Categories'} hint={chart.type === 'scatter' ? 'number or date' : 'none: one per item'}>
            <Select value={chart.x ?? ''} options={[{ value: '', label: 'None (each item)' }, ...props.map(label)]} onChange={(v) => set({ x: v || null })} />
          </Field>
          {xProp && (xProp.type === 'date' || xProp.type === 'formula') && chart.type !== 'scatter' && (
            <Field label="Group dates by">
              <Select<DateBucket>
                value={chart.dateBucket}
                options={[
                  { value: 'none', label: 'Day' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                  { value: 'quarter', label: 'Quarter' },
                  { value: 'year', label: 'Year' },
                  { value: 'relative', label: 'Relative to today' },
                ]}
                onChange={(dateBucket) => set({ dateBucket })}
              />
            </Field>
          )}
          {!pie && (
            <Field label="Split into series by" hint="one color per value">
              <Select value={chart.splitBy ?? ''} options={[{ value: '', label: 'None' }, ...props.filter((p) => p.name !== chart.x).map(label)]} onChange={(v) => set({ splitBy: v || null })} />
            </Field>
          )}
        </div>
      </SettingsCard>
      <SettingsCard icon="sigma" title={chart.type === 'scatter' ? 'Y axis' : 'Values'} desc={chart.type === 'scatter' ? 'A number property.' : 'Numbers to add up. None picked: count items.'}>
        <div className="rb-chart-values">
          {numeric.length === 0 && <span className="rb-wizard-hint">No number properties.</span>}
          {numeric.map((p) => {
            const on = chart.values.includes(p.name);
            return (
              <label key={p.name} className="rb-chart-value">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => set({ values: on ? chart.values.filter((v) => v !== p.name) : chart.type === 'scatter' ? [p.name] : [...chart.values, p.name] })}
                />
                {propertyLabel(p)}
              </label>
            );
          })}
        </div>
        {chart.values.length > 0 && chart.type !== 'scatter' && (
          <div className="rb-sched-grid rb-chart-agg">
            <Field label="Combine with">
              <Select<Aggregate>
                value={chart.aggregate}
                options={[
                  { value: 'sum', label: 'Sum' },
                  { value: 'avg', label: 'Average' },
                  { value: 'min', label: 'Minimum' },
                  { value: 'max', label: 'Maximum' },
                  { value: 'count', label: 'Count items' },
                ]}
                onChange={(aggregate) => set({ aggregate })}
              />
            </Field>
          </div>
        )}
      </SettingsCard>
      <SettingsCard icon="eye" title="Look" desc="Order, stacking and labels.">
        <div className="rb-sched-grid">
          {chart.type !== 'scatter' && (
            <Field label="Order">
              <Select<ChartConfig['sort']>
                value={chart.sort}
                options={[
                  { value: 'x', label: 'By category' },
                  { value: 'value-desc', label: 'Largest first' },
                  { value: 'value-asc', label: 'Smallest first' },
                ]}
                onChange={(sort) => set({ sort })}
              />
            </Field>
          )}
          {!pie && chart.type !== 'scatter' && (
            <Field label="Stacked" hint="series on top of each other">
              <Toggle checked={chart.stacked} onChange={(stacked) => set({ stacked })} label="Stacked" />
            </Field>
          )}
          {bars && (
            <Field label="Horizontal bars">
              <Toggle checked={chart.horizontal} onChange={(horizontal) => set({ horizontal })} label="Horizontal bars" />
            </Field>
          )}
          <Field label="Legend">
            <Toggle checked={chart.showLegend} onChange={(showLegend) => set({ showLegend })} label="Legend" />
          </Field>
          <Field label="Value labels">
            <Toggle checked={chart.showLabels} onChange={(showLabels) => set({ showLabels })} label="Value labels" />
          </Field>
        </div>
      </SettingsCard>
    </>
  );
}

/** How a date (or date formula) group property is bucketed. */
function BucketRow({ prop, value, onChange }: { prop: PropertyConfig; value?: DateBucket; onChange: (bucket: DateBucket | undefined) => void }) {
  if (prop.type !== 'date' && prop.type !== 'formula') return null;
  return (
    <SettingRow name={`Group ${propertyLabel(prop)} by`} desc="Relative: Older, Last 7 days, Yesterday, Today, Tomorrow, Next 7 days, …">
      <Select<DateBucket>
        value={value ?? 'none'}
        options={[
          { value: 'none', label: prop.type === 'date' ? 'Exact date' : 'As computed' },
          { value: 'relative', label: 'Relative to today' },
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ]}
        onChange={(v) => onChange(v === 'none' ? undefined : v)}
      />
    </SettingRow>
  );
}

/** Display tab: card layout, and which properties show in what order. */
function Display({ config, view, edit }: TabProps) {
  // Shown properties first (in the view's order), then hidden ones (database order).
  const { order, visible } = useMemo(() => {
    const names = config.properties.map((p) => p.name);
    const shown = (view.properties ?? names).filter((n) => names.includes(n));
    return { order: [...shown, ...names.filter((n) => !shown.includes(n))], visible: new Set(shown) };
  }, [config.properties, view.properties]);

  const setVisible = (nextOrder: string[], nextVisible: Set<string>): void =>
    edit((d) => void (d.properties = nextOrder.filter((n) => nextVisible.has(n))));

  const toggle = (name: string): void => {
    const next = new Set(visible);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setVisible(order, next);
  };

  const cards = view.type === 'gallery' || view.type === 'kanban';
  return (
    <>
      {cards && (
        <SettingsCard icon="layout-grid" title="Cards" desc="How each card looks.">
          {view.type === 'gallery' && (
            <SettingRow name="Layout" desc="Masonry flows cards of any height; grid uses fixed tiles.">
              <Segmented<GalleryLayout>
                value={view.layout ?? 'masonry'}
                options={[
                  { value: 'masonry', label: 'Masonry' },
                  { value: 'grid', label: 'Grid' },
                ]}
                onChange={(v) => edit((d) => void (d.layout = v))}
              />
            </SettingRow>
          )}
          <SettingRow name="Card size">
            <Segmented<CardSize>
              value={view.cardSize ?? 'medium'}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
              onChange={(v) => edit((d) => void (d.cardSize = v))}
            />
          </SettingRow>
          <SettingRow name="Show note content" desc="Render an excerpt of each note on the card." toggle>
            <Toggle checked={!!view.showContent} onChange={(on) => edit((d) => void (d.showContent = on))} label="Show note content" />
          </SettingRow>
        </SettingsCard>
      )}

      <SettingsCard
        icon="list"
        title={view.type === 'table' ? 'Columns' : 'Properties'}
        desc={`${visible.size} of ${order.length} shown · drag to reorder. The title is always shown.`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setVisible(order, new Set(order))}>
              Show all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVisible(order, new Set())}>
              Hide all
            </Button>
          </>
        }
      >
      {order.length === 0 ? (
        <div className="rb-wizard-hint">This board has no properties yet — add some in Board settings.</div>
      ) : (
        <>
          <SortableList
            ids={order}
            onReorder={(from, to) => setVisible(arrayMove(order, from, to), visible)}
            className="rb-vis-list"
            renderRow={(name, _i, handle) => {
              const prop = config.properties.find((p) => p.name === name)!;
              const on = visible.has(name);
              return (
                <div className={on ? 'rb-vis-row' : 'rb-vis-row rb-hidden'}>
                  <DragHandle handle={handle} />
                  <Icon name={PROPERTY_TYPE_ICON[prop.type]} className="rb-vis-type" />
                  <div className="rb-vis-text">
                    <span className="rb-vis-name">{propertyLabel(prop)}</span>
                    <span className="rb-vis-meta">{[prop.type, prop.render].filter(Boolean).join(' · ')}</span>
                  </div>
                  <IconButton className="rb-vis-toggle" icon={on ? 'eye' : 'eye-off'} label={on ? 'Hide' : 'Show'} onClick={() => toggle(name)} />
                </div>
              );
            }}
          />
        </>
      )}
      </SettingsCard>
    </>
  );
}

/** Columns tab (kanban): pinned order, label, color, visibility. */
function Columns({ view, edit }: { view: ViewConfig; edit: (recipe: ViewRecipe) => void }) {
  const cols = view.columns ?? [];
  const [draft, setDraft] = useState('');
  // Color pickers fire continuously while dragging; persist once the user settles.
  const setColor = useMemo(
    () => debounce((key: string, color: string) => edit((d) => void ((d.groupConfig ??= {})[key] = { ...d.groupConfig?.[key], color })), 200),
    [edit],
  );

  const patch = (key: string, value: Partial<GroupColumnConfig>): void =>
    edit((d) => {
      const cfg = (d.groupConfig ??= {});
      cfg[key] = { ...cfg[key], ...value };
    });

  const add = (): void => {
    const name = draft.trim();
    setDraft('');
    if (name && !cols.includes(name)) edit((d) => void (d.columns = [...cols, name]));
  };

  return (
    <SettingsCard
      icon="columns-3"
      title="Columns"
      desc="Pin the order of columns and give them a label, color, or hide them. Values not listed follow, sorted; Uncategorized is always last."
    >
      {!view.group && <div className="rb-wizard-hint">Choose a "Group by" property in General first.</div>}

      {cols.length > 0 && (
        <SortableList
          ids={cols}
          onReorder={(from, to) => edit((d) => void (d.columns = arrayMove(cols, from, to)))}
          className="rb-col-config-list"
          rowClassName="rb-col-config-row"
          renderRow={(key, i, handle) => {
            const cfg = view.groupConfig?.[key];
            return (
              <div className={cfg?.hidden ? 'rb-col-row is-hidden' : 'rb-col-row'}>
                <DragHandle handle={handle} />
                <label className="rb-col-swatch" style={{ ['--c' as string]: cfg?.color ?? 'var(--background-modifier-border-hover)' }} title="Color">
                  <input type="color" aria-label={`Color of ${key}`} defaultValue={cfg?.color ?? '#888888'} onChange={(e) => setColor(key, e.target.value)} />
                </label>
                <TextInput size="sm" className="rb-col-field-input" value={cfg?.label ?? ''} placeholder={key} onChange={(v) => patch(key, { label: v.trim() || undefined })} />
                <span className="rb-col-key-label">{key}</span>
                {cfg?.color && <IconButton icon="rotate-ccw" label="Clear color" size="sm" onClick={() => patch(key, { color: undefined })} />}
                <IconButton icon={cfg?.hidden ? 'eye-off' : 'eye'} label={cfg?.hidden ? 'Show column' : 'Hide column'} size="sm" onClick={() => patch(key, { hidden: cfg?.hidden ? undefined : true })} />
                <IconButton icon="trash-2" label="Unpin column" size="sm" tone="danger" onClick={() => edit((d) => void (d.columns = cols.filter((_, j) => j !== i)))} />
              </div>
            );
          }}
        />
      )}

      <div className="rb-col-add-row">
        <Input
          className="rb-col-add-input"
          placeholder="Column value…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <Button icon="plus" onClick={add}>
          Add
        </Button>
      </div>
    </SettingsCard>
  );
}
