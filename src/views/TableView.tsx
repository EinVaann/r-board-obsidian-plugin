import { memo, useRef, useState } from 'react';
import { Notice } from 'obsidian';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { BoardItem, PropertyConfig, PropertyType, SortSpec, ViewConfig } from '../types';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { asArray, asBoolean, fieldValue } from '../render/values';
import { setProperty } from '../data/properties';
import { TitleLink, useFieldEnv } from '../components/Card';
import { fieldNode } from '../components/fields';
import { Pager, Sections, ViewMore, useBodyVirtualizer, usePaged, usePages } from '../components/layout';
import { useBoard, useBoardContext } from '../board/context';
import { useDragSensors } from '../components/dnd';

interface TableProps {
  view: ViewConfig;
  viewIndex: number;
  items: BoardItem[];
  properties: PropertyConfig[];
  sort: SortSpec;
}

/**
 * Tabular view: one row per note, a column per visible property plus the
 * title. Click a header to sort; drag a header to reorder columns; double-click
 * a cell to edit it. Rows are virtualized. When the view sets `group`, rows
 * are split into labelled tables.
 */
export function TableView(props: TableProps) {
  const { view, items, properties } = props;
  if (items.length === 0) return <div className="rb-empty">No notes match this view.</div>;

  const groupProp = view.group ? properties.find((p) => p.name === view.group) : undefined;
  const table = (list: BoardItem[], pageKey: string) => <TableEl key={pageKey} {...props} items={list} pageKey={pageKey} />;
  return groupProp ? (
    <Sections items={items} groupProp={groupProp} view={view} pagePrefix="t">{table}</Sections>
  ) : (
    table(items, 't')
  );
}

const ROW_ESTIMATE = 41;

function TableEl({ view, viewIndex, items, properties, sort, pageKey }: TableProps & { pageKey: string }) {
  const updateView = useBoard((s) => s.updateView);
  const { scrollRef } = useBoardContext();
  const sensors = useDragSensors();
  const usingPages = view.paging === 'pages';
  // Both hooks always run (hook order); the view's paging mode picks one.
  const growing = usePaged(pageKey, items, view.limit ?? 50);
  const paged = usePages(`${pageKey}#page`, items, view.limit ?? 50);
  const visible = usingPages ? paged.visible : growing.visible;
  const { listRef, virtualizer } = useBodyVirtualizer({ count: visible.length, estimateSize: ROW_ESTIMATE });

  // Turning the page brings the table's top back into view if it scrolled away.
  const goToPage = (p: number): void => {
    paged.setPage(p);
    const list = listRef.current;
    const body = scrollRef.current;
    if (list && body && list.getBoundingClientRect().top < body.getBoundingClientRect().top) {
      body.scrollTop += list.getBoundingClientRect().top - body.getBoundingClientRect().top;
    }
  };

  const setSort = (key: string): void => {
    const dir = sort.property === key && sort.dir === 'asc' ? 'desc' : 'asc';
    updateView(viewIndex, (v) => {
      v.sort = { property: key, dir };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const order = properties.map((p) => p.name);
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    updateView(viewIndex, (v) => {
      v.properties = next;
    });
  };

  // Spacer rows stand in for the rows scrolled out of view.
  const rows = virtualizer.getVirtualItems();
  const start = virtualizer.options.scrollMargin;
  const padTop = rows.length ? rows[0].start - start : 0;
  const padBottom = rows.length ? virtualizer.getTotalSize() - (rows[rows.length - 1].end - start) : 0;

  return (
    <div className="rb-table-wrap" ref={listRef}>
      {/* The drag context wraps the table: it adds a screen-reader <div>, which can't live in <thead>. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={onDragEnd}>
        <table className="rb-table">
          <thead>
            <SortableContext items={properties.map((p) => p.name)} strategy={horizontalListSortingStrategy}>
              <tr>
                <HeaderCell label="Title" sortKey={TITLE_SORT_KEY} sort={sort} onSort={setSort} />
                {properties.map((p) => (
                  <HeaderCell key={p.name} label={propertyLabel(p)} sortKey={p.name} sort={sort} onSort={setSort} sortable />
                ))}
              </tr>
            </SortableContext>
          </thead>
          <tbody>
            {padTop > 0 && <tr className="rb-spacer-row" style={{ height: padTop }} />}
            {rows.map((v) => (
              <Row key={visible[v.index].file.path} index={v.index} measure={virtualizer.measureElement} item={visible[v.index]} properties={properties} />
            ))}
            {padBottom > 0 && <tr className="rb-spacer-row" style={{ height: padBottom }} />}
          </tbody>
        </table>
      </DndContext>
      {usingPages ? (
        <Pager page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={goToPage} />
      ) : (
        <ViewMore more={growing.more} remaining={growing.remaining} />
      )}
    </div>
  );
}

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  sortable = false,
}: {
  label: string;
  sortKey: string;
  sort: SortSpec;
  onSort: (key: string) => void;
  sortable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortKey, disabled: !sortable });
  return (
    <th
      ref={setNodeRef}
      className={`rb-th${sortable ? ' rb-th-draggable' : ''}${isDragging ? ' rb-th-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={() => onSort(sortKey)}
      {...(sortable ? attributes : {})}
      {...(sortable ? listeners : {})}
    >
      <span>{label}</span>
      {sort.property === sortKey && <span className="rb-sort-ind">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
    </th>
  );
}

const Row = memo(function Row({
  item,
  properties,
  index,
  measure,
}: {
  item: BoardItem;
  properties: PropertyConfig[];
  index: number;
  measure: (el: Element | null) => void;
}) {
  return (
    <tr className="rb-tr" ref={measure} data-index={index}>
      <td className="rb-td">
        <TitleLink item={item} />
      </td>
      {properties.map((prop) => (
        <Cell key={prop.name} item={item} prop={prop} />
      ))}
    </tr>
  );
});

/** Property types whose table cells can be edited in place. */
const EDITABLE: ReadonlySet<PropertyType> = new Set(['text', 'number', 'multi', 'checkbox']);

/**
 * A table cell. Checkboxes toggle on click; text / number / multi
 * (comma-separated) cells edit on double-click. The metadata-change refresh
 * repaints the row once the note is written.
 */
function Cell({ item, prop }: { item: BoardItem; prop: PropertyConfig }) {
  const env = useFieldEnv();
  const { app } = useBoardContext();
  const [editing, setEditing] = useState<string | null>(null);
  // Enter/Escape and the blur that follows must only finish the edit once.
  const done = useRef(false);

  const content = fieldNode(env, item, prop);
  if (!EDITABLE.has(prop.type)) return <td className="rb-td">{content}</td>;

  const write = (value: string | string[] | null): void => {
    setProperty(app, item.file, prop, value).catch((e) =>
      new Notice(`R Board: could not update ${prop.name} — ${(e as Error).message}`),
    );
  };

  if (prop.type === 'checkbox') {
    return (
      <td className="rb-td rb-td-editable rb-td-toggle" onClick={() => write(String(!(asBoolean(fieldValue(item, prop)) ?? false)))}>
        {content}
      </td>
    );
  }

  const raw = fieldValue(item, prop);
  const initial = prop.type === 'multi' ? asArray(raw).join(', ') : raw == null ? '' : String(raw);
  const finish = (save: boolean, value: string): void => {
    if (done.current) return;
    done.current = true;
    setEditing(null);
    const next = value.trim();
    if (!save || next === initial.trim()) return;
    if (next === '') write(null);
    else if (prop.type === 'multi') write(next.split(',').map((s) => s.trim()).filter((s) => s !== ''));
    else write(next);
  };

  return (
    <td className="rb-td rb-td-editable" title="Double-click to edit" onDoubleClick={() => {
        done.current = false;
        setEditing(initial);
      }}>
      {editing === null ? (
        content
      ) : (
        <input
          className="rb-cell-input"
          type={prop.type === 'number' ? 'number' : 'text'}
          defaultValue={editing}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => finish(true, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true, e.currentTarget.value);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              finish(false, '');
            }
          }}
        />
      )}
    </td>
  );
}
