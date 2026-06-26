import { Menu, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';
import { groupItems, groupValueOf, type ItemGroup } from '../data/group';
import { setProperty } from '../data/properties';
import { renderField } from '../render/fields';
import {
  attachHoverEditor,
  bodyProperties,
  cardSizeClass,
  coverProperty,
  createEditButton,
  createTitleLink,
  openNote,
  type RenderContext,
} from '../render/common';
import { renderPaged } from '../render/paginate';
import { renderNoteExcerpt } from '../render/content';

/** dataTransfer MIME marking a column-reorder drag (vs. a card drag). */
const COLUMN_MIME = 'application/x-rb-column';
/** Console prefix for move diagnostics. */
const MLOG = '[R Board move]';

/** Reorders the view's columns; persists and re-renders. */
type Reorder = (draggedKey: string, beforeKey: string | null) => void;

/** A column the "Move to group" menu can send a card to. */
interface ColumnTarget {
  key: string | null;
  label: string;
}

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

  const columns = groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig);
  const realKeys = columns.filter((c) => c.key !== null).map((c) => c.key as string);
  // Destinations offered by the card's "Move to group" menu.
  const targets: ColumnTarget[] = columns.map((c) => ({ key: c.key, label: c.label }));

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

  for (const column of columns) renderColumn(board, column, groupProp, ctx, reorder, targets);
  renderAddGroup(board, realKeys, ctx);

  wireTopScrollbar(topbar, topInner, board, ctx);
}

/** Mirror the board's horizontal scroll to a thin scrollbar above it, and
 *  preserve the scroll position across re-renders (e.g. after moving a card). */
function wireTopScrollbar(
  topbar: HTMLElement,
  topInner: HTMLElement,
  board: HTMLElement,
  ctx: RenderContext,
): void {
  const sync = (): void => {
    topInner.style.width = `${board.scrollWidth}px`;
    topbar.toggleClass('rb-hidden', board.scrollWidth <= board.clientWidth + 1);
    // Restore the scroll position saved before the last re-render.
    const saved = ctx.ui.kanbanScroll ?? 0;
    if (saved) {
      board.scrollLeft = saved;
      topbar.scrollLeft = saved;
    }
  };
  window.requestAnimationFrame(sync);

  let lock = false;
  topbar.addEventListener('scroll', () => {
    ctx.ui.kanbanScroll = topbar.scrollLeft;
    if (lock) return;
    lock = true;
    board.scrollLeft = topbar.scrollLeft;
    lock = false;
  });
  board.addEventListener('scroll', () => {
    ctx.ui.kanbanScroll = board.scrollLeft;
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
  targets: ColumnTarget[],
): void {
  const collapsed = ctx.ui.collapsed.has(column.label);
  const colEl = board.createDiv({ cls: 'rb-kanban-col' });
  if (collapsed) colEl.addClass('rb-collapsed');

  // Accept a dragged column header → reorder before this column (desktop only).
  if (!Platform.isMobile) {
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
  }

  const header = colEl.createDiv({ cls: 'rb-kanban-header' });
  const caret = header.createSpan({ cls: 'rb-kanban-caret' });
  setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down');
  const titleSpan = header.createSpan({ cls: 'rb-kanban-title', text: column.label });
  const colCfg = column.key !== null ? ctx.view.groupConfig?.[column.key] : undefined;
  if (colCfg?.color) titleSpan.style.color = colCfg.color;
  header.createSpan({ cls: 'rb-kanban-count', text: String(column.items.length) });
  header.onclick = () => {
    if (collapsed) ctx.ui.collapsed.delete(column.label);
    else ctx.ui.collapsed.add(column.label);
    ctx.refresh();
  };

  // Real columns (not Uncategorized) are draggable by their header to reorder (desktop only).
  if (!Platform.isMobile && column.key !== null) {
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

  // Preserve this column's vertical scroll across re-renders.
  const scrollKey = column.label;
  list.addEventListener('scroll', () => {
    ctx.ui.listScroll[scrollKey] = list.scrollTop;
  });

  if (column.items.length === 0) {
    // A roomy placeholder so the drop target is easy to hit on empty groups.
    list.createDiv({ cls: 'rb-kanban-empty-drop', text: 'Drop cards here' });
  } else {
    renderPaged(
      list,
      column.items,
      ctx.view.limit ?? 50,
      (item, host) => renderCard(host, item, ctx, groupProp, targets),
      { key: `k:${column.label}`, store: ctx.ui.pages },
    );
  }

  // Restore the saved vertical scroll after layout.
  const savedTop = ctx.ui.listScroll[scrollKey];
  if (savedTop) window.requestAnimationFrame(() => { list.scrollTop = savedTop; });

  // Card drop zone — desktop only.
  if (!Platform.isMobile) {
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

function renderCard(
  list: HTMLElement,
  item: BoardItem,
  ctx: RenderContext,
  groupProp: PropertyConfig,
  targets: ColumnTarget[],
): void {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);

  const card = list.createDiv({ cls: 'rb-card rb-kanban-card' });
  if (!Platform.isMobile) card.setAttr('draggable', 'true');
  card.dataset.path = item.file.path;
  card.onclick = (e) => openNote(ctx.app, item, e.ctrlKey || e.metaKey);
  card.oncontextmenu = (e) => {
    e.preventDefault();
    openCardMenu(e, item, groupProp, targets, ctx);
  };
  attachHoverEditor(ctx, card, item);

  // Floating overlay actions (top-right): edit + "⋯" menu.
  createEditButton(ctx, card, item);
  const menuBtn = card.createEl('button', { cls: 'rb-card-menu', attr: { 'aria-label': 'Card actions' } });
  setIcon(menuBtn, 'more-horizontal');
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    openCardMenu(e, item, groupProp, targets, ctx);
  };

  if (!Platform.isMobile) {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', item.file.path);
      e.dataTransfer!.effectAllowed = 'move';
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.addClass('rb-drag-ghost');
      ghost.style.width = `${card.offsetWidth}px`;
      document.body.appendChild(ghost);
      e.dataTransfer?.setDragImage(ghost, e.offsetX, e.offsetY);
      window.setTimeout(() => ghost.remove(), 0);
      card.addClass('rb-dragging');
    });
    card.addEventListener('dragend', () => card.removeClass('rb-dragging'));
  }

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

/** Context menu for a card: a "Move to group" submenu of every column. */
function openCardMenu(
  e: MouseEvent,
  item: BoardItem,
  groupProp: PropertyConfig,
  targets: ColumnTarget[],
  ctx: RenderContext,
): void {
  const current = groupValueOf(item, groupProp);
  const menu = new Menu();

  menu.addItem((it) => {
    it.setTitle('Move to group').setIcon('arrow-right-circle');
    // setSubmenu() exists at runtime (Obsidian 1.4+) but isn't in the bundled types.
    const sub = (it as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const t of targets) {
      sub.addItem((si) => {
        si.setTitle(t.label);
        if ((t.key ?? null) === (current ?? null)) si.setChecked(true);
        si.onClick(() => void moveCardToGroup(item, t.key, groupProp, ctx));
      });
    }
  });

  menu.addSeparator();
  menu.addItem((it) =>
    it.setTitle('Open note').setIcon('file-text').onClick(() => openNote(ctx.app, item, false)),
  );

  menu.showAtMouseEvent(e);
}

/** Write the group property on a card's note and refresh. */
async function moveCardToGroup(
  item: BoardItem,
  targetKey: string | null,
  groupProp: PropertyConfig,
  ctx: RenderContext,
): Promise<void> {
  await moveItemToGroup(item.file, targetKey, groupProp, ctx);
}

/**
 * Write the group property, wait for Obsidian's metadata cache to reflect the
 * change (so the re-render reads fresh data, not the pre-write cache), then
 * re-render. The kanban scroll position is preserved across the re-render.
 */
async function moveItemToGroup(
  file: TFile,
  targetKey: string | null,
  groupProp: PropertyConfig,
  ctx: RenderContext,
): Promise<void> {
  const key = groupProp.name;
  const before = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
  console.log(
    `${MLOG} move: "${file.path}" → ${targetKey === null ? '(Uncategorized)' : `"${targetKey}"`}` +
      ` | prop="${key}" type=${groupProp.type} | before=${JSON.stringify(before)}`,
  );
  try {
    await setProperty(ctx.app, file, groupProp, targetKey);
    const afterWrite = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
    console.log(`${MLOG} wrote frontmatter; cache value right after write = ${JSON.stringify(afterWrite)}`);
    await waitForFrontmatter(ctx, file, key, targetKey);
  } catch (e) {
    console.error(`${MLOG} FAILED for "${file.path}":`, e);
    new Notice(`R Board: could not move note — ${(e as Error).message}`);
    return;
  }
  const after = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
  // What grouping will compute for this note now, and which column it expects.
  const computed = groupValueOf({ file, frontmatter: ctx.app.metadataCache.getFileCache(file)?.frontmatter ?? {} } as BoardItem, groupProp);
  const inView = ctx.config.properties.some((p) => p.name === ctx.view.group);
  console.log(
    `${MLOG} done: "${file.basename}" final value=${JSON.stringify(after)}` +
      ` | groupValueOf="${computed}" expected="${targetKey}"` +
      ` | view.group="${ctx.view.group}" groupPropInConfig=${inView} matches=${(computed ?? null) === (targetKey ?? null)}`,
  );
  ctx.refresh();
  // After the synchronous re-render, report which column the card landed in.
  window.requestAnimationFrame(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.rb-kanban-card'));
    const el = cards.find((c) => c.dataset.path === file.path);
    const col = el?.closest('.rb-kanban-col')?.querySelector('.rb-kanban-title')?.textContent;
    console.log(`${MLOG} after re-render: card ${el ? `in column "${col}"` : 'NOT FOUND in DOM (filtered out / not visible?)'}`);
  });
}

/** Resolve once the file's cached frontmatter shows `expected` for `key`. */
function waitForFrontmatter(
  ctx: RenderContext,
  file: TFile,
  key: string,
  expected: string | null,
): Promise<void> {
  const matches = (): boolean => {
    const v = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
    if (expected === null) return v === undefined || v === null || v === '';
    if (Array.isArray(v)) return v.map(String).includes(String(expected));
    return String(v) === String(expected);
  };

  return new Promise((resolve) => {
    if (matches()) {
      console.log(`${MLOG} waitForFrontmatter: matched immediately`);
      return resolve();
    }
    const ref = ctx.app.metadataCache.on('changed', (f) => {
      if (f.path === file.path && matches()) {
        console.log(`${MLOG} waitForFrontmatter: matched via 'changed' event`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve();
      }
    });
    // Fallback poll in case the 'changed' event already fired (cap ~1.5s).
    let tries = 0;
    const timer = window.setInterval(() => {
      if (matches()) {
        console.log(`${MLOG} waitForFrontmatter: matched via poll after ${tries * 50}ms`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve();
      } else if (++tries > 30) {
        const v = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
        console.warn(`${MLOG} waitForFrontmatter: TIMED OUT after 1.5s; cache value=${JSON.stringify(v)}, expected=${JSON.stringify(expected)}`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });
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
  await moveItemToGroup(file, column.key, groupProp, ctx);
}
