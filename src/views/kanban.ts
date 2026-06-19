import { Notice, TFile, setIcon } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { groupItems, type ItemGroup } from '../data/group';
import { setProperty } from '../data/properties';
import { renderField } from '../render/fields';
import { bodyProperties, coverProperty, createTitleLink, type RenderContext } from '../render/common';
import { byScoreDesc } from '../render/values';
import { renderPaged } from '../render/paginate';

/**
 * Kanban board: one column per distinct value of the view's group property,
 * plus an Uncategorized column for notes missing it. Cards are sorted by
 * `score` descending and can be dragged between columns, which rewrites the
 * group property in the note's frontmatter.
 */
export function renderKanban(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();

  const groupProp = ctx.view.group
    ? ctx.config.properties.find((p) => p.name === ctx.view.group)
    : undefined;
  if (!groupProp) {
    host.createDiv({
      cls: 'rb-empty',
      text: 'This kanban view needs a "group" property to use as columns.',
    });
    return;
  }

  const board = host.createDiv({ cls: 'rb-kanban' });
  for (const column of groupItems(items, groupProp, ctx.view.columns)) {
    renderColumn(board, column, groupProp, ctx);
  }
}

function renderColumn(
  board: HTMLElement,
  column: ItemGroup,
  groupProp: PropertyConfig,
  ctx: RenderContext,
): void {
  const collapsed = ctx.ui.collapsed.has(column.label);
  const colEl = board.createDiv({ cls: 'rb-kanban-col' });
  if (collapsed) colEl.addClass('rb-collapsed');

  const header = colEl.createDiv({ cls: 'rb-kanban-header' });
  const caret = header.createSpan({ cls: 'rb-kanban-caret' });
  setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down');
  header.createSpan({ cls: 'rb-kanban-title', text: column.label });
  header.createSpan({ cls: 'rb-kanban-count', text: String(column.items.length) });
  header.onclick = () => {
    if (collapsed) ctx.ui.collapsed.delete(column.label);
    else ctx.ui.collapsed.add(column.label);
    ctx.refresh();
  };

  const list = colEl.createDiv({ cls: 'rb-kanban-list' });
  if (collapsed) return;

  renderPaged(list, byScoreDesc(column.items), ctx.view.limit ?? 50, (item, host) =>
    renderCard(host, item, ctx),
  );

  // Drop zone: accept cards dragged from other columns.
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    list.addClass('rb-drop-active');
  });
  list.addEventListener('dragleave', () => list.removeClass('rb-drop-active'));
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    list.removeClass('rb-drop-active');
    const path = e.dataTransfer?.getData('text/plain');
    if (path) void handleDrop(path, column, groupProp, ctx);
  });
}

function renderCard(list: HTMLElement, item: BoardItem, ctx: RenderContext): void {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);

  const card = list.createDiv({ cls: 'rb-card rb-kanban-card', attr: { draggable: 'true' } });
  card.dataset.path = item.file.path;

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', item.file.path);
    card.addClass('rb-dragging');
  });
  card.addEventListener('dragend', () => card.removeClass('rb-dragging'));

  if (cover) renderField(ctx.app, card, item, cover);

  const body = card.createDiv({ cls: 'rb-card-body' });
  createTitleLink(ctx.app, body, item);
  for (const prop of fields) {
    const row = body.createDiv({ cls: 'rb-field' });
    if (!renderField(ctx.app, row, item, prop)) row.remove();
  }
}

async function handleDrop(
  path: string,
  column: ItemGroup,
  groupProp: PropertyConfig,
  ctx: RenderContext,
): Promise<void> {
  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  try {
    await setProperty(ctx.app, file, groupProp, column.key);
    ctx.refresh();
  } catch (e) {
    new Notice(`R Board: could not move note — ${(e as Error).message}`);
  }
}
