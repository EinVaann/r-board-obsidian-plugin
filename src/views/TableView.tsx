import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Menu, Notice } from 'obsidian';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { BoardItem, PropertyConfig, SortSpec, ViewConfig } from '../types';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { asArray, asBoolean, fieldValue, optionFor } from '../render/values';
import { toText, type FValue } from '../formula/evaluate';
import { cellsForGroup, type ItemGroup } from '../data/group';
import { CALCULATION_LABELS, calculate, calculationText, calculationsFor } from '../data/summary';
import type { StoredValue } from '../data/properties';
import { TitleLink, useFieldEnv } from '../components/Card';
import { fieldNode } from '../components/fields';
import { ValueEditor, editText, fromText, type EditMove } from '../components/ValueEditor';
import { Pager, Sections, ViewMore, useBodyVirtualizer, usePaged, usePages } from '../components/layout';
import { useBoard, useBoardContext } from '../board/context';
import { useDragSensors } from '../components/dnd';
import { PROPERTY_TYPE_ICON } from '../settings/PropertyEditor';
import { Icon } from '../react/Icon';

interface TableProps {
  view: ViewConfig;
  viewIndex: number;
  items: BoardItem[];
  properties: PropertyConfig[];
  sort: SortSpec;
  /** Header of the title column. */
  titleLabel: string;
  /** Tables: the property edited in the title column. */
  titleProp?: PropertyConfig;
}

/**
 * Spreadsheet-style grid: one row per item, the title then each visible
 * property. Select cells (click, shift/drag for a range), move with the
 * keyboard, type or tap a selected cell to edit, copy / paste as TSV. Headers
 * sort on click, reorder by dragging, resize from their right edge. Rows are
 * virtualized; with a group property, rows are split into sections.
 */
export function TableView(props: TableProps) {
  const { view, items, properties } = props;
  // The group property may be hidden in the view: look it up among all properties.
  const allProperties = useBoard((s) => s.config?.properties ?? properties);
  const groupProp = view.group ? allProperties.find((p) => p.name === view.group) : undefined;
  const isTable = useBoard((s) => s.config?.kind === 'table');
  const { actions } = useBoardContext();
  const table = (list: BoardItem[], pageKey: string, group?: ItemGroup) => (
    <Grid key={pageKey} {...props} items={list} pageKey={pageKey} group={group} groupProp={groupProp} />
  );
  if (items.length === 0) return table([], 't');
  if (!groupProp) return table(items, 't');
  return (
    <SyncedScroll>
      <Sections
        items={items}
        groupProp={groupProp}
        view={view}
        pagePrefix="t"
        collapsedContent={view.summary ? (list) => <SummaryTable {...props} items={list} /> : undefined}
      >
        {table}
      </Sections>
      {/* A row outside every group (it lands in Uncategorized). */}
      {isTable && (
        <button className="rb-grid-add rb-grid-add-ungrouped" onClick={() => actions.addRow({})}>
          <Icon name="plus" />
          <span>New row with no {propertyLabel(groupProp)}</span>
        </button>
      )}
      {view.summary && <SummaryTable {...props} label="Total" grand />}
    </SyncedScroll>
  );
}

/**
 * Groups of a table, each with its own sideways scroll, kept in step: scrolling
 * one group scrolls every group and the totals, so their columns stay lined up.
 */
function SyncedScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    let left = 0;
    // Scroll events don't bubble: listen in the capture phase.
    const onScroll = (e: Event): void => {
      const from = e.target as HTMLElement;
      if (!from.classList?.contains('rb-table-wrap') || from.scrollLeft === left) return;
      left = from.scrollLeft;
      for (const wrap of box.querySelectorAll<HTMLElement>('.rb-table-wrap')) {
        if (wrap !== from && wrap.scrollLeft !== left) wrap.scrollLeft = left;
      }
    };
    box.addEventListener('scroll', onScroll, true);
    // Groups opened later start at the shared position.
    const mo = new MutationObserver(() => {
      for (const wrap of box.querySelectorAll<HTMLElement>('.rb-table-wrap')) if (wrap.scrollLeft !== left) wrap.scrollLeft = left;
    });
    mo.observe(box, { childList: true, subtree: true });
    return () => {
      box.removeEventListener('scroll', onScroll, true);
      mo.disconnect();
    };
  }, []);
  return (
    <div className="rb-grid-groups" ref={ref}>
      {children}
    </div>
  );
}

/** The grid's columns: the title, then each visible property. */
function gridColumns(properties: PropertyConfig[], titleProp: PropertyConfig | undefined): Col[] {
  return [{ key: TITLE_SORT_KEY, prop: titleProp, title: true }, ...properties.map((p) => ({ key: p.name, prop: p, title: false }))];
}

const columnWidth = (view: ViewConfig, col: Col): number => view.widths?.[col.key] ?? defaultWidth(col);

/**
 * A summary row on its own, aligned with the tables around it: a collapsed
 * group's totals, or (`grand`) the total over every group.
 */
function SummaryTable({ view, viewIndex, items, properties, titleProp, label, grand = false }: TableProps & { label?: string; grand?: boolean }) {
  const cols = useMemo(() => gridColumns(properties, titleProp), [properties, titleProp]);
  const widths = cols.map((c) => columnWidth(view, c));
  return (
    <div className={grand ? 'rb-table-wrap rb-grid rb-summary-only rb-grand-total' : 'rb-table-wrap rb-grid rb-summary-only'}>
      <table className="rb-table" style={{ width: widths.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={cols[i].key} style={{ width: w }} />
          ))}
        </colgroup>
        <tfoot>
          {/* No column headers above these rows: each total names its column. */}
          <SummaryRow view={view} viewIndex={viewIndex} cols={cols} items={items} label={label} named />
        </tfoot>
      </table>
    </div>
  );
}

/**
 * The summary row: the row count under the title, and per column the chosen
 * calculation (click a cell to choose; saved with the view).
 */
function SummaryRow({
  view,
  viewIndex,
  cols,
  items,
  label,
  named = false,
}: {
  view: ViewConfig;
  viewIndex: number;
  cols: Col[];
  items: BoardItem[];
  label?: string;
  /** Captions include the column name (rows shown without column headers). */
  named?: boolean;
}) {
  const updateView = useBoard((s) => s.updateView);
  const choose = (e: ReactMouseEvent, prop: PropertyConfig): void => {
    const current = view.calculations?.[prop.name];
    const m = new Menu();
    m.addItem((i) => {
      i.setTitle('None').onClick(() => updateView(viewIndex, (v) => {
        if (v.calculations) delete v.calculations[prop.name];
      }));
      if (!current) i.setChecked(true);
    });
    for (const calc of calculationsFor(prop)) {
      m.addItem((i) => {
        i.setTitle(CALCULATION_LABELS[calc]).onClick(() => updateView(viewIndex, (v) => void (v.calculations = { ...v.calculations, [prop.name]: calc })));
        if (calc === current) i.setChecked(true);
      });
    }
    m.showAtMouseEvent(e.nativeEvent);
  };
  return (
    <tr className="rb-summary-row">
      {cols.map((col) => {
        if (col.title) {
          return (
            <td key={col.key} className="rb-td rb-summary-cell rb-summary-title">
              {label && <span className="rb-summary-label">{label}</span>}
              <span className="rb-summary-count">
                {items.length} row{items.length === 1 ? '' : 's'}
              </span>
            </td>
          );
        }
        const prop = col.prop!;
        const calc = view.calculations?.[prop.name];
        return (
          <td
            key={col.key}
            className="rb-td rb-summary-cell"
            onClick={(e) => choose(e, prop)}
            title={calc ? `${CALCULATION_LABELS[calc]} of ${propertyLabel(prop)} · click to change` : 'Choose a calculation'}
          >
            {calc ? (
              <>
                <span className="rb-summary-caption">{named ? `${propertyLabel(prop)} · ${CALCULATION_LABELS[calc]}` : CALCULATION_LABELS[calc]}</span>
                <span className="rb-summary-value">{calculationText(calculate(items, prop, calc), prop, calc)}</span>
              </>
            ) : (
              <span className="rb-summary-hint">Calculate</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

const ROW_ESTIMATE = 37;
const MIN_WIDTH = 60;

/** A grid column: the title (key `$title`) or a property. */
interface Col {
  key: string;
  /** The property edited in this column; for a board's title column, none. */
  prop?: PropertyConfig;
  title: boolean;
}

interface Pos {
  r: number;
  c: number;
}

/** What a row needs to know about the selection (one shared object for unselected rows, so they skip re-rendering). */
interface RowSel {
  active: number;
  c0: number;
  c1: number;
  editing: number;
  seed?: string;
}
const NO_SEL: RowSel = { active: -1, c0: -1, c1: -1, editing: -1 };

function defaultWidth(col: Col): number {
  if (col.title) return 240;
  switch (col.prop?.type) {
    case 'checkbox':
      return 90;
    case 'number':
      return 110;
    case 'date':
      return 130;
    case 'image':
      return 90;
    default:
      return 170;
  }
}

/** Plain text of a cell, as copied to the clipboard. */
function cellText(item: BoardItem, col: Col): string {
  if (col.title) return item.title;
  const prop = col.prop!;
  const v = fieldValue(item, prop);
  if (v === undefined || v === null) return '';
  switch (prop.type) {
    case 'select':
    case 'multi':
      return asArray(v).map((x) => optionFor(prop, x).label).join(', ');
    case 'checkbox':
      return String(asBoolean(v) ?? false);
    case 'formula':
      return toText(v as FValue);
    default:
      return editText(prop, v);
  }
}

const isInEditor = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.rb-cell-editor');

function Grid({
  view,
  viewIndex,
  items,
  properties,
  sort,
  titleLabel,
  titleProp,
  pageKey,
  group,
  groupProp,
}: TableProps & { pageKey: string; group?: ItemGroup; groupProp?: PropertyConfig }) {
  const updateView = useBoard((s) => s.updateView);
  const isTable = useBoard((s) => s.config?.kind === 'table');
  const allProperties = useBoard((s) => s.config?.properties);
  const { scrollRef, actions } = useBoardContext();
  const sensors = useDragSensors();
  const usingPages = view.paging === 'pages';
  // Both hooks always run (hook order); the view's paging mode picks one.
  const growing = usePaged(pageKey, items, view.limit ?? 50);
  const paged = usePages(`${pageKey}#page`, items, view.limit ?? 50);
  const visible = usingPages ? paged.visible : growing.visible;
  const { listRef, virtualizer } = useBodyVirtualizer({ count: visible.length, estimateSize: ROW_ESTIMATE });
  const wrapRef = useRef<HTMLDivElement>(null);

  const cols = useMemo<Col[]>(() => gridColumns(properties, titleProp), [properties, titleProp]);
  const widths = cols.map((c) => columnWidth(view, c));
  const total = widths.reduce((a, b) => a + b, 0);

  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<(Pos & { seed?: string }) | null>(null);
  const dragging = useRef(false);

  // The selection follows its item when sorting, filtering or edits reorder rows.
  const selIds = useRef<{ id: string; key: string } | null>(null);
  const pending = useRef<{ id: string; edit: boolean } | null>(null);
  useEffect(() => {
    selIds.current = active && visible[active.r] && cols[active.c] ? { id: visible[active.r].id, key: cols[active.c].key } : null;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = pending.current?.id ?? selIds.current?.id;
    if (!want) return;
    const r = visible.findIndex((i) => i.id === want);
    const c = pending.current ? 0 : cols.findIndex((x) => x.key === selIds.current?.key);
    if (r < 0 || c < 0) {
      if (!pending.current) {
        setActive(null);
        setAnchor(null);
        setEditing(null);
      }
      return;
    }
    const edit = pending.current?.edit;
    pending.current = null;
    if (!active || active.r !== r || active.c !== c) {
      setActive({ r, c });
      setAnchor({ r, c });
      setEditing((e) => (e ? { ...e, r, c } : e));
    }
    if (edit) setEditing({ r, c });
  }, [visible, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = active && {
    r0: Math.min((anchor ?? active).r, active.r),
    r1: Math.max((anchor ?? active).r, active.r),
    c0: Math.min((anchor ?? active).c, active.c),
    c1: Math.max((anchor ?? active).c, active.c),
  };

  const focusGrid = (): void => wrapRef.current?.focus({ preventScroll: true });

  const reveal = (p: Pos): void => {
    virtualizer.scrollToIndex(p.r, { align: 'auto' });
    requestAnimationFrame(() => {
      wrapRef.current
        ?.querySelector(`[data-pos="${p.r}:${p.c}"]`)
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  };

  const select = (p: Pos, extend = false): void => {
    setActive(p);
    if (!extend) setAnchor(p);
    reveal(p);
  };

  const move = (dr: number, dc: number, extend = false): void => {
    if (visible.length === 0) return;
    if (!active) return select({ r: 0, c: 0 });
    select({ r: Math.max(0, Math.min(visible.length - 1, active.r + dr)), c: Math.max(0, Math.min(cols.length - 1, active.c + dc)) }, extend);
  };

  /** Board titles and board formulas are not stored as editable cells. */
  const readOnly = (col: Col): boolean => !col.prop || (!isTable && col.prop.type === 'formula');

  const write = (item: BoardItem, prop: PropertyConfig, value: StoredValue): void => {
    actions.setValue(item, prop, value).catch(() => undefined);
  };

  const toggle = (item: BoardItem, prop: PropertyConfig): void => write(item, prop, !(asBoolean(fieldValue(item, prop)) ?? false));

  const beginEdit = (p: Pos, seed?: string): void => {
    const item = visible[p.r];
    const col = cols[p.c];
    if (!item || !col) return;
    if (col.title && !isTable) return actions.editItem(item);
    if (readOnly(col)) return;
    if (col.prop!.type === 'checkbox') return toggle(item, col.prop!);
    setEditing({ ...p, seed });
  };

  const endEdit = (move_: EditMove): void => {
    setEditing(null);
    focusGrid();
    if (move_ === 'down') move(1, 0);
    else if (move_ === 'right') move(0, 1);
    else if (move_ === 'left') move(0, -1);
  };

  // ------------------------------------------------------------ clipboard

  const copyRange = async (cut: boolean): Promise<void> => {
    if (!range) return;
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const cells: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) cells.push(cellText(visible[r], cols[c]).replace(/[\t\n]/g, ' '));
      lines.push(cells.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      if (cut) clearRange();
    } catch {
      new Notice('R Board: could not copy to the clipboard');
    }
  };

  const paste = async (): Promise<void> => {
    if (!active) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      new Notice('R Board: could not read the clipboard');
      return;
    }
    const block = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    if (!text) return;
    // A single value fills the whole selected range; a block pastes from the active cell.
    const single = block.length === 1 && block[0].length === 1 && range;
    const r0 = single ? range.r0 : active.r;
    const c0 = single ? range.c0 : active.c;
    const rows = single ? range.r1 - range.r0 + 1 : block.length;
    const width = single ? range.c1 - range.c0 + 1 : Math.max(...block.map((l) => l.length));
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < width; dc++) {
        const item = visible[r0 + dr];
        const col = cols[c0 + dc];
        const t = single ? block[0][0] : block[dr]?.[dc];
        if (item && col && !readOnly(col) && t !== undefined) write(item, col.prop!, fromText(col.prop!, t));
      }
    }
  };

  const clearRange = (): void => {
    if (!range) return;
    for (let r = range.r0; r <= range.r1; r++) {
      for (let c = range.c0; c <= range.c1; c++) {
        const col = cols[c];
        if (!readOnly(col) && fieldValue(visible[r], col.prop!) != null) write(visible[r], col.prop!, null);
      }
    }
  };

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (editing || isInEditor(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const handled = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    const lower = k.toLowerCase();
    if (mod && lower === 'c') return handled(), void copyRange(false);
    if (mod && lower === 'x') return handled(), void copyRange(true);
    if (mod && lower === 'v') return handled(), void paste();
    if (mod && lower === 'a') {
      handled();
      if (visible.length) {
        setAnchor({ r: 0, c: 0 });
        setActive({ r: visible.length - 1, c: cols.length - 1 });
      }
      return;
    }
    if (!active) {
      if (k.startsWith('Arrow') && visible.length) handled(), select({ r: 0, c: 0 });
      return;
    }
    switch (k) {
      case 'ArrowUp': return handled(), move(mod ? -active.r : -1, 0, e.shiftKey);
      case 'ArrowDown': return handled(), move(mod ? visible.length : 1, 0, e.shiftKey);
      case 'ArrowLeft': return handled(), move(0, mod ? -active.c : -1, e.shiftKey);
      case 'ArrowRight': return handled(), move(0, mod ? cols.length : 1, e.shiftKey);
      case 'Tab': return handled(), move(0, e.shiftKey ? -1 : 1);
      case 'Enter':
      case 'F2': return handled(), beginEdit(active);
      case 'Escape': return handled(), setAnchor(active);
      case 'Delete':
      case 'Backspace': return handled(), clearRange();
      case ' ':
        if (cols[active.c]?.prop?.type === 'checkbox') return handled(), beginEdit(active);
    }
    if (k.length === 1 && !mod && !e.altKey) {
      const type = cols[active.c]?.prop?.type;
      if (readOnly(cols[active.c])) return;
      handled();
      if (type === 'select' || type === 'date' || type === 'checkbox') beginEdit(active);
      else beginEdit(active, k);
    }
  };

  // ------------------------------------------------------------ pointer

  const onCellPointerDown = (e: ReactPointerEvent, p: Pos): void => {
    if (e.button !== 0 || isInEditor(e.target)) return;
    if (editing && editing.r === p.r && editing.c === p.c) return;
    const wasActive = !!active && active.r === p.r && active.c === p.c && (!anchor || (anchor.r === p.r && anchor.c === p.c));
    focusGrid();
    if (e.shiftKey && active) return setActive(p);
    setActive(p);
    setAnchor(p);
    if (e.pointerType === 'mouse') dragging.current = true;
    // Tap an already-selected cell to edit it (the touch-friendly path).
    const col = cols[p.c];
    const onLink = e.target instanceof Element && !!e.target.closest('a');
    if (wasActive && !editing && !onLink && col && !(col.title && !isTable) && col.prop?.type !== 'checkbox') beginEdit(p);
  };

  useEffect(() => {
    const doc = wrapRef.current?.ownerDocument ?? document;
    const up = (): void => void (dragging.current = false);
    doc.addEventListener('pointerup', up);
    return () => doc.removeEventListener('pointerup', up);
  }, []);

  // ------------------------------------------------------------ rows

  const addRow = (after?: string): void => {
    const last = after ?? visible[visible.length - 1]?.id;
    // Inside a group, the new row lands in it (formula groups copy the formula's inputs from a row there).
    const template = group?.items.find((i) => i.id === last) ?? group?.items[group.items.length - 1];
    const cells = groupProp && group ? cellsForGroup(groupProp, allProperties ?? [], view.groupBucket ?? 'none', group, template) : {};
    const id = actions.addRow(cells, last);
    if (id) {
      pending.current = { id, edit: true };
      focusGrid();
    }
  };

  const rowMenu = (e: ReactMouseEvent, r: number): void => {
    e.preventDefault();
    const item = visible[r];
    if (!item) return;
    const inRange = !!range && r >= range.r0 && r <= range.r1;
    const ids = inRange ? visible.slice(range!.r0, range!.r1 + 1).map((x) => x.id) : [item.id];
    if (!inRange) select({ r, c: active?.c ?? 0 });
    const m = new Menu();
    if (item.file) {
      m.addItem((i) => i.setTitle('Edit note').setIcon('pencil').onClick(() => actions.editItem(item)));
      m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-symlink').onClick(() => actions.openNote(item, true)));
    } else {
      m.addItem((i) => i.setTitle('Expand row').setIcon('maximize-2').onClick(() => actions.editItem(item)));
      m.addItem((i) => i.setTitle('Insert row below').setIcon('arrow-down').onClick(() => addRow(item.id)));
      m.addItem((i) => i.setTitle('Duplicate row').setIcon('copy').onClick(() => actions.duplicateRow(item.id)));
      m.addSeparator();
      m.addItem((i) => {
        i.setTitle(ids.length > 1 ? `Delete ${ids.length} rows` : 'Delete row').setIcon('trash-2').onClick(() => actions.deleteRows(ids));
        (i as unknown as { setWarning?: (on: boolean) => void }).setWarning?.(true);
      });
    }
    m.showAtMouseEvent(e.nativeEvent);
  };

  // ------------------------------------------------------------ header

  // Turning the page brings the table's top back into view if it scrolled away.
  const goToPage = (p: number): void => {
    paged.setPage(p);
    const list = listRef.current;
    const body = scrollRef.current;
    if (list && body && list.getBoundingClientRect().top < body.getBoundingClientRect().top) {
      body.scrollTop += list.getBoundingClientRect().top - body.getBoundingClientRect().top;
    }
  };

  const setSort = (key: string, dir?: SortSpec['dir']): void => {
    const next = dir ?? (sort.property === key && sort.dir === 'asc' ? 'desc' : 'asc');
    updateView(viewIndex, (v) => void (v.sort = { property: key, dir: next }));
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent): void => {
    if (!over || a.id === over.id) return;
    const order = properties.map((p) => p.name);
    const next = arrayMove(order, order.indexOf(String(a.id)), order.indexOf(String(over.id)));
    updateView(viewIndex, (v) => void (v.properties = next));
  };

  const hide = (name: string): void =>
    updateView(viewIndex, (v) => void (v.properties = properties.map((p) => p.name).filter((n) => n !== name)));

  const resize = (key: string, width: number): void =>
    updateView(viewIndex, (v) => void (v.widths = { ...(v.widths ?? {}), [key]: Math.max(MIN_WIDTH, Math.round(width)) }));

  // Spacer rows stand in for the rows scrolled out of view.
  const rows = virtualizer.getVirtualItems();
  const start = virtualizer.options.scrollMargin;
  const padTop = rows.length ? rows[0].start - start : 0;
  const padBottom = rows.length ? virtualizer.getTotalSize() - (rows[rows.length - 1].end - start) : 0;

  // Rows are memoized: hand them stable callbacks that read this render's state when called.
  const latest = useRef({ onCellPointerDown, beginEdit, toggle, write, endEdit, rowMenu, setActive });
  latest.current = { onCellPointerDown, beginEdit, toggle, write, endEdit, rowMenu, setActive };
  const handlers = useMemo<RowHandlers>(
    () => ({
      onCellPointerDown: (e, p) => latest.current.onCellPointerDown(e, p),
      onCellEnter: (p) => void (dragging.current && latest.current.setActive(p)),
      onEdit: (p) => latest.current.beginEdit(p),
      onToggle: (item, prop) => latest.current.toggle(item, prop),
      onCommit: (item, prop, value) => latest.current.write(item, prop, value),
      onDone: (m) => latest.current.endEdit(m),
      onMenu: (e, r) => latest.current.rowMenu(e, r),
    }),
    [],
  );

  const rowSel = (r: number): RowSel => {
    const inRange = !!range && r >= range.r0 && r <= range.r1;
    const isEditing = editing?.r === r;
    if (!inRange && !isEditing && active?.r !== r) return NO_SEL;
    return {
      active: active?.r === r ? active.c : -1,
      c0: inRange ? range!.c0 : -1,
      c1: inRange ? range!.c1 : -1,
      editing: isEditing ? editing!.c : -1,
      seed: isEditing ? editing!.seed : undefined,
    };
  };

  return (
    <div className="rb-table-wrap rb-grid" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div ref={listRef}>
        {/* The drag context wraps the table: it adds a screen-reader <div>, which can't live in <thead>. */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={onDragEnd}>
          <table className="rb-table" style={{ width: total }}>
            <colgroup>
              {widths.map((w, i) => (
                <col key={cols[i].key} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <SortableContext items={properties.map((p) => p.name)} strategy={horizontalListSortingStrategy}>
                <tr>
                  {cols.map((col, i) => (
                    <HeaderCell
                      key={col.key}
                      col={col}
                      label={col.title ? titleLabel : propertyLabel(col.prop!)}
                      width={widths[i]}
                      sort={sort}
                      onSort={setSort}
                      onHide={col.title ? undefined : () => hide(col.key)}
                      onResize={(w) => resize(col.key, w)}
                    />
                  ))}
                </tr>
              </SortableContext>
            </thead>
            <tbody>
              {padTop > 0 && <tr className="rb-spacer-row" style={{ height: padTop }} />}
              {rows.map((v) => (
                <Row
                  key={visible[v.index].id}
                  index={v.index}
                  measure={virtualizer.measureElement}
                  item={visible[v.index]}
                  cols={cols}
                  sel={rowSel(v.index)}
                  isTable={isTable}
                  handlers={handlers}
                />
              ))}
              {padBottom > 0 && <tr className="rb-spacer-row" style={{ height: padBottom }} />}
            </tbody>
            {view.summary && (
              <tfoot>
                {/* Over every row of this table (or group), not just the page shown. */}
                <SummaryRow view={view} viewIndex={viewIndex} cols={cols} items={items} />
              </tfoot>
            )}
          </table>
        </DndContext>
      </div>
      {isTable && (
        <button className="rb-grid-add" onClick={() => addRow()}>
          <Icon name="plus" />
          <span>New row</span>
        </button>
      )}
      {!isTable && visible.length === 0 && <div className="rb-empty">No notes match this view.</div>}
      {usingPages ? (
        <Pager page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={goToPage} />
      ) : (
        <ViewMore more={growing.more} remaining={growing.remaining} />
      )}
    </div>
  );
}

function HeaderCell({
  col,
  label,
  width,
  sort,
  onSort,
  onHide,
  onResize,
}: {
  col: Col;
  label: string;
  width: number;
  sort: SortSpec;
  onSort: (key: string, dir?: SortSpec['dir']) => void;
  onHide?: () => void;
  onResize: (width: number) => void;
}) {
  const sortable = !col.title;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key, disabled: !sortable });
  const resizing = useRef(false);

  const menu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const m = new Menu();
    m.addItem((i) => i.setTitle('Sort ascending').setIcon('arrow-up').onClick(() => onSort(col.key, 'asc')));
    m.addItem((i) => i.setTitle('Sort descending').setIcon('arrow-down').onClick(() => onSort(col.key, 'desc')));
    if (onHide) {
      m.addSeparator();
      m.addItem((i) => i.setTitle('Hide in this view').setIcon('eye-off').onClick(onHide));
    }
    m.showAtMouseEvent(e.nativeEvent);
  };

  const onResizeDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    resizing.current = true;
    const th = target.parentElement as HTMLTableCellElement;
    // Every table sharing these columns (a grouped table's groups and totals) follows live.
    const own = th.closest('table')!;
    const tables = [...(th.closest('.rb-grid-groups')?.querySelectorAll<HTMLTableElement>('table.rb-table') ?? [own])];
    const starts = tables.map((t) => t.getBoundingClientRect().width);
    let w = width;
    const onMove = (ev: PointerEvent): void => {
      w = Math.max(MIN_WIDTH, width + ev.clientX - startX);
      // Live feedback on the <col> and the table width (else the neighbours absorb it); saved on release.
      tables.forEach((t, i) => {
        const colEl = t.querySelectorAll('col')[th.cellIndex] as HTMLElement | undefined;
        if (colEl) colEl.style.width = `${w}px`;
        t.style.width = `${starts[i] + w - width}px`;
      });
    };
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (w !== width) onResize(w);
      // Swallow the click that follows the drag so the header doesn't sort.
      setTimeout(() => (resizing.current = false), 0);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <th
      ref={setNodeRef}
      className={`rb-th${sortable ? ' rb-th-draggable' : ''}${isDragging ? ' rb-th-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      title={label}
      onClick={() => !resizing.current && onSort(col.key)}
      onContextMenu={menu}
      {...(sortable ? attributes : {})}
      {...(sortable ? listeners : {})}
    >
      <span className="rb-th-inner">
        {col.prop && <Icon name={PROPERTY_TYPE_ICON[col.prop.type]} className="rb-th-type" />}
        <span className="rb-th-label">{label}</span>
        {sort.property === col.key && <span className="rb-sort-ind">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </span>
      <span className="rb-th-resize" onPointerDown={onResizeDown} onClick={(e) => e.stopPropagation()} />
    </th>
  );
}

interface RowHandlers {
  onCellPointerDown: (e: ReactPointerEvent, p: Pos) => void;
  onCellEnter: (p: Pos) => void;
  onEdit: (p: Pos) => void;
  onToggle: (item: BoardItem, prop: PropertyConfig) => void;
  onCommit: (item: BoardItem, prop: PropertyConfig, value: StoredValue) => void;
  onDone: (move: EditMove) => void;
  onMenu: (e: ReactMouseEvent, r: number) => void;
}

interface RowProps {
  item: BoardItem;
  cols: Col[];
  index: number;
  sel: RowSel;
  isTable: boolean;
  measure: (el: Element | null) => void;
  handlers: RowHandlers;
}

const Row = memo(
  function Row({ item, cols, index, sel, isTable, measure, handlers }: RowProps) {
    const { onCellPointerDown, onCellEnter, onEdit, onToggle, onCommit, onDone, onMenu } = handlers;
    const env = useFieldEnv();
    const { actions } = useBoardContext();
    return (
      <tr className={sel.active >= 0 ? 'rb-tr rb-tr-active' : 'rb-tr'} ref={measure} data-index={index} onContextMenu={(e) => onMenu(e, index)}>
        {cols.map((col, c) => {
          const p = { r: index, c };
          const isActive = sel.active === c;
          const inRange = c >= sel.c0 && c <= sel.c1 && sel.c0 >= 0 && !isActive;
          const isEditing = sel.editing === c;
          const cls = ['rb-td', `rb-td-${col.prop?.type ?? 'title'}`];
          if (isActive) cls.push('rb-cell-active');
          if (inRange) cls.push('rb-cell-range');
          if (isEditing) cls.push('rb-cell-editing');
          let content: React.ReactNode;
          if (col.title && !isTable) content = <TitleLink item={item} />;
          else if (col.title) {
            content = (
              <span className="rb-title-cell">
                {/* A links / url / … title renders like its column would; plain text as is. */}
                <span className="rb-title">
                  {col.prop && col.prop.type !== 'text' ? (fieldNode(env, item, col.prop) ?? item.title) : item.title}
                </span>
                <button
                  className="rb-row-expand"
                  aria-label="Expand row"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.editItem(item);
                  }}
                >
                  <Icon name="maximize-2" />
                </button>
              </span>
            );
          } else {
            content = fieldNode(env, item, col.prop!);
          }
          return (
            <td
              key={col.key}
              className={cls.join(' ')}
              data-pos={`${index}:${c}`}
              onPointerDown={(e) => onCellPointerDown(e, p)}
              // mousedown's default focus would steal focus from a just-opened editor.
              onMouseDown={(e) => !isInEditor(e.target) && e.preventDefault()}
              onPointerEnter={() => onCellEnter(p)}
              onDoubleClick={() => onEdit(p)}
              onClick={col.prop?.type === 'checkbox' ? () => onToggle(item, col.prop!) : undefined}
            >
              {isEditing && col.prop ? (
                <div className="rb-cell-editor">
                  <ValueEditor
                    prop={col.prop}
                    raw={item.file || col.prop.type !== 'formula' ? fieldValue(item, col.prop) : storedOverride(item, col.prop)}
                    seed={sel.seed}
                    autoFocus
                    className="rb-cell-input"
                    onCommit={(value) => onCommit(item, col.prop!, value)}
                    onDone={onDone}
                  />
                </div>
              ) : (
                content
              )}
            </td>
          );
        })}
      </tr>
    );
  },
  // `measure` is stable per virtualizer; `handlers` is stable.
  (a, b) => a.item === b.item && a.cols === b.cols && a.sel === b.sel && a.index === b.index && a.isTable === b.isTable && a.measure === b.measure,
);

/** A table row's stored formula cell (an override), not the computed result. */
function storedOverride(item: BoardItem, prop: PropertyConfig): unknown {
  return (item.stored ?? item.values)[prop.name];
}
