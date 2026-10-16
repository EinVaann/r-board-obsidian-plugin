import { useCallback, useMemo, useState } from 'react';
import { debounce } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { CardSize, DatabaseConfig, DateBucket, GalleryLayout, GroupColumnConfig, LoadLimit, PagingMode, PropertyConfig, SortDir, ViewConfig, ViewType } from '../types';
import { NO_SORT_KEY, propertyLabel, TITLE_SORT_KEY } from '../config';
import { countFilterRules } from '../data/filter';
import { useBoard, useBoardContext } from '../board/context';
import { Icon } from '../react/Icon';
import { PROPERTY_TYPE_ICON } from './PropertyEditor';
import { DragHandle, Segmented, Select, SettingRow, SettingsTabs, SortableList, TextInput, Toggle } from './controls';

type ViewRecipe = (draft: ViewConfig) => void;

/**
 * View settings modal content: General, Display, and (kanban) Columns. Edits
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
  return <SettingsTabs tabs={tabs} />;
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
          ]}
          onChange={(v) => edit((d) => void (d.type = v))}
        />
      </SettingRow>
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
      <SettingRow name="Filters" desc={`${filters} active`}>
        <button onClick={() => actions.openFilter(viewIndex)}>Edit filters…</button>
      </SettingRow>
      <SettingRow>
        <button className="mod-warning" onClick={onDelete}>
          Delete view
        </button>
      </SettingRow>
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
        <>
          <h4>Cards</h4>
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
        </>
      )}

      <div className="rb-section-head">
        <h4>{view.type === 'table' ? 'Columns' : 'Properties'}</h4>
        <span className="rb-section-count">
          {visible.size} of {order.length} shown
        </span>
        <div className="rb-spacer" />
        <button className="rb-link-btn" onClick={() => setVisible(order, new Set(order))}>
          Show all
        </button>
        <button className="rb-link-btn" onClick={() => setVisible(order, new Set())}>
          Hide all
        </button>
      </div>

      {order.length === 0 ? (
        <div className="rb-wizard-hint">This board has no properties yet — add some in Board settings.</div>
      ) : (
        <>
          <div className="rb-wizard-hint">Drag to reorder. The title is always shown.</div>
          <SortableList
            ids={order}
            onReorder={(from, to) => setVisible(arrayMove(order, from, to), visible)}
            className="rb-vis-list"
            rowClassName="rb-vis-row-wrap"
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
                  <button className="rb-icon-btn rb-vis-toggle" aria-label={on ? 'Hide' : 'Show'} onClick={() => toggle(name)}>
                    <Icon name={on ? 'eye' : 'eye-off'} />
                  </button>
                </div>
              );
            }}
          />
        </>
      )}
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
    <>
      <div className="rb-wizard-hint">
        Pin the order of columns and give them a label, color, or hide them. Values not listed here follow, sorted;
        Uncategorized is always last.
      </div>
      {!view.group && <div className="rb-wizard-hint">Choose a "Group by" property in General first.</div>}

      <SortableList
        ids={cols}
        onReorder={(from, to) => edit((d) => void (d.columns = arrayMove(cols, from, to)))}
        className="rb-col-config-list"
        rowClassName="rb-col-config-row"
        renderRow={(key, i, handle) => {
          const cfg = view.groupConfig?.[key];
          return (
            <>
              <DragHandle handle={handle} />
              <div className="rb-col-config-fields">
                <span className="rb-col-key-label">{key}</span>
                <TextInput className="rb-col-field-input" value={cfg?.label ?? ''} placeholder="Custom label…" onChange={(v) => patch(key, { label: v.trim() || undefined })} />
                <div className="rb-col-options">
                  <label className="rb-col-color-wrap">
                    <span className="rb-col-color-label">Color</span>
                    <input className="rb-col-color-input" type="color" defaultValue={cfg?.color ?? '#888888'} onChange={(e) => setColor(key, e.target.value)} />
                    {cfg?.color && (
                      <button className="rb-icon-btn rb-col-clear-color" aria-label="Clear color" onClick={() => patch(key, { color: undefined })}>
                        <Icon name="x" />
                      </button>
                    )}
                  </label>
                  <label className="rb-col-hidden-wrap">
                    <span className="rb-col-hidden-label">Hidden</span>
                    <Toggle checked={!!cfg?.hidden} onChange={(on) => patch(key, { hidden: on || undefined })} label="Hide column" />
                  </label>
                </div>
              </div>
              <button className="rb-icon-btn rb-col-remove-btn" aria-label="Unpin column" onClick={() => edit((d) => void (d.columns = cols.filter((_, j) => j !== i)))}>
                <Icon name="trash-2" />
              </button>
            </>
          );
        }}
      />

      <div className="rb-col-add-row">
        <input
          className="rb-col-add-input"
          type="text"
          placeholder="Column value…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button className="rb-col-add-btn" onClick={add}>
          <Icon name="plus" /> Add
        </button>
      </div>
    </>
  );
}
