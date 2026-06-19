import { Notice, TFile, setIcon } from 'obsidian';
import type { BoardItem } from '../types';
import { partitionKanban, type KanbanColumn } from '../data/query';
import { moveToGroup } from '../data/tags';
import { renderField } from '../render/fields';
import { bodyFields, coverField, createTitleLink, type RenderContext } from '../render/common';
import { byScoreDesc } from '../render/values';

/**
 * Kanban board: one column per configured group plus an Uncategorized catch-all.
 * Cards are sorted by `score` descending, columns are collapsible, and cards can
 * be dragged between columns (which rewrites the note's group tag).
 */
export function renderKanban(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  const groups = ctx.config.kanban?.groups ?? [];
  if (groups.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'This board has no kanban groups configured.' });
    return;
  }

  const columns = partitionKanban(items, groups);
  const board = host.createDiv({ cls: 'rb-kanban' });

  for (const column of columns) {
    renderColumn(board, column, groups, ctx);
  }
}

function renderColumn(
  board: HTMLElement,
  column: KanbanColumn,
  groups: string[],
  ctx: RenderContext,
): void {
  const collapsed = ctx.ui.kanbanCollapsed.has(column.label);
  const colEl = board.createDiv({ cls: 'rb-kanban-col' });
  if (collapsed) colEl.addClass('rb-collapsed');

  const header = colEl.createDiv({ cls: 'rb-kanban-header' });
  const caret = header.createSpan({ cls: 'rb-kanban-caret' });
  setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down');
  header.createSpan({ cls: 'rb-kanban-title', text: column.label });
  header.createSpan({ cls: 'rb-kanban-count', text: String(column.items.length) });
  header.onclick = () => {
    if (collapsed) ctx.ui.kanbanCollapsed.delete(column.label);
    else ctx.ui.kanbanCollapsed.add(column.label);
    ctx.refresh();
  };

  const list = colEl.createDiv({ cls: 'rb-kanban-list' });
  if (collapsed) return;

  for (const item of byScoreDesc(column.items)) {
    renderCard(list, item, ctx);
  }

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
    if (!path) return;
    void handleDrop(path, column, groups, ctx);
  });
}

function renderCard(list: HTMLElement, item: BoardItem, ctx: RenderContext): void {
  const cover = coverField(ctx.config);
  const fields = bodyFields(ctx.config);

  const card = list.createDiv({ cls: 'rb-card rb-kanban-card', attr: { draggable: 'true' } });
  card.dataset.path = item.file.path;

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', item.file.path);
    card.addClass('rb-dragging');
  });
  card.addEventListener('dragend', () => card.removeClass('rb-dragging'));

  if (cover) renderField(ctx.app, card, item, cover);

  const bodyEl = card.createDiv({ cls: 'rb-card-body' });
  createTitleLink(ctx.app, bodyEl, item);
  for (const field of fields) {
    const row = bodyEl.createDiv({ cls: 'rb-field' });
    if (!renderField(ctx.app, row, item, field)) row.remove();
  }
}

async function handleDrop(
  path: string,
  column: KanbanColumn,
  groups: string[],
  ctx: RenderContext,
): Promise<void> {
  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  try {
    await moveToGroup(ctx.app, file, groups, column.group);
    ctx.refresh();
  } catch (e) {
    new Notice(`R Board: could not move note — ${(e as Error).message}`);
  }
}
