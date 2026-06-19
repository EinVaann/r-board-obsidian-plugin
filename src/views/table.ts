import type { BoardItem, PropertyConfig } from '../types';
import { renderField } from '../render/fields';
import { createTitleLink, type RenderContext } from '../render/common';
import { propertyLabel } from '../config';
import { renderPaged } from '../render/paginate';
import { asNumber, fieldValue } from '../render/values';
import { groupItems } from '../data/group';

/** Sort state for the table; column index -1 means the title column. */
interface SortState {
  col: number;
  dir: 1 | -1;
}

const sortByView = new WeakMap<RenderContext, SortState>();

/**
 * Tabular view: one row per note, a column per visible property plus the title.
 * Clicking a header sorts by that column. When the view sets `group`, rows are
 * split into labelled tables.
 */
export function renderTable(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'No notes match this view.' });
    return;
  }

  const props = ctx.properties;
  const sort = sortByView.get(ctx);
  const sorted = sort ? sortItems(items, props, sort) : items;

  const groupProp = ctx.view.group ? props.find((p) => p.name === ctx.view.group) : undefined;
  if (groupProp) {
    for (const group of groupItems(sorted, groupProp, ctx.view.columns)) {
      const section = host.createDiv({ cls: 'rb-section' });
      const header = section.createDiv({ cls: 'rb-section-header' });
      header.createSpan({ cls: 'rb-section-title', text: group.label });
      header.createSpan({ cls: 'rb-section-count', text: String(group.items.length) });
      renderTableEl(section, group.items, props, sort, ctx);
    }
    return;
  }

  renderTableEl(host, sorted, props, sort, ctx);
}

function renderTableEl(
  parent: HTMLElement,
  items: BoardItem[],
  props: PropertyConfig[],
  sort: SortState | undefined,
  ctx: RenderContext,
): void {
  const table = parent.createEl('table', { cls: 'rb-table' });
  const headRow = table.createEl('thead').createEl('tr');

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
  props.forEach((p, i) => makeHeader(propertyLabel(p), i));

  const tbody = table.createEl('tbody');
  renderPaged(tbody, items, ctx.view.limit ?? 50, (item) => {
    const tr = tbody.createEl('tr', { cls: 'rb-tr' });
    createTitleLink(ctx.app, tr.createEl('td', { cls: 'rb-td' }), item);
    for (const prop of props) {
      renderField(ctx.app, tr.createEl('td', { cls: 'rb-td' }), item, prop);
    }
  });
}

function sortItems(items: BoardItem[], props: PropertyConfig[], sort: SortState): BoardItem[] {
  const out = [...items];
  out.sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (sort.col === -1) {
      av = a.title.toLowerCase();
      bv = b.title.toLowerCase();
    } else {
      const prop = props[sort.col];
      if (prop.type === 'number') {
        av = asNumber(fieldValue(a, prop)) ?? Number.NEGATIVE_INFINITY;
        bv = asNumber(fieldValue(b, prop)) ?? Number.NEGATIVE_INFINITY;
      } else {
        av = String(fieldValue(a, prop) ?? '').toLowerCase();
        bv = String(fieldValue(b, prop) ?? '').toLowerCase();
      }
    }
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  });
  return out;
}
