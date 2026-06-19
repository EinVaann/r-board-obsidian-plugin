import type { BoardItem, FieldConfig } from '../types';
import { renderField } from '../render/fields';
import { createTitleLink, type RenderContext } from '../render/common';
import { fieldLabel } from '../config';
import { renderPaged } from '../render/paginate';
import { asNumber, fieldValue } from '../render/values';

/** Sort state for the table; column index -1 means the title column. */
interface SortState {
  col: number;
  dir: 1 | -1;
}

const sortByView = new WeakMap<RenderContext, SortState>();

/**
 * Tabular view: one row per note, a column per configured field plus the title.
 * Clicking a header sorts by that column (toggling ascending/descending).
 */
export function renderTable(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'No notes match this board.' });
    return;
  }

  const fields = ctx.config.fields;
  const sort = sortByView.get(ctx);
  const sorted = sort ? sortItems(items, fields, sort) : items;

  const table = host.createEl('table', { cls: 'rb-table' });
  const thead = table.createEl('thead');
  const headRow = thead.createEl('tr');

  const makeHeader = (label: string, col: number): void => {
    const th = headRow.createEl('th', { cls: 'rb-th' });
    th.createSpan({ text: label });
    if (sort?.col === col) th.createSpan({ cls: 'rb-sort-ind', text: sort.dir === 1 ? ' ▲' : ' ▼' });
    th.onclick = () => {
      const cur = sortByView.get(ctx);
      const dir: 1 | -1 = cur && cur.col === col && cur.dir === 1 ? -1 : 1;
      sortByView.set(ctx, { col, dir });
      ctx.refresh();
    };
  };

  makeHeader('Title', -1);
  fields.forEach((f, i) => makeHeader(fieldLabel(f), i));

  const tbody = table.createEl('tbody');
  renderPaged(tbody, sorted, (item) => {
    const tr = tbody.createEl('tr', { cls: 'rb-tr' });
    createTitleLink(ctx.app, tr.createEl('td', { cls: 'rb-td' }), item);
    for (const field of fields) {
      const td = tr.createEl('td', { cls: 'rb-td' });
      renderField(ctx.app, td, item, field);
    }
  });
}

function sortItems(items: BoardItem[], fields: FieldConfig[], sort: SortState): BoardItem[] {
  const out = [...items];
  out.sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (sort.col === -1) {
      av = a.title.toLowerCase();
      bv = b.title.toLowerCase();
    } else {
      const field = fields[sort.col];
      if (field.type === 'number') {
        av = asNumber(fieldValue(a, field)) ?? Number.NEGATIVE_INFINITY;
        bv = asNumber(fieldValue(b, field)) ?? Number.NEGATIVE_INFINITY;
      } else {
        av = String(fieldValue(a, field) ?? '').toLowerCase();
        bv = String(fieldValue(b, field) ?? '').toLowerCase();
      }
    }
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  });
  return out;
}
