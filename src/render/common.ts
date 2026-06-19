import type { App, TFile } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, ViewConfig } from '../types';
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
  /** Re-query and re-render the active view (e.g. after a kanban drag). */
  refresh: () => void;
  /** View-local UI state that survives re-renders (kept on the BoardView). */
  ui: BoardUiState;
}

/** Transient, per-view UI state (not persisted to disk). */
export interface BoardUiState {
  /** Group labels the user has collapsed (kanban columns / view sections). */
  collapsed: Set<string>;
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
    explicit.length > 0 ? explicit : properties.filter((p) => p.type === 'text' || p.type === 'multi');

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return searchProps.some((p) => fieldSearchText(item, p).includes(q));
  });
}
