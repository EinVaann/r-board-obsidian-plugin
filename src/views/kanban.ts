import { Notice, TFile, setIcon } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { groupItems, type ItemGroup } from '../data/group';
import { setProperty } from '../data/properties';
import { renderField } from '../render/fields';
import {
  bodyProperties,
  cardSizeClass,
  coverProperty,
  createTitleLink,
  openNote,
  type RenderContext,
} from '../render/common';
import { renderPaged } from '../render/paginate';
import { renderNoteExcerpt } from '../render/content';

/**
 * Kanban board: one column per distinct value of the view's group property,
 * plus an Uncategorized column for notes missing it. Cards are dragged between
 * columns (which rewrites the group property), and clicking a card opens the
 * note. Items arrive already sorted by the view's sort.
 */
export function renderKanban(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();

  const groupProp = ctx.view.group
    ? ctx.config.properties.find((p) => p.name === ctx.view.group)
    : undefined;
  if (!groupProp) {
    host.createDiv({
      cls: 'rb-empty',
      text: 'This kanban view needs a "group" property to use as columns. Open view settings to set one.',
    });
    return;
  }

  const board = host.createDiv({ cls: `rb-kanban ${cardSizeClass(ctx.view)}` });
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

  renderPaged(list, column.items, ctx.view.limit ?? 50, (item, host) =>
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
  card.onclick = (e) => openNote(ctx.app, item, e.ctrlKey || e.metaKey);

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', item.file.path);
    e.dataTransfer!.effectAllowed = 'move';
    // Drag a styled clone of the card (not just the highlight outline).
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.addClass('rb-drag-ghost');
    ghost.style.width = `${card.offsetWidth}px`;
    document.body.appendChild(ghost);
    e.dataTransfer?.setDragImage(ghost, e.offsetX, e.offsetY);
    window.setTimeout(() => ghost.remove(), 0);
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
  if (ctx.view.showContent) {
    const content = body.createDiv({ cls: 'rb-card-content' });
    void renderNoteExcerpt(ctx.app, content, item.file, ctx.component);
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
