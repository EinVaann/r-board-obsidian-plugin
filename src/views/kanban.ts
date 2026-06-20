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

/** dataTransfer MIME marking a column-reorder drag (vs. a card drag). */
const COLUMN_MIME = 'application/x-rb-column';

/** Reorders the view's columns; persists and re-renders. */
type Reorder = (draggedKey: string, beforeKey: string | null) => void;

/**
 * Kanban board: one column per distinct value of the view's group property,
 * plus an Uncategorized column for notes missing it. Cards drag between columns
 * (rewriting the group property); columns can be reordered by dragging their
 * header; and a trailing "Add group" column creates a new (empty) column.
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

  // A horizontal scrollbar pinned to the TOP, kept in sync with the board's
  // own horizontal scroll (whose native scrollbar is hidden via CSS).
  const wrap = host.createDiv({ cls: 'rb-kanban-wrap' });
  const topbar = wrap.createDiv({ cls: 'rb-kanban-scrolltop' });
  const topInner = topbar.createDiv({ cls: 'rb-kanban-scrolltop-inner' });
  const board = wrap.createDiv({ cls: `rb-kanban ${cardSizeClass(ctx.view)}` });

  const columns = groupItems(items, groupProp, ctx.view.columns);
  const realKeys = columns.filter((c) => c.key !== null).map((c) => c.key as string);

  const reorder: Reorder = (draggedKey, beforeKey) => {
    const order = realKeys.filter((k) => k !== draggedKey);
    if (beforeKey === null) order.push(draggedKey);
    else {
      const to = order.indexOf(beforeKey);
      order.splice(to === -1 ? order.length : to, 0, draggedKey);
    }
    ctx.view.columns = order;
    ctx.commit();
  };

  for (const column of columns) renderColumn(board, column, groupProp, ctx, reorder);
  renderAddGroup(board, realKeys, ctx);

  wireTopScrollbar(topbar, topInner, board);
}

/** Mirror the board's horizontal scroll to a thin scrollbar above it. */
function wireTopScrollbar(topbar: HTMLElement, topInner: HTMLElement, board: HTMLElement): void {
  const sync = (): void => {
    topInner.style.width = `${board.scrollWidth}px`;
    topbar.toggleClass('rb-hidden', board.scrollWidth <= board.clientWidth + 1);
  };
  window.requestAnimationFrame(sync);

  let lock = false;
  topbar.addEventListener('scroll', () => {
    if (lock) return;
    lock = true;
    board.scrollLeft = topbar.scrollLeft;
    lock = false;
  });
  board.addEventListener('scroll', () => {
    if (lock) return;
    lock = true;
    topbar.scrollLeft = board.scrollLeft;
    lock = false;
  });
}

function renderColumn(
  board: HTMLElement,
  column: ItemGroup,
  groupProp: PropertyConfig,
  ctx: RenderContext,
  reorder: Reorder,
): void {
  const collapsed = ctx.ui.collapsed.has(column.label);
  const colEl = board.createDiv({ cls: 'rb-kanban-col' });
  if (collapsed) colEl.addClass('rb-collapsed');

  // Accept a dragged column header → reorder before this column.
  colEl.addEventListener('dragover', (e) => {
    if (!hasType(e, COLUMN_MIME)) return;
    e.preventDefault();
    colEl.addClass('rb-col-drop');
  });
  colEl.addEventListener('dragleave', () => colEl.removeClass('rb-col-drop'));
  colEl.addEventListener('drop', (e) => {
    if (!hasType(e, COLUMN_MIME)) return;
    e.preventDefault();
    colEl.removeClass('rb-col-drop');
    const dragged = e.dataTransfer?.getData(COLUMN_MIME);
    if (dragged && dragged !== column.key) reorder(dragged, column.key);
  });

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

  // Real columns (not Uncategorized) are draggable by their header to reorder.
  if (column.key !== null) {
    header.addClass('rb-draggable');
    header.setAttr('draggable', 'true');
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(COLUMN_MIME, column.key as string);
      e.dataTransfer!.effectAllowed = 'move';
      colEl.addClass('rb-col-dragging');
    });
    header.addEventListener('dragend', () => colEl.removeClass('rb-col-dragging'));
  }

  const list = colEl.createDiv({ cls: 'rb-kanban-list' });
  if (collapsed) return;

  if (column.items.length === 0) {
    // A roomy placeholder so the drop target is easy to hit on empty groups.
    list.createDiv({ cls: 'rb-kanban-empty-drop', text: 'Drop cards here' });
  } else {
    renderPaged(list, column.items, ctx.view.limit ?? 50, (item, host) =>
      renderCard(host, item, ctx),
    );
  }

  // Card drop zone (ignores column-reorder drags, which the column handles).
  list.addEventListener('dragover', (e) => {
    if (hasType(e, COLUMN_MIME)) return;
    e.preventDefault();
    list.addClass('rb-drop-active');
  });
  list.addEventListener('dragleave', () => list.removeClass('rb-drop-active'));
  list.addEventListener('drop', (e) => {
    list.removeClass('rb-drop-active');
    if (hasType(e, COLUMN_MIME)) return;
    e.preventDefault();
    const path = e.dataTransfer?.getData('text/plain');
    if (path) void handleDrop(path, column, groupProp, ctx);
  });
}

/** Trailing column with a button (then inline input) to add a new group. */
function renderAddGroup(board: HTMLElement, realKeys: string[], ctx: RenderContext): void {
  const col = board.createDiv({ cls: 'rb-kanban-col rb-kanban-add' });
  const btn = col.createDiv({ cls: 'rb-kanban-add-btn' });
  setIcon(btn.createSpan({ cls: 'rb-kanban-add-icon' }), 'plus');
  btn.createSpan({ text: 'Add group' });

  btn.onclick = () => {
    col.empty();
    const input = col.createEl('input', {
      cls: 'rb-kanban-add-input',
      attr: { type: 'text', placeholder: 'Group name…' },
    });
    input.focus();

    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && !realKeys.includes(name)) {
        const cols = ctx.view.columns ? [...ctx.view.columns] : [...realKeys];
        if (!cols.includes(name)) cols.push(name);
        ctx.view.columns = cols;
        ctx.commit();
      } else {
        ctx.refresh();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };
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

/** Whether a drag event carries the given data type. */
function hasType(e: DragEvent, type: string): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(type);
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
