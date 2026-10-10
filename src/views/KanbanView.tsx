import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Notice } from 'obsidian';
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
import type { BoardItem, DatabaseConfig, PropertyConfig, ViewConfig } from '../types';
import { groupItems, groupValueOf, type ItemGroup } from '../data/group';
import { setProperty } from '../data/properties';
import { Card } from '../components/Card';
import { GroupLabel, ViewMore, usePaged } from '../components/layout';
import { useDragSensors } from '../components/dnd';
import { useBoard, useBoardContext } from '../board/context';
import { Icon } from '../react/Icon';

/** Column id for the Uncategorized bucket (its group key is null). */
const NONE = '\u0000uncategorized';
const colId = (key: string | null): string => `col:${key ?? NONE}`;

/** Drag payloads, read back in the drop handler. */
type DragData = { type: 'card'; item: BoardItem } | { type: 'column'; key: string | null };

interface KanbanProps {
  config: DatabaseConfig;
  view: ViewConfig;
  viewIndex: number;
  items: BoardItem[];
  properties: PropertyConfig[];
}

/**
 * Kanban board: one column per distinct value of the view's group property,
 * plus Uncategorized for notes missing it. Cards drag between columns
 * (rewriting the group property); columns reorder by dragging their header; a
 * trailing "Add group" column creates a new empty column.
 */
export function KanbanView({ config, view, viewIndex, items, properties }: KanbanProps) {
  const { app } = useBoardContext();
  const updateView = useBoard((s) => s.updateView);
  const sensors = useDragSensors();
  const groupProp = view.group ? config.properties.find((p) => p.name === view.group) : undefined;

  // Moves applied optimistically until the metadata cache catches up, so a
  // dropped card doesn't flash back to its old column while the note is written.
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const shown = useMemo(() => {
    if (!groupProp || Object.keys(pending).length === 0) return items;
    return items.map((item) =>
      item.file.path in pending
        ? { ...item, frontmatter: { ...item.frontmatter, [groupProp.name]: pending[item.file.path] ?? undefined } }
        : item,
    );
  }, [items, pending, groupProp]);

  // Drop each pending move once the real data agrees with it.
  useEffect(() => {
    if (!groupProp) return;
    const settled = items.filter(
      (item) => item.file.path in pending && (groupValueOf(item, groupProp) ?? null) === pending[item.file.path],
    );
    if (settled.length === 0) return;
    setPending((p) => {
      const next = { ...p };
      for (const item of settled) delete next[item.file.path];
      return next;
    });
  }, [items, pending, groupProp]);

  const columns = useMemo(
    () => (groupProp ? groupItems(shown, groupProp, view.columns, view.groupConfig) : []),
    [shown, groupProp, view.columns, view.groupConfig],
  );
  const realKeys = useMemo(() => columns.filter((c) => c.key !== null).map((c) => c.key as string), [columns]);

  const [active, setActive] = useState<DragData | null>(null);

  const moveCard = (item: BoardItem, target: string | null): void => {
    if (!groupProp || (groupValueOf(item, groupProp) ?? null) === target) return;
    const path = item.file.path;
    setPending((p) => ({ ...p, [path]: target }));
    setProperty(app, item.file, groupProp, target).catch((e) => {
      setPending((p) => {
        const next = { ...p };
        delete next[path];
        return next;
      });
      new Notice(`R Board: could not move note — ${(e as Error).message}`);
    });
  };

  // Stable callbacks for the memoized cards, reading the latest state at call time.
  const latest = useRef({ moveCard, columns });
  latest.current = { moveCard, columns };
  const onMove = useCallback((item: BoardItem, target: string | null) => latest.current.moveCard(item, target), []);
  const getTargets = useCallback(() => latest.current.columns, []);

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
    const target = over?.data.current as { key: string | null } | undefined;
    if (!data || !target) return;
    if (data.type === 'card') {
      const original = items.find((i) => i.file.path === data.item.file.path) ?? data.item;
      moveCard(original, target.key);
    } else if (data.key !== null && target.key !== null && data.key !== target.key) {
      const order = arrayMove(realKeys, realKeys.indexOf(data.key), realKeys.indexOf(target.key));
      updateView(viewIndex, (v) => {
        v.columns = order;
      });
    }
  };

  // Cards land in whichever column the pointer is over; columns sort by center.
  const collision: CollisionDetection = (args) => {
    const kind = (args.active.data.current as DragData | undefined)?.type;
    const columnsOnly = args.droppableContainers.filter((c) => String(c.id).startsWith('col:'));
    if (kind === 'column') return closestCenter({ ...args, droppableContainers: columnsOnly });
    const hits = pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('drop:')) });
    return hits.length > 0 ? hits : pointerWithin({ ...args, droppableContainers: columnsOnly });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <TopScrollbar size={view.cardSize ?? 'medium'}>
        <SortableContext items={columns.map((c) => colId(c.key))} strategy={horizontalListSortingStrategy}>
          {columns.map((column) => (
            <Column
              key={colId(column.key)}
              column={column}
              view={view}
              properties={properties}
              getTargets={getTargets}
              groupProp={groupProp}
              onMove={onMove}
            />
          ))}
        </SortableContext>
        <AddGroup realKeys={realKeys} view={view} viewIndex={viewIndex} />
      </TopScrollbar>
      <DragPreview active={active} view={view} properties={properties} />
    </DndContext>
  );
}

/**
 * The scrolling board with a thin horizontal scrollbar pinned above it, kept
 * in sync with the board's own (hidden) scrollbar.
 */
function TopScrollbar({ size, children }: { size: string; children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const top = topRef.current;
    const inner = innerRef.current;
    const board = boardRef.current;
    if (!top || !inner || !board) return;
    const sync = (): void => {
      inner.style.width = `${board.scrollWidth}px`;
      top.toggleClass('rb-hidden', board.scrollWidth <= board.clientWidth + 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(board);
    for (const child of Array.from(board.children)) ro.observe(child);
    let lock = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => () => {
      if (lock) return;
      lock = true;
      to.scrollLeft = from.scrollLeft;
      lock = false;
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
      <div ref={topRef} className="rb-kanban-scrolltop">
        <div ref={innerRef} className="rb-kanban-scrolltop-inner" />
      </div>
      <div ref={boardRef} className={`rb-kanban rb-size-${size}`}>
        {children}
      </div>
    </div>
  );
}

interface ColumnProps {
  column: ItemGroup;
  view: ViewConfig;
  properties: PropertyConfig[];
  getTargets: () => ItemGroup[];
  groupProp: PropertyConfig;
  onMove: (item: BoardItem, target: string | null) => void;
}

function Column({ column, view, properties, getTargets, groupProp, onMove }: ColumnProps) {
  const collapsed = useBoard((s) => !!s.collapsed[column.label]);
  const toggle = useBoard((s) => s.toggleCollapsed);
  const { visible, more, remaining } = usePaged(`k:${column.label}`, column.items, view.limit ?? 50);

  // The column itself is sortable (by its header); Uncategorized stays put.
  const sortable = useSortable({
    id: colId(column.key),
    data: { type: 'column', key: column.key },
    disabled: column.key === null,
  });
  // Its card list is the drop target for cards.
  const drop = useDroppable({ id: `drop:${column.key ?? NONE}`, data: { key: column.key } });
  const draggingCard = drop.active?.data.current?.type === 'card';

  const color = column.key !== null ? view.groupConfig?.[column.key]?.color : undefined;
  const cls = ['rb-kanban-col'];
  if (collapsed) cls.push('rb-collapsed');
  if (sortable.isDragging) cls.push('rb-col-dragging');

  return (
    <div
      ref={sortable.setNodeRef}
      className={cls.join(' ')}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
    >
      <div
        className={column.key !== null ? 'rb-kanban-header rb-draggable' : 'rb-kanban-header'}
        onClick={() => toggle(column.label)}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} className="rb-kanban-caret" />
        <GroupLabel label={column.label} color={color} className="rb-kanban-title" />
        <span className="rb-kanban-count">{column.items.length}</span>
      </div>
      <div ref={drop.setNodeRef} className={`rb-kanban-list${draggingCard && drop.isOver ? ' rb-drop-active' : ''}`}>
        {!collapsed && (
          <>
            {column.items.length === 0 && <div className="rb-kanban-empty-drop">Drop cards here</div>}
            {visible.map((item) => (
              <KanbanCard key={item.file.path} item={item} view={view} properties={properties} getTargets={getTargets} groupProp={groupProp} onMove={onMove} />
            ))}
            <ViewMore more={more} remaining={remaining} />
          </>
        )}
      </div>
    </div>
  );
}

interface KanbanCardProps {
  item: BoardItem;
  view: ViewConfig;
  properties: PropertyConfig[];
  getTargets: () => ItemGroup[];
  groupProp: PropertyConfig;
  onMove: (item: BoardItem, target: string | null) => void;
}

const KanbanCard = memo(function KanbanCard({ item, view, properties, getTargets, groupProp, onMove }: KanbanCardProps) {
  const { actions } = useBoardContext();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.file.path,
    data: { type: 'card', item },
  });

  const openMenu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const current = groupValueOf(item, groupProp);
    const menu = new Menu();
    menu.addItem((it) => {
      it.setTitle('Move to group').setIcon('arrow-right-circle');
      // setSubmenu() exists at runtime (Obsidian 1.4+) but isn't in the bundled types.
      const sub = (it as unknown as { setSubmenu: () => Menu }).setSubmenu();
      for (const t of getTargets()) {
        sub.addItem((si) => {
          si.setTitle(t.label);
          if ((t.key ?? null) === (current ?? null)) si.setChecked(true);
          si.onClick(() => onMove(item, t.key));
        });
      }
    });
    menu.addSeparator();
    menu.addItem((it) => it.setTitle('Open note').setIcon('file-text').onClick(() => actions.openNote(item, true)));
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'rb-kanban-card-slot rb-dragging' : 'rb-kanban-card-slot'}
      onContextMenu={openMenu}
      {...attributes}
      {...listeners}
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

/** The card / column following the pointer while dragging (portaled out of the scroll area). */
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
function AddGroup({ realKeys, view, viewIndex }: { realKeys: string[]; view: ViewConfig; viewIndex: number }) {
  const updateView = useBoard((s) => s.updateView);
  const [adding, setAdding] = useState(false);
  const done = useRef(false);

  const finish = (save: boolean, value: string): void => {
    if (done.current) return;
    done.current = true;
    setAdding(false);
    const name = value.trim();
    if (!save || !name || realKeys.includes(name)) return;
    const cols = view.columns ? [...view.columns] : [...realKeys];
    if (!cols.includes(name)) cols.push(name);
    updateView(viewIndex, (v) => {
      v.columns = cols;
    });
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
