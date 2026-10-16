import { createRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Menu, Notice, Platform } from 'obsidian';
import type { DatabaseConfig, ViewConfig, ViewType } from '../types';
import { effectiveSort, makeDefaultView, NO_SORT_KEY, propertyLabel, titleLabel, titlePropertyOf, TITLE_SORT_KEY } from '../config';
import { countFilterRules } from '../data/filter';
import { Icon } from '../react/Icon';
import { BoardContext, useBoard, useBoardContext } from './context';
import { selectCurrentView } from './store';
import { useViewItems } from './useItems';
import { useElementWidth } from '../components/layout';
import { GalleryView } from '../views/GalleryView';
import { KanbanView } from '../views/KanbanView';
import { TableView } from '../views/TableView';
import { RecipeView } from '../views/RecipeView';
import { ChartView } from '../chart/ChartView';

/** At most this many view tabs; the rest go in the "more" dropdown. */
const MAX_VIEW_TABS = 3;
/**
 * Below this toolbar width (and always on phones) the toolbar goes compact:
 * one view dropdown instead of tabs, icon-only buttons and chips.
 */
const COMPACT_WIDTH = 560;

export const TYPE_ICON: Record<ViewType, string> = {
  gallery: 'layout-grid',
  kanban: 'columns-3',
  table: 'table',
  recipe: 'utensils',
  chart: 'bar-chart-3',
};

/** The whole board pane: setup prompt, or toolbar + the active view. */
export function BoardApp() {
  const config = useBoard((s) => s.config);
  const parseError = useBoard((s) => s.parseError);
  const view = useBoard(selectCurrentView);
  if (!config) return <Setup error={parseError} />;

  return (
    <>
      <Toolbar config={config} view={view} />
      <div className="rb-main">
        {view ? (
          <ViewArea key={config.views.indexOf(view)} config={config} view={view} />
        ) : (
          <ScrollBody>
            <NoViews />
          </ScrollBody>
        )}
      </div>
    </>
  );
}

/** The active view, plus its companion view (split view) when it has one. */
function ViewArea({ config, view }: { config: DatabaseConfig; view: ViewConfig }) {
  const companion = view.companion && view.companion.view !== view.name ? config.views.find((v) => v.name === view.companion!.view) : undefined;
  if (!companion) {
    return (
      <ScrollBody>
        <Body config={config} view={view} />
      </ScrollBody>
    );
  }
  return <SplitView config={config} view={view} companion={companion} />;
}

const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

/**
 * Two views side by side (or stacked; always stacked on phones), each with
 * its own scroll. The divider resizes them; the size is saved on release.
 */
function SplitView({ config, view, companion }: { config: DatabaseConfig; view: ViewConfig; companion: ViewConfig }) {
  const ctx = useBoardContext();
  const updateView = useBoard((s) => s.updateView);
  const setActiveView = useBoard((s) => s.setActiveView);
  const settings = view.companion!;
  const below = settings.position === 'below' || Platform.isPhone;
  const [size, setSize] = useState(settings.size);
  useEffect(() => setSize(settings.size), [settings.size]);
  const boxRef = useRef<HTMLDivElement>(null);
  // The companion pane virtualizes against its own scroll element.
  // (Prototype-derived, so the context's lazy `boardFile` getter keeps working.)
  const companionCtx = useMemo(() => Object.assign(Object.create(ctx) as typeof ctx, { scrollRef: createRef<HTMLDivElement>() }), [ctx]);

  const onDividerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const box = boxRef.current;
    const target = e.currentTarget as HTMLElement;
    if (!box) return;
    target.setPointerCapture?.(e.pointerId);
    const rect = box.getBoundingClientRect();
    let next = size;
    const onMove = (ev: PointerEvent): void => {
      const share = below ? (rect.bottom - ev.clientY) / rect.height : (rect.right - ev.clientX) / rect.width;
      next = Math.round(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, share * 100)));
      setSize(next);
    };
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (next !== settings.size) updateView(config.views.indexOf(view), (v) => void (v.companion && (v.companion.size = next)));
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div ref={boxRef} className={below ? 'rb-split rb-split-below' : 'rb-split rb-split-right'}>
      <div className="rb-split-pane" style={{ flexBasis: `${100 - size}%` }}>
        <ScrollBody>
          <Body config={config} view={view} />
        </ScrollBody>
      </div>
      <div className="rb-split-divider" onPointerDown={onDividerDown} role="separator" aria-label="Resize split view" />
      <div className="rb-split-pane rb-split-companion" style={{ flexBasis: `${size}%` }}>
        <button className="rb-split-title" title="Open this view" onClick={() => setActiveView(companion.name)}>
          <Icon name={TYPE_ICON[companion.type]} />
          <span>{companion.name}</span>
          {settings.followFilter && <span className="rb-split-follow">filtered by {view.name}</span>}
        </button>
        <BoardContext.Provider value={companionCtx}>
          <ScrollBody>{settings.followFilter ? <FollowingBody config={config} view={companion} lead={view} /> : <Body config={config} view={companion} />}</ScrollBody>
        </BoardContext.Provider>
      </div>
    </div>
  );
}

/** A companion that only shows the items passing the lead view's filter and search. */
function FollowingBody({ config, view, lead }: { config: DatabaseConfig; view: ViewConfig; lead: ViewConfig }) {
  const { items } = useViewItems(config, lead);
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  return <Body config={config} view={view} restrictTo={ids} />;
}

/**
 * The scrolling body. Its content renders only once the scroll element is
 * attached: children's layout effects run before a parent's ref is set, so a
 * virtualized list mounting in the same pass would find no scroll element and
 * render no rows.
 */
function ScrollBody({ children }: { children: ReactNode }) {
  const { scrollRef } = useBoardContext();
  const [attached, setAttached] = useState(false);
  useLayoutEffect(() => setAttached(true), []);
  return (
    <div className="rb-body" ref={scrollRef}>
      {/* Single content wrapper: virtualized lists watch its size. */}
      <div className="rb-body-inner">{attached && children}</div>
    </div>
  );
}

/** Setup prompt shown when the `.board` file is empty or unparseable. */
function Setup({ error }: { error: string | null }) {
  const { actions } = useBoardContext();
  return (
    <div className="rb-setup">
      <Icon name="layout-dashboard" className="rb-setup-icon" />
      <h3>Set up this board</h3>
      {error && <p className="rb-setup-error">{error}</p>}
      <button className="rb-home-create" onClick={actions.openSetup}>
        Configure board
      </button>
    </div>
  );
}

function NoViews() {
  const { createView } = useViewMenus();
  return (
    <div className="rb-empty rb-empty-views">
      <div>This board has no views yet.</div>
      <button className="rb-home-create" onClick={createView}>
        Create view
      </button>
    </div>
  );
}

/** Menus shared by the toolbar and the empty state. */
function useViewMenus() {
  const { store, actions } = useBoardContext();

  const createView = (e: ReactMouseEvent): void => {
    const menu = new Menu();
    // Recipe views read note bodies, so tables don't offer them.
    const types: ViewType[] = store.getState().config?.kind === 'table' ? ['table', 'gallery', 'kanban', 'chart'] : ['gallery', 'kanban', 'table', 'recipe', 'chart'];
    types.forEach((type) => {
      menu.addItem((item) =>
        item
          .setTitle(`New ${type} view`)
          .setIcon(TYPE_ICON[type])
          .onClick(() => {
            const { config, updateConfig, setActiveView } = store.getState();
            if (!config) return;
            const view = makeDefaultView(type, config.views);
            // Tables keep their rows' own order until a sort is chosen.
            if (config.kind === 'table') view.sort = { property: NO_SORT_KEY, dir: 'asc' };
            updateConfig((c) => void c.views.push(view));
            setActiveView(view.name);
            actions.openViewSettings(store.getState().config!.views.length - 1);
          }),
      );
    });
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return { createView };
}

/** Gaps in the tabs row; must match `.rb-view-switch` / `.rb-tabs-row` in the toolbar CSS. */
const TAB_GAP = 4;
const ROW_GAP = 8;

/**
 * How many view tabs to show (up to MAX_VIEW_TABS, fewer if they don't fit);
 * the rest go in the "more" dropdown.
 * Tabs are measured off-screen (`measureRef` holds a copy of every tab plus
 * the dropdown button). The space they may use is the row minus the + button
 * and the tools on the right; it's recomputed whenever any of those resize.
 */
function useFittingTabs(views: ViewConfig[], activeIndex: number) {
  const rowRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(views.length);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const plus = plusRef.current;
    const tools = toolsRef.current;
    const measure = measureRef.current;
    if (!row || !plus || !tools || !measure) return;

    const compute = (): void => {
      const els = Array.from(measure.children) as HTMLElement[];
      const tabs = els.slice(0, views.length).map((el) => el.offsetWidth);
      const moreBtn = els[views.length]?.offsetWidth ?? 0;
      const available = row.clientWidth - tools.offsetWidth - 2 * ROW_GAP - plus.offsetWidth;
      const used = (n: number): number => tabs.slice(0, n).reduce((sum, w) => sum + w + TAB_GAP, 0);

      if (tabs.length <= MAX_VIEW_TABS && used(tabs.length) <= available) return setFit(tabs.length);
      let n = Math.min(MAX_VIEW_TABS, tabs.length - 1);
      for (; n > 0; n--) {
        // The dropdown shows the active view's name when it's one of the hidden ones.
        const more = activeIndex >= n ? Math.max(moreBtn, tabs[activeIndex] + 24) : moreBtn;
        if (used(n) + more + TAB_GAP <= available) break;
      }
      setFit(n);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(row);
    ro.observe(tools);
    return () => ro.disconnect();
  }, [views, activeIndex]);

  return { rowRef, plusRef, toolsRef, measureRef, fit };
}

function Toolbar({ config, view }: { config: DatabaseConfig; view: ViewConfig | null }) {
  const { actions, store, boardFile } = useBoardContext();
  const setActiveView = useBoard((s) => s.setActiveView);
  const search = useBoard((s) => s.search);
  const setSearch = useBoard((s) => s.setSearch);
  const { createView } = useViewMenus();
  const viewIndex = view ? config.views.indexOf(view) : -1;
  const barRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(barRef);
  const compact = Platform.isPhone || (width > 0 && width < COMPACT_WIDTH);
  const { rowRef, plusRef, toolsRef, measureRef, fit } = useFittingTabs(config.views, viewIndex);
  // Compact (phones, narrow panes): no tabs, just the view dropdown.
  const tabs = compact ? 0 : fit;
  const filters = view ? countFilterRules(view.filter) : 0;

  const deleteView = (name: string): void => {
    const { updateConfig, activeView, setActiveView: setActive } = store.getState();
    updateConfig((c) => {
      c.views = c.views.filter((v) => v.name !== name);
      c.defaultView = c.views[0]?.name;
    });
    const left = store.getState().config?.views ?? [];
    if (activeView === name) setActive(left[0]?.name ?? '');
  };

  const openTabMenu = (e: ReactMouseEvent, index: number, name: string): void => {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle('View settings').setIcon('sliders-horizontal').onClick(() => {
        setActiveView(name);
        actions.openViewSettings(index);
      }),
    );
    menu.addItem((i) =>
      i.setTitle('Copy embed code').setIcon('code').onClick(() => {
        const code = `\`\`\`rboard\nfile: ${boardFile.path}\nview: ${name}\n\`\`\`\n`;
        void navigator.clipboard.writeText(code).then(() => new Notice('R Board: embed code copied — paste it into a note.'));
      }),
    );
    menu.addItem((i) => i.setTitle('Delete view').setIcon('trash').onClick(() => deleteView(name)));
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <div ref={barRef} className={compact ? 'rb-toolbar rb-compact' : 'rb-toolbar'}>
      {/* Row 1: view tabs + create view (left); new note + settings (right). */}
      <div className="rb-tabs-row" ref={rowRef}>
        {/* Invisible copies of every tab (and the dropdown), measured to decide how many fit. */}
        <div className="rb-tab-measure" ref={measureRef} aria-hidden="true">
          {config.views.map((v, i) => (
            <span key={i} className="rb-view-btn">
              <Icon name={TYPE_ICON[v.type]} className="rb-view-btn-icon" />
              <span>{v.name}</span>
            </span>
          ))}
          <span className="rb-view-btn">
            <span>{config.views.length} more</span>
            <Icon name="chevron-down" className="rb-view-more-caret" />
          </span>
        </div>
        <div className="rb-view-switch">
          {config.views.slice(0, tabs).map((v, i) => (
            <button
              key={i}
              className={v === view ? 'rb-view-btn rb-active' : 'rb-view-btn'}
              title={`${v.name} (${v.type})`}
              onClick={() => setActiveView(v.name)}
              onContextMenu={(e) => openTabMenu(e, i, v.name)}
            >
              <Icon name={TYPE_ICON[v.type]} className="rb-view-btn-icon" />
              <span>{v.name}</span>
            </button>
          ))}
          {config.views.length > tabs && (
            <MoreViews config={config} start={tabs} view={view} viewIndex={viewIndex} onPick={setActiveView} onContextMenu={openTabMenu} />
          )}
          <div className="rb-view-add-wrap" ref={plusRef}>
            <ToolButton icon="plus" label="Create view" onClick={createView} />
          </div>
        </div>
        <div className="rb-spacer" />
        <div className="rb-tools" ref={toolsRef}>
          <button
            className="rb-new-note"
            title={config.kind === 'table' ? 'Add a row to this table' : 'Create a new note in this database'}
            onClick={() => actions.createNewNote()}
          >
            <Icon name={config.kind === 'table' ? 'plus' : 'file-plus'} className="rb-new-note-icon" />
            <span className="rb-new-note-label">{config.kind === 'table' ? 'New row' : 'New note'}</span>
          </button>
          {view && <ToolButton icon="sliders-horizontal" label="View settings" onClick={() => actions.openViewSettings(viewIndex)} />}
          <ToolButton icon="settings" label="Board settings" onClick={actions.openBoardSettings} />
        </div>
      </div>

      {/* Row 2: search, sort / filter chips. */}
      <div className="rb-controls-row">
        <input className="rb-search" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {view && view.type !== 'chart' && <SortChip config={config} view={view} viewIndex={viewIndex} />}
        {view && (
          <Chip icon="filter" label="Filter" badge={filters || undefined} active={filters > 0} onClick={() => actions.openFilter(viewIndex)} />
        )}
      </div>
    </div>
  );
}

/**
 * The views that don't fit as tabs, in a dropdown. When the active view is one of
 * them, the button shows it (highlighted) so you can still see where you are.
 */
function MoreViews({
  config,
  start,
  view,
  viewIndex,
  onPick,
  onContextMenu,
}: {
  config: DatabaseConfig;
  /** Index of the first view in the dropdown (0 = all views, in compact mode). */
  start: number;
  view: ViewConfig | null;
  viewIndex: number;
  onPick: (name: string) => void;
  onContextMenu: (e: ReactMouseEvent, index: number, name: string) => void;
}) {
  const hidden = config.views.length - start;
  const activeHidden = view !== null && viewIndex >= start;

  const open = (e: ReactMouseEvent): void => {
    const menu = new Menu();
    config.views.slice(start).forEach((v) => {
      menu.addItem((item) => {
        item.setTitle(v.name).setIcon(TYPE_ICON[v.type]).onClick(() => onPick(v.name));
        if (v === view) item.setChecked(true);
      });
    });
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <button
      className={activeHidden ? 'rb-view-btn rb-view-more-btn rb-active' : 'rb-view-btn rb-view-more-btn'}
      title={start === 0 ? 'Switch view' : `${hidden} more view${hidden === 1 ? '' : 's'}`}
      onClick={open}
      onContextMenu={activeHidden ? (e) => onContextMenu(e, viewIndex, view.name) : undefined}
    >
      {activeHidden ? (
        <>
          <Icon name={TYPE_ICON[view.type]} className="rb-view-btn-icon" />
          <span>{view.name}</span>
        </>
      ) : (
        <span>{hidden} more</span>
      )}
      <Icon name="chevron-down" className="rb-view-more-caret" />
    </button>
  );
}

function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: (e: ReactMouseEvent) => void }) {
  return (
    <button className="rb-tool-btn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

function Chip({
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  /** A count shown after the label; stays visible when the toolbar is compact. */
  badge?: number;
  active: boolean;
  onClick: (e: ReactMouseEvent) => void;
}) {
  return (
    <button className={active ? 'rb-chip rb-chip-active' : 'rb-chip'} title={label} onClick={onClick}>
      <Icon name={icon} className="rb-chip-icon" />
      <span className="rb-chip-label">{label}</span>
      {badge !== undefined && <span className="rb-chip-badge">{badge}</span>}
    </button>
  );
}

function SortChip({ config, view, viewIndex }: { config: DatabaseConfig; view: ViewConfig; viewIndex: number }) {
  const updateView = useBoard((s) => s.updateView);
  const sort = effectiveSort(view);
  const unsorted = sort.property === NO_SORT_KEY;
  const active = !!view.sort && !unsorted;
  const labelFor = (key: string): string => {
    if (key === TITLE_SORT_KEY) return titleLabel(config);
    const p = config.properties.find((q) => q.name === key);
    return p ? propertyLabel(p) : key;
  };
  const label = unsorted ? 'No sort' : active ? `${labelFor(sort.property)} ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Sort';

  const open = (e: ReactMouseEvent): void => {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle('No sort');
      if (unsorted) item.setIcon('check');
      item.onClick(() => updateView(viewIndex, (v) => void (v.sort = { property: NO_SORT_KEY, dir: 'asc' })));
    });
    menu.addSeparator();
    for (const key of [TITLE_SORT_KEY, ...config.properties.filter((p) => p.name !== config.titleProperty).map((p) => p.name)]) {
      menu.addItem((item) => {
        item.setTitle(labelFor(key));
        if (sort.property === key) item.setIcon(sort.dir === 'asc' ? 'arrow-up' : 'arrow-down');
        item.onClick(() => {
          const dir = sort.property === key && sort.dir === 'asc' ? 'desc' : 'asc';
          updateView(viewIndex, (v) => void (v.sort = { property: key, dir }));
        });
      });
    }
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return <Chip icon="arrow-up-down" label={label} active={active} onClick={open} />;
}

/** The active view, or an empty state explaining why nothing shows. */
export function Body({
  config,
  view,
  restrictTo,
  chartHeight,
}: {
  config: DatabaseConfig;
  view: ViewConfig;
  /** Only show these item ids (a companion following another view). */
  restrictTo?: Set<string>;
  chartHeight?: number;
}) {
  const viewed = useViewItems(config, view);
  const { all, properties, sort } = viewed;
  const items = useMemo(() => (restrictTo ? viewed.items.filter((i) => restrictTo.has(i.id)) : viewed.items), [viewed.items, restrictTo]);
  const viewIndex = config.views.indexOf(view);

  // An empty kanban still shows its columns so cards can be added to them.
  if (items.length === 0 && !(all.length === 0 && view.type === 'kanban')) {
    return <EmptyState config={config} view={view} viewIndex={viewIndex} total={all.length} />;
  }

  switch (view.type) {
    case 'kanban':
      return <KanbanView config={config} view={view} viewIndex={viewIndex} items={items} properties={properties} />;
    case 'chart':
      return <ChartView chart={view.chart} properties={config.properties} items={items} detailProperties={properties} height={chartHeight} />;
    case 'table':
      return <TableView view={view} viewIndex={viewIndex} items={items} properties={properties} sort={sort} titleLabel={titleLabel(config)} titleProp={titlePropertyOf(config)} />;
    case 'recipe':
      return <RecipeView view={view} items={items} properties={properties} />;
    case 'gallery':
    default:
      return <GalleryView view={view} items={items} properties={properties} />;
  }
}

/** Explain why the view is empty and offer the matching way out. */
function EmptyState({ config, view, viewIndex, total }: { config: DatabaseConfig; view: ViewConfig; viewIndex: number; total: number }) {
  const table = config.kind === 'table';
  const { actions } = useBoardContext();
  const search = useBoard((s) => s.search);
  const setSearch = useBoard((s) => s.setSearch);
  const updateView = useBoard((s) => s.updateView);
  // Keep the last real reason while the deferred search catches up.
  const reasonRef = useRef('');

  if (total === 0) {
    return (
      <div className="rb-empty rb-empty-state">
        <div>{table ? 'This table has no rows yet.' : `No notes tagged #${config.sourceTag} yet.`}</div>
        <div className="rb-empty-actions">
          <button className="rb-home-create" onClick={() => actions.createNewNote()}>
            {table ? 'New row' : 'New note'}
          </button>
        </div>
      </div>
    );
  }

  const hasSearch = search.trim() !== '';
  const hasFilter = countFilterRules(view.filter) > 0;
  if (hasSearch || hasFilter) reasonRef.current = hasSearch && hasFilter ? 'search and filter' : hasSearch ? 'search' : 'filter';
  return (
    <div className="rb-empty rb-empty-state">
      <div>
        All {total} {table ? 'rows' : 'notes'} are hidden by the current {reasonRef.current || 'filter'}.
      </div>
      <div className="rb-empty-actions">
        {hasSearch && <button onClick={() => setSearch('')}>Clear search</button>}
        {hasFilter && <button onClick={() => updateView(viewIndex, (v) => void (v.filter = undefined))}>Clear filter</button>}
      </div>
    </div>
  );
}
