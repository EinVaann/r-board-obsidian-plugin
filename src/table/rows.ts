import type { BoardItem, PropertyConfig, TableRow } from '../types';
import { toStored, type StoredValue } from '../data/properties';
import { newId } from './format';

/** A row as a view item; its title is the title property's text. */
export function rowToItem(row: TableRow, titleProperty: string | undefined): BoardItem {
  const t = titleProperty ? row.cells[titleProperty] : undefined;
  return { id: row.id, title: t == null ? '' : Array.isArray(t) ? t.join(', ') : String(t), values: row.cells, tags: [] };
}

/**
 * Rows → items, reusing each unchanged row's item (Immer keeps untouched rows
 * identical), so memoized cards skip re-rendering. The cache must be reset
 * when the title property changes.
 */
export function rowsToItems(rows: TableRow[], titleProperty: string | undefined, cache: WeakMap<TableRow, BoardItem>): BoardItem[] {
  return rows.map((row) => {
    let item = cache.get(row);
    if (!item) cache.set(row, (item = rowToItem(row, titleProperty)));
    return item;
  });
}

/** Set (or clear) one cell. A formula cell keeps `=expr` overrides as text. */
export function setCell(rows: TableRow[], id: string, prop: PropertyConfig, value: StoredValue): void {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const stored = prop.type === 'formula' ? formulaCell(value) : toStored(prop, value);
  if (stored === null) delete row.cells[prop.name];
  else row.cells[prop.name] = stored;
}

/** A formula override: `=expr`, a number, or text; empty clears it (back to the property's formula). */
function formulaCell(value: StoredValue): StoredValue {
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('=')) return t;
  const n = Number(t);
  return t !== '' && !Number.isNaN(n) ? n : t;
}

/** Append (or insert after `after`) a row with the given cells; returns its id. */
export function addRow(rows: TableRow[], cells: Record<string, unknown> = {}, after?: string): string {
  const id = newId('r', rows.map((r) => r.id));
  const row: TableRow = { id, cells: { ...cells } };
  const at = after ? rows.findIndex((r) => r.id === after) : -1;
  if (at >= 0) rows.splice(at + 1, 0, row);
  else rows.push(row);
  return id;
}

export function deleteRows(rows: TableRow[], ids: Iterable<string>): void {
  const gone = new Set(ids);
  for (let i = rows.length - 1; i >= 0; i--) if (gone.has(rows[i].id)) rows.splice(i, 1);
}

export function duplicateRow(rows: TableRow[], id: string): string | null {
  const row = rows.find((r) => r.id === id);
  // Cells are scalars or string lists; copy lists so the rows don't share them.
  const cells = row && Object.fromEntries(Object.entries(row.cells).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  return cells ? addRow(rows, cells, id) : null;
}
