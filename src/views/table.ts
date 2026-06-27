import type { BoardItem, PropertyConfig, SortDir } from '../types';
import { renderField } from '../render/fields';
import { createTitleLink, renderSectionHeader, type RenderContext } from '../render/common';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { renderPaged } from '../render/paginate';
import { groupItems } from '../data/group';

/**
 * Tabular view: one row per note, a column per visible property plus the title.
 * Clicking a header sorts by that column (persisted on the view). Clicking a row
 * opens the note. When the view sets `group`, rows are split into labelled
 * tables. Items arrive already sorted by the view's sort.
 */
export function renderTable(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'No notes match this view.' });
    return;
  }

  const props = ctx.properties;
  const groupProp = ctx.view.group ? props.find((p) => p.name === ctx.view.group) : undefined;
  if (groupProp) {
    for (const group of groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig)) {
      const section = host.createDiv({ cls: 'rb-section' });
      const color = group.key != null ? ctx.view.groupConfig?.[group.key]?.color : undefined;
      const collapsed = renderSectionHeader(ctx, section, group.label, group.items.length, color);
      if (!collapsed) renderTableEl(section, group.items, props, ctx, `t:${group.label}`);
    }
    return;
  }

  renderTableEl(host, items, props, ctx, 't');
}

function renderTableEl(
  parent: HTMLElement,
  items: BoardItem[],
  props: PropertyConfig[],
  ctx: RenderContext,
  pageKey: string,
): void {
  const table = parent.createEl('table', { cls: 'rb-table' });
  const headRow = table.createEl('thead').createEl('tr');

  const makeHeader = (label: string, key: string): void => {
    const th = headRow.createEl('th', { cls: 'rb-th' });
    th.createSpan({ text: label });
    if (ctx.sort.property === key) {
      th.createSpan({ cls: 'rb-sort-ind', text: ctx.sort.dir === 'asc' ? ' ▲' : ' ▼' });
    }
    th.onclick = () => {
      const dir: SortDir =
        ctx.sort.property === key && ctx.sort.dir === 'asc' ? 'desc' : 'asc';
      ctx.setSort({ property: key, dir });
    };
  };

  makeHeader('Title', TITLE_SORT_KEY);
  props.forEach((p) => makeHeader(propertyLabel(p), p.name));

  const tbody = table.createEl('tbody');
  renderPaged(tbody, items, ctx.view.limit ?? 50, (item) => {
    const tr = tbody.createEl('tr', { cls: 'rb-tr' });
    createTitleLink(ctx, tr.createEl('td', { cls: 'rb-td' }), item);
    for (const prop of props) {
      renderField(ctx, tr.createEl('td', { cls: 'rb-td' }), item, prop);
    }
  }, { key: pageKey, store: ctx.ui.pages });
}
