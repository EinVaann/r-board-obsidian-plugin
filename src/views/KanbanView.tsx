import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Platform } from 'obsidian';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardItem, DatabaseConfig, DateBucket, PropertyConfig, ViewConfig } from '../types';
import { RELATIVE_KEYS, cellForGroup, cellsForGroup, collapseKey, groupItems, groupValueOf, type ItemGroup } from '../data/group';
import { Card } from '../components/Card';
import { GroupLabel, NEUTRAL_GROUP_COLOR, ViewMore, usePaged } from '../components/layout';
import { useDragSensors } from '../components/dnd';
import { useBoard, useBoardContext } from '../board/context';
import { Icon } from '../react/Icon';

/** Id part for the Uncategorized bucket (its group key is null). */
const NONE = '\u0000uncategorized';
const colId = (key: string | null): string => `col:${key ?? NONE}`;
const cellId = (col: string | null, lane: string | null | undefined): string => `drop:${col ?? NONE}|${lane === undefined ? '' : lane ?? NONE}`;
const laneKey = (key: string | null): string => `lane:${collapseKey(key)}`;

/**
 * Drag and drop is desktop-only. On touch it competes with scrolling the board
 * sideways; phones and tablets move cards with the card menu instead.
 */
const canDrag = (): boolean => !Platform.isMobile;
const NO_SENSORS: never[] = [];

/** Drag payloads, read back in the drop handler. */
type DragData = { type: 'card'; item: BoardItem } | { type: 'column'; key: string | null };
/** A drop target: a column (and, with swimlanes, a lane). `lane` undefined = no lanes. */
type Target = { key: string | null; lane?: string | null };

interface KanbanProps {
  config: DatabaseConfig;
  view: ViewConfig;
  viewIndex: number;
  items: BoardItem[];
  properties: PropertyConfig[];
}

/** Group options for a kanban axis: relative dates always show all nine buckets. */
function axisOptions(view: ViewConfig, bucket: DateBucket | undefined, pinned?: string[]) {
  return { order: pinned ?? (bucket === 'relative' ? RELATIVE_KEYS : undefined), groupConfig: pinned ? view.groupConfig : undefined, bucket };
}

/**
 * Kanban board: one column per value of the view's group property (plus
 * Uncategorized), optionally split into rows (swimlanes) by a sub-group
 * property; every row has every column. Cards drag between cells, rewriting
 * the group (and sub-group) values; columns reorder by dragging their header;
 * each cell has a "New" button that pre-fills both values.
 */
export function KanbanView({ config, view, viewIndex, items, properties }: KanbanProps) {
  const { actions } = useBoardContext();
  const updateView = useBoard((s) => s.updateView);
  const toggleCollapsed = useBoard((s) => s.toggleCollapsed);
  const sensors = useDragSensors();
  const groupProp = view.group ? config.properties.find((p) => p.name === view.group) : undefined;
  const subProp = view.subGroup && view.subGroup !== view.group ? config.properties.find((p) => p.name === view.subGroup) : undefined;
  const bucket = view.groupBucket ?? 'none';
  const subBucket = view.subGroupBucket ?? 'none';

  // Moves applied optimistically until the data catches up, so a dropped card
  // doesn't flash back to its old cell while the note (or row) is written.
  const [pending, setPending] = useState<Record<string, { values: Record<string, unknown>; target: Target }>>({});
  const shown = useMemo(() => {
    if (Object.keys(pending).length === 0) return items;
    return items.map((item) => (item.id in pending ? { ...item, values: { ...item.values, ...pending[item.id].values } } : item));
  }, [items, pending]);

  // Drop each pending move once the real data agrees with it.
  useEffect(() => {
    if (!groupProp) return;
    const settled = items.filter((item) => {
      const p = pending[item.id];
      if (!p) return false;
      const inCol = groupValueOf(item, groupProp, bucket) === p.target.key;
      const inLane = !subProp || p.target.lane === undefined || groupValueOf(item, subProp, subBucket) === p.target.lane;
      return inCol && inLane;
    });
    if (settled.length === 0) return;
    setPending((p) => {
      const next = { ...p };
      for (const item of settled) delete next[item.id];
      return next;
    });
  }, [items, pending, groupProp, subProp, bucket, subBucket]);

  const columns = useMemo(
    () => (groupProp ? groupItems(shown, groupProp, axisOptions(view, bucket, view.columns)) : []),
    [shown, groupProp, view.columns, view.groupConfig, bucket], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const lanes = useMemo(
    () => (subProp ? groupItems(shown, subProp, axisOptions(view, subBucket)) : null),
    [shown, subProp, subBucket], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const realKeys = useMemo(() => columns.filter((c) => c.key !== null).map((c) => c.key as string), [columns]);
  // Formula columns are computed: cards can't be moved into them.
  const movable = !!groupProp && groupProp.type !== 'formula' && (!subProp || subProp.type !== 'formula');

  const [active, setActive] = useState<DragData | null>(null);

  const moveCard = (item: BoardItem, target: Target): void => {
    if (!groupProp || !movable) return;
    const values: Record<string, unknown> = {};
    const writes: [PropertyConfig, unknown][] = [];
    if (groupValueOf(item, groupProp, bucket) !== target.key) writes.push([groupProp, cellForGroup(groupProp, bucket, target.key)]);
    if (subProp && target.lane !== undefined && groupValueOf(item, subProp, subBucket) !== target.lane) {
      writes.push([subProp, cellForGroup(subProp, subBucket, target.lane)]);
    }
    if (writes.length === 0) return;
    for (const [p, v] of writes) values[p.name] = v ?? undefined;
    const id = item.id;
    setPending((p) => ({ ...p, [id]: { values, target } }));
    void (async () => {
      try {
        for (const [p, v] of writes) await actions.setValue(item, p, (v ?? null) as never);
      } catch {
        setPending((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      }
    })();
  };

  /** New item in a cell: the column's (and lane's) values, copied formula inputs included. */
  const addInto = (column: ItemGroup, lane?: ItemGroup): void => {
    if (!groupProp) return;
    const inCell = lane ? column.items.filter((i) => lane.items.includes(i)) : column.items;
    const template = inCell[inCell.length - 1];
    const values = {
      ...cellsForGroup(groupProp, config.properties, bucket, column, template),
      ...(lane && subProp ? cellsForGroup(subProp, config.properties, subBucket, lane, template) : {}),
    };
    actions.createNewNote(values);
  };

  // Stable callbacks for the memoized cards, reading the latest state at call time.
  const latest = useRef({ moveCard, columns, lanes });
  latest.current = { moveCard, columns, lanes };
  const onMove = useCallback((item: BoardItem, target: Target) => latest.current.moveCard(item, target), []);
  const getTargets = useCallback(() => ({ columns: latest.current.columns, lanes: latest.current.lanes }), []);

  if (!groupProp) {
    return (
      <div className="rb-empty">
        This kanban view needs a "group" property to use as columns. Open view settings to set one.
      </div>
    );
  }

  const onDragStart = ({ active: a }: DragStartEvent): void => setActive(a.data.current as DragData);

  const onDragEnd = ({ active: a, over }: DragEndEvent): void => {
    setActive(null);
    const data = a.data.current as DragData | undefined;
    const target = over?.data.current as Target | undefined;
    if (!data || !target) return;
    if (data.type === 'card') {
      const original = items.find((i) => i.id === data.item.id) ?? data.item;
      moveCard(original, target);
    } else if (data.key !== null && target.key !== null && data.key !== target.key) {
      const order = arrayMove(realKeys, realKeys.indexOf(data.key), realKeys.indexOf(target.key));
      updateView(viewIndex, (v) => void (v.columns = order));
    }
  };

  // Cards land in whichever cell the pointer is over; columns sort by center.
  const collision: CollisionDetection = (args) => {
    const kind = (args.active.data.current as DragData | undefined)?.type;
    const columnsOnly = args.droppableContainers.filter((c) => String(c.id).startsWith('col:'));
    if (kind === 'column') return closestCenter({ ...args, droppableContainers: columnsOnly });
    return pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('drop:')) });
  };

  const collapsed = new Set(view.collapsed);
  const shared = { view, properties, getTargets, groupProp, subProp, onMove, movable };
  const header = (column: ItemGroup, handle: Record<string, unknown>) => (
    <ColumnHeader
      column={column}
      collapsed={collapsed.has(collapseKey(column.key))}
      onToggle={() => toggleCollapsed(viewIndex, collapseKey(column.key))}
      handle={handle}
    />
  );

  return (
    <DndContext sensors={canDrag() ? sensors : NO_SENSORS} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <TopScrollbar size={view.cardSize ?? 'medium'} lanes={!!lanes}>
        {lanes ? (
          <>
            <div className="rb-lane-row rb-lane-head">
              <SortableContext items={columns.map((c) => colId(c.key))} strategy={horizontalListSortingStrategy}>
                {columns.map((column) => (
                  <SortableHeader key={colId(column.key)} column={column} collapsed={collapsed.has(collapseKey(column.key))}>
                    {(handle) => header(column, handle)}
                  </SortableHeader>
                ))}
              </SortableContext>
              <AddGroup realKeys={realKeys} view={view} viewIndex={viewIndex} groupProp={groupProp} />
            </div>
            {lanes.map((lane) => {
              const laneCollapsed = collapsed.has(laneKey(lane.key));
              return (
                <div key={laneKey(lane.key)} className={laneCollapsed ? 'rb-lane rb-collapsed' : 'rb-lane'}>
                  <div className="rb-lane-header" onClick={() => toggleCollapsed(viewIndex, laneKey(lane.key))}>
                    <Icon name={laneCollapsed ? 'chevron-right' : 'chevron-down'} className="rb-kanban-caret" />
                    <GroupLabel label={lane.label} color={lane.color} className="rb-kanban-title" />
                    <span className="rb-kanban-count">{lane.items.length}</span>
                  </div>
                  {!laneCollapsed && (
                    <div className="rb-lane-row">
                      {columns.map((column) => (
                        <Cell
                          key={colId(column.key)}
                          {...shared}
                          column={column}
                          lane={lane}
                          items={column.items.filter((i) => lane.items.includes(i))}
                          collapsed={collapsed.has(collapseKey(column.key))}
                          onAdd={() => addInto(column, lane)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <SortableContext items={columns.map((c) => colId(c.key))} strategy={horizontalListSortingStrategy}>
              {columns.map((column) => (
                <SortableHeader key={colId(column.key)} column={column} whole collapsed={collapsed.has(collapseKey(column.key))}>
                  {(handle) => (
                    <>
                      {header(column, handle)}
                      <Cell
                        {...shared}
                        column={column}
                        items={column.items}
                        collapsed={collapsed.has(collapseKey(column.key))}
                        onAdd={() => addInto(column)}
                      />
                    </>
                  )}
                </SortableHeader>
              ))}
            </SortableContext>
            <AddGroup realKeys={realKeys} view={view} viewIndex={viewIndex} groupProp={groupProp} />
          </>
        )}
      </TopScrollbar>
      <DragPreview active={active} view={view} properties={properties} />
    </DndContext>
  );
}

/**
 * The scrolling board with a thin horizontal scrollbar pinned above it, kept
 * in sync with the board's own (hidden) scrollbar. On mobile there's no top
 * bar: the board just scrolls under the finger.
 */
function TopScrollbar({ size, lanes, children }: { size: string; lanes: boolean; children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const mirrored = !Platform.isMobile;

  useLayoutEffect(() => {
    const top = topRef.current;
    const inner = innerRef.current;
    const board = boardRef.current;
    if (!mirrored || !top || !inner || !board) return;
    const sync = (): void => {
      inner.style.width = `${board.scrollWidth}px`;
      top.toggleClass('rb-hidden', board.scrollWidth <= board.clientWidth + 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(board);
    for (const child of Array.from(board.children)) ro.observe(child);
    // Setting one side's scrollLeft fires a scroll event on it a moment later.
    // Remember the value we set and ignore that echo; acting on it would pull
    // the other side back to a stale position mid-scroll (visible as jitter).
    const echo = new Map<HTMLElement, number>();
    const mirror = (from: HTMLElement, to: HTMLElement) => () => {
      const expected = echo.get(from);
      if (expected !== undefined) {
        echo.delete(from);
        if (Math.abs(from.scrollLeft - expected) < 1) return;
      }
      if (Math.abs(to.scrollLeft - from.scrollLeft) < 1) return;
      echo.set(to, from.scrollLeft);
      to.scrollLeft = from.scrollLeft;
    };
    const onTop = mirror(top, board);
    const onBoard = mirror(board, top);
    top.addEventListener('scroll', onTop);
    board.addEventListener('scroll', onBoard);
    return () => {
      ro.disconnect();
      top.removeEventListener('scroll', onTop);
      board.removeEventListener('scroll', onBoard);
    };
  });

  return (
    <div className="rb-kanban-wrap">
      {mirrored && (
        <div ref={topRef} className="rb-kanban-scrolltop">
          <div ref={innerRef} className="rb-kanban-scrolltop-inner" />
        </div>
      )}
      <div ref={boardRef} className={`rb-kanban rb-size-${size}${lanes ? ' rb-kanban-lanes' : ''}`}>
        {children}
      </div>
    </div>
  );
}


/** Columns without a color are shaded in this neutral tone. */
const NEUTRAL = NEUTRAL_GROUP_COLOR;

/** A column's color, read by the kanban CSS (blended into the theme there). */
const columnColor = (color: string | undefined): CSSProperties => ({ '--gc': color ?? NEUTRAL }) as CSSProperties;

/**
 * A sortable column shell. Without swimlanes (`whole`) it is the whole column
 * (header + cards); with them, just the header in the top row.
 */
function SortableHeader({
  column,
  whole = false,
  collapsed,
  children,
}: {
  column: ItemGroup;
  whole?: boolean;
  collapsed: boolean;
  children: (handle: Record<string, unknown>) => ReactNode;
}) {
  // Uncategorized stays put.
  const draggable = canDrag() && column.key !== null;
  const sortable = useSortable({ id: colId(column.key), data: { type: 'column', key: column.key }, disabled: !draggable });
  const cls = [whole ? 'rb-kanban-col' : 'rb-kanban-col rb-kanban-col-head'];
  if (collapsed) cls.push('rb-collapsed');
  if (sortable.isDragging) cls.push('rb-col-dragging');
  // Only the header drags the column; cards inside drag themselves.
  const handle = draggable ? { ...sortable.attributes, ...sortable.listeners } : {};
  return (
    <div
      ref={sortable.setNodeRef}
      className={cls.join(' ')}
      style={{ ...columnColor(column.color), transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
    >
      {children(handle)}
    </div>
  );
}

function ColumnHeader({ column, collapsed, onToggle, handle }: { column: ItemGroup; collapsed: boolean; onToggle: () => void; handle: Record<string, unknown> }) {
  return (
    <div className={canDrag() && column.key !== null ? 'rb-kanban-header rb-draggable' : 'rb-kanban-header'} onClick={onToggle} {...handle}>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} className="rb-kanban-caret" />
      <GroupLabel label={column.label} color={column.color ?? NEUTRAL} className="rb-kanban-title" />
      <span className="rb-kanban-count">{column.items.length}</span>
    </div>
  );
}

interface CellProps {
  column: ItemGroup;
  lane?: ItemGroup;
  items: BoardItem[];
  collapsed: boolean;
  view: ViewConfig;
  properties: PropertyConfig[];
  getTargets: () => { columns: ItemGroup[]; lanes: ItemGroup[] | null };
  groupProp: PropertyConfig;
  subProp?: PropertyConfig;
  movable: boolean;
  onMove: (item: BoardItem, target: Target) => void;
  onAdd: () => void;
}

/** The cards of one column (in one lane): a drop target with paging and a "New" button. */
function Cell({ column, lane, items, collapsed, view, properties, getTargets, groupProp, subProp, movable, onMove, onAdd }: CellProps) {
  const pageKey = `k:${collapseKey(column.key)}|${lane ? collapseKey(lane.key) : ''}`;
  const { visible, more, remaining } = usePaged(pageKey, items, view.limit ?? 50);
  const target: Target = lane ? { key: column.key, lane: lane.key } : { key: column.key };
  const drop = useDroppable({ id: cellId(column.key, lane ? lane.key : undefined), data: target, disabled: !movable });
  const draggingCard = drop.active?.data.current?.type === 'card';
  const inLane = !!lane;

  if (collapsed) return inLane ? <div className="rb-kanban-cell rb-collapsed" /> : null;
  return (
    <div
      ref={drop.setNodeRef}
      className={`${inLane ? 'rb-kanban-cell ' : ''}rb-kanban-list${draggingCard && drop.isOver ? ' rb-drop-active' : ''}`}
      style={inLane ? columnColor(column.color) : undefined}
    >
      {items.length === 0 && !inLane && <div className="rb-kanban-empty-drop">{canDrag() && movable ? 'Drop cards here' : 'No cards'}</div>}
      {visible.map((item) => (
        <KanbanCard key={item.id} item={item} view={view} properties={properties} getTargets={getTargets} groupProp={groupProp} subProp={subProp} movable={movable} onMove={onMove} />
      ))}
      <ViewMore more={more} remaining={remaining} />
      <button className="rb-kanban-new" onClick={onAdd}>
        <Icon name="plus" />
        <span>New</span>
      </button>
    </div>
  );
}

interface KanbanCardProps {
  item: BoardItem;
  view: ViewConfig;
  properties: PropertyConfig[];
  getTargets: () => { columns: ItemGroup[]; lanes: ItemGroup[] | null };
  groupProp: PropertyConfig;
  subProp?: PropertyConfig;
  movable: boolean;
  onMove: (item: BoardItem, target: Target) => void;
}

const KanbanCard = memo(function KanbanCard({ item, view, properties, getTargets, groupProp, subProp, movable, onMove }: KanbanCardProps) {
  const { actions } = useBoardContext();
  const drag = canDrag() && movable;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { type: 'card', item }, disabled: !drag });

  const openMenu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const { columns, lanes } = getTargets();
    const col = groupValueOf(item, groupProp, view.groupBucket);
    const lane = subProp ? groupValueOf(item, subProp, view.subGroupBucket) : undefined;
    const menu = new Menu();
    const submenu = (title: string, icon: string, targets: ItemGroup[], current: string | null | undefined, to: (key: string | null) => Target): void => {
      menu.addItem((it) => {
        it.setTitle(title).setIcon(icon);
        // setSubmenu() exists at runtime (Obsidian 1.4+) but isn't in the bundled types.
        const sub = (it as unknown as { setSubmenu: () => Menu }).setSubmenu();
        for (const t of targets) {
          sub.addItem((si) => {
            si.setTitle(t.label);
            if (t.key === current) si.setChecked(true);
            si.onClick(() => onMove(item, to(t.key)));
          });
        }
      });
    };
    if (movable) {
      submenu('Move to group', 'arrow-right-circle', columns, col, (key) => (lanes ? { key, lane } : { key }));
      if (lanes) submenu('Move to row', 'arrow-down-circle', lanes, lane, (l) => ({ key: col, lane: l }));
    }
    menu.addItem((it) => it.setTitle(item.file ? 'Edit note' : 'Expand row').setIcon('pencil').onClick(() => actions.editItem(item)));
    if (item.file) menu.addItem((it) => it.setTitle('Open note').setIcon('file-text').onClick(() => actions.openNote(item, true)));
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'rb-kanban-card-slot rb-dragging' : 'rb-kanban-card-slot'}
      onContextMenu={openMenu}
      {...(drag ? attributes : {})}
      {...(drag ? listeners : {})}
    >
      <Card
        item={item}
        properties={properties}
        showContent={view.showContent}
        className="rb-kanban-card"
        overlay={
          <button className="rb-card-menu" aria-label="Card actions" onClick={openMenu} onPointerDown={(e) => e.stopPropagation()}>
            <Icon name="more-horizontal" />
          </button>
        }
      />
    </div>
  );
});

/** The card following the pointer while dragging (portaled out of the scroll area). */
function DragPreview({ active, view, properties }: { active: DragData | null; view: ViewConfig; properties: PropertyConfig[] }) {
  const { scrollRef } = useBoardContext();
  const doc = scrollRef.current?.ownerDocument ?? document;
  return createPortal(
    <DragOverlay dropAnimation={null}>
      {active?.type === 'card' ? (
        <div className={`rb-drag-ghost rb-size-${view.cardSize ?? 'medium'}`}>
          <Card item={active.item} properties={properties} showContent={view.showContent} className="rb-kanban-card" />
        </div>
      ) : null}
    </DragOverlay>,
    doc.body,
  );
}

/** Trailing column with a button (then inline input) to add a new group. */
function AddGroup({ realKeys, view, viewIndex, groupProp }: { realKeys: string[]; view: ViewConfig; viewIndex: number; groupProp: PropertyConfig }) {
  const updateView = useBoard((s) => s.updateView);
  const updateConfig = useBoard((s) => s.updateConfig);
  const [adding, setAdding] = useState(false);
  const done = useRef(false);
  // Computed or bucketed columns can't be added by name.
  if (groupProp.type === 'formula' || groupProp.type === 'checkbox' || (groupProp.type === 'date' && view.groupBucket)) return null;

  const finish = (save: boolean, value: string): void => {
    if (done.current) return;
    done.current = true;
    setAdding(false);
    const name = value.trim();
    if (!save || !name || realKeys.includes(name)) return;
    // Select properties own their values: a new column is a new option.
    if (groupProp.type === 'select' && !view.columns) {
      updateConfig((c) => {
        const p = c.properties.find((q) => q.name === groupProp.name);
        if (p && !p.options?.some((o) => o.value === name)) p.options = [...(p.options ?? []), { value: name }];
      });
      return;
    }
    const cols = view.columns ? [...view.columns] : [...realKeys];
    if (!cols.includes(name)) cols.push(name);
    updateView(viewIndex, (v) => void (v.columns = cols));
  };

  return (
    <div className="rb-kanban-col rb-kanban-add">
      {adding ? (
        <input
          className="rb-kanban-add-input"
          type="text"
          placeholder="Group name…"
          autoFocus
          onBlur={(e) => finish(true, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true, e.currentTarget.value);
            else if (e.key === 'Escape') finish(false, '');
          }}
        />
      ) : (
        <div
          className="rb-kanban-add-btn"
          onClick={() => {
            done.current = false;
            setAdding(true);
          }}
        >
          <Icon name="plus" className="rb-kanban-add-icon" />
          <span>Add group</span>
        </div>
      )}
    </div>
  );
}
