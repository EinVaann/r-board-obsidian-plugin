import { setIcon, type App, type Component, type HoverParent, type TFile } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, SortSpec, ViewConfig } from '../types';
import { fieldSearchText } from './values';
import { openHoverEditor } from './hover';

/** Shared context passed to each view renderer. */
export interface RenderContext {
  app: App;
  config: DatabaseConfig;
  /** The view currently being rendered. */
  view: ViewConfig;
  /** Visible properties for this view, in order. */
  properties: PropertyConfig[];
  /** The `.board` file, used to anchor relative wikilink resolution. */
  boardFile: TFile;
  /** Component that owns any async markdown rendering (the BoardView). */
  component: Component;
  /** Hover-popover owner (the BoardView), for opening note previews/editors. */
  hoverParent: HoverParent;
  /** Effective sort for this view (already applied to the items list). */
  sort: SortSpec;
  /** Change the sort and persist it (used by table headers). */
  setSort: (sort: SortSpec) => void;
  /** Persist the current (mutated) view config to disk and re-render. */
  commit: () => void;
  /** Re-query and re-render the active view (e.g. after a kanban drag). */
  refresh: () => void;
  /** View-local UI state that survives re-renders (kept on the BoardView). */
  ui: BoardUiState;
}

/** Open a note via Obsidian's native navigation. */
export function openNote(app: App, item: BoardItem, newLeaf: boolean): void {
  void app.workspace.openLinkText(item.file.path, item.file.path, newLeaf);
}

/** Transient, per-view UI state (not persisted to disk). */
export interface BoardUiState {
  /** Group labels the user has collapsed (kanban columns / view sections). */
  collapsed: Set<string>;
  /** Last horizontal scroll of the kanban board, restored across re-renders. */
  kanbanScroll?: number;
  /** Revealed item count per paginated list (column/section), keyed stably. */
  pages: Record<string, number>;
  /** Vertical scroll of each kanban column list, keyed by column label. */
  listScroll: Record<string, number>;
}

/** Open a note in a new or existing leaf via Obsidian's native navigation. */
export function createTitleLink(
  app: App,
  parent: HTMLElement,
  item: BoardItem,
  cls = 'rb-title',
): HTMLElement {
  const link = parent.createEl('a', { cls, text: item.title, href: '#' });
  link.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    void app.workspace.openLinkText(item.file.path, item.file.path, e.ctrlKey || e.metaKey);
  };
  return link;
}

/**
 * Make `el` open the note's hover popover on Ctrl/Cmd-hover. With the Hover
 * Editor plugin the popover is editable, so the user can toggle checkboxes,
 * rename, and edit fields in place; edits flow back into the card via the
 * board's metadata listener.
 */
export function attachHoverEditor(ctx: RenderContext, el: HTMLElement, item: BoardItem): void {
  el.addEventListener('mouseover', (e) => {
    openHoverEditor(ctx.app, ctx.hoverParent, el, item.file, ctx.boardFile.path, e);
  });
}

/** A pencil button that always opens the note's (editable) hover popover. */
export function createEditButton(ctx: RenderContext, parent: HTMLElement, item: BoardItem): HTMLElement {
  const btn = parent.createEl('button', {
    cls: 'rb-card-edit',
    attr: { 'aria-label': 'Edit note' },
  });
  setIcon(btn, 'pencil');
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHoverEditor(ctx.app, ctx.hoverParent, btn, item.file, ctx.boardFile.path, e, true);
  };
  return btn;
}

/** CSS modifier class for a view's card size (defaults to medium). */
export function cardSizeClass(view: ViewConfig): string {
  return `rb-size-${view.cardSize ?? 'medium'}`;
}

/** The first visible image property, if any (drawn as the card cover). */
export function coverProperty(properties: PropertyConfig[]): PropertyConfig | undefined {
  return properties.find((p) => p.type === 'image');
}

/**
 * Visible non-image properties drawn as the card body, excluding `title`
 * (already shown as the title link).
 */
export function bodyProperties(properties: PropertyConfig[]): PropertyConfig[] {
  return properties.filter((p) => p.type !== 'image' && p.name !== 'title');
}

/**
 * Filter items by a search query: matches the title plus any `searchable`
 * property (or, if none opt in, all visible text/multi properties).
 */
export function filterBySearch(
  items: BoardItem[],
  properties: PropertyConfig[],
  query: string,
): BoardItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;

  const explicit = properties.filter((p) => p.searchable);
  const searchProps =
    explicit.length > 0
      ? explicit
      : properties.filter((p) => p.type === 'text' || p.type === 'multi' || p.type === 'links');

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return searchProps.some((p) => fieldSearchText(item, p).includes(q));
  });
}
