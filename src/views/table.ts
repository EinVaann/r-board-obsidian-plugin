import { Notice, Platform } from 'obsidian';
import type { BoardItem, PropertyConfig, PropertyType, SortDir } from '../types';
import { renderField } from '../render/fields';
import { asArray, asBoolean, fieldValue } from '../render/values';
import { setProperty } from '../data/properties';
import { createTitleLink, renderSectionHeader, type RenderContext } from '../render/common';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { renderPaged } from '../render/paginate';
import { groupItems } from '../data/group';

/** dataTransfer MIME marking a table column-header reorder drag. */
const COLUMN_MIME = 'application/x-rb-table-column';

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
  const table = parent.createDiv({ cls: 'rb-table-wrap' }).createEl('table', { cls: 'rb-table' });
  const headRow = table.createEl('thead').createEl('tr');

  // Move column `dragged` to just before column `before`, then persist the new
  // order on the view (materializing the current order if it wasn't explicit).
  const reorderColumns = (dragged: string, before: string): void => {
    const order = props.map((p) => p.name);
    const from = order.indexOf(dragged);
    if (from === -1) return;
    order.splice(from, 1);
    const to = order.indexOf(before);
    order.splice(to === -1 ? order.length : to, 0, dragged);
    ctx.view.properties = order;
    ctx.commit();
  };

  const makeHeader = (label: string, key: string, draggable = false): void => {
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

    // Property columns can be dragged by their header to reorder (desktop only).
    if (draggable && !Platform.isMobile) {
      th.addClass('rb-th-draggable');
      th.setAttr('draggable', 'true');
      th.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(COLUMN_MIME, key);
        e.dataTransfer!.effectAllowed = 'move';
        th.addClass('rb-th-dragging');
      });
      th.addEventListener('dragend', () => th.removeClass('rb-th-dragging'));
      th.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(COLUMN_MIME)) return;
        e.preventDefault();
        th.addClass('rb-th-drop');
      });
      th.addEventListener('dragleave', () => th.removeClass('rb-th-drop'));
      th.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.types.includes(COLUMN_MIME)) return;
        e.preventDefault();
        th.removeClass('rb-th-drop');
        const dragged = e.dataTransfer.getData(COLUMN_MIME);
        if (dragged && dragged !== key) reorderColumns(dragged, key);
      });
    }
  };

  makeHeader('Title', TITLE_SORT_KEY);
  props.forEach((p) => makeHeader(propertyLabel(p), p.name, true));

  const tbody = table.createEl('tbody');
  renderPaged(tbody, items, ctx.view.limit ?? 50, (item) => {
    const tr = tbody.createEl('tr', { cls: 'rb-tr' });
    createTitleLink(ctx, tr.createEl('td', { cls: 'rb-td' }), item);
    for (const prop of props) {
      const td = tr.createEl('td', { cls: 'rb-td' });
      renderField(ctx, td, item, prop);
      makeEditable(ctx, td, item, prop);
    }
  }, { key: pageKey, store: ctx.ui.pages });
}

/** Property types whose table cells can be edited in place. */
const EDITABLE: ReadonlySet<PropertyType> = new Set(['text', 'number', 'multi', 'checkbox']);

/**
 * Inline editing: a click toggles a checkbox; a double-click opens an input for
 * text / number / multi (comma-separated). The metadata-change refresh repaints.
 */
function makeEditable(ctx: RenderContext, td: HTMLElement, item: BoardItem, prop: PropertyConfig): void {
  if (!EDITABLE.has(prop.type)) return;
  td.addClass('rb-td-editable');
  const write = (value: string | string[] | null): void => {
    setProperty(ctx.app, item.file, prop, value).catch((e) =>
      new Notice(`R Board: could not update ${prop.name} — ${(e as Error).message}`),
    );
  };

  if (prop.type === 'checkbox') {
    td.addClass('rb-td-toggle');
    td.onclick = () => write(String(!(asBoolean(fieldValue(item, prop)) ?? false)));
    return;
  }

  td.setAttr('title', 'Double-click to edit');
  td.ondblclick = () => {
    const raw = fieldValue(item, prop);
    const initial = prop.type === 'multi' ? asArray(raw).join(', ') : raw == null ? '' : String(raw);
    td.empty();
    const input = td.createEl('input', {
      cls: 'rb-cell-input',
      attr: { type: prop.type === 'number' ? 'number' : 'text' },
    });
    input.value = initial;
    input.focus();
    input.select();

    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (!save || next === initial.trim()) {
        td.empty();
        renderField(ctx, td, item, prop);
        return;
      }
      input.disabled = true;
      if (next === '') write(null);
      else if (prop.type === 'multi') write(next.split(',').map((s) => s.trim()).filter((s) => s !== ''));
      else write(next);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    input.onblur = () => finish(true);
  };
}
