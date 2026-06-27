import { setIcon, type App, type Component, type TFile } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, SortSpec, ViewConfig } from '../types';
import { fieldSearchText } from './values';

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
  /** Open the in-place edit modal for an item (re-renders the view on close). */
  editItem: (item: BoardItem) => void;
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

/**
 * The clickable title. A plain click opens the in-place edit modal; a
 * Ctrl/Cmd-click opens the note in a new tab (power-user shortcut).
 */
export function createTitleLink(
  ctx: RenderContext,
  parent: HTMLElement,
  item: BoardItem,
  cls = 'rb-title',
): HTMLElement {
  const link = parent.createEl('a', { cls, text: item.title, href: '#' });
  link.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) openNote(ctx.app, item, true);
    else ctx.editItem(item);
  };
  return link;
}

/**
 * Render a collapsible group/section header (gallery & table). Toggles the
 * group's collapsed state (keyed by `label`, shared with kanban columns) and
 * re-renders. Returns whether the group is currently collapsed, so the caller
 * can skip drawing the body.
 */
export function renderSectionHeader(
  ctx: RenderContext,
  section: HTMLElement,
  label: string,
  count: number,
): boolean {
  const collapsed = ctx.ui.collapsed.has(label);
  const header = section.createDiv({ cls: 'rb-section-header' });
  const caret = header.createSpan({ cls: 'rb-section-caret' });
  setIcon(caret, collapsed ? 'chevron-right' : 'chevron-down');
  header.createSpan({ cls: 'rb-section-title', text: label });
  header.createSpan({ cls: 'rb-section-count', text: String(count) });
  header.onclick = () => {
    if (collapsed) ctx.ui.collapsed.delete(label);
    else ctx.ui.collapsed.add(label);
    ctx.refresh();
  };
  return collapsed;
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
