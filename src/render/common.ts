import type { App, TFile } from 'obsidian';
import type { BoardConfig, BoardItem, FieldConfig } from '../types';
import { fieldSearchText } from './values';

/** Shared context passed to each view renderer. */
export interface RenderContext {
  app: App;
  config: BoardConfig;
  /** The `.board` file, used to anchor relative wikilink resolution. */
  boardFile: TFile;
  /** Re-query and re-render the active view (e.g. after a kanban drag). */
  refresh: () => void;
  /** View-local UI state that survives re-renders (kept on the BoardView). */
  ui: BoardUiState;
}

/** Transient, per-view UI state (not persisted to disk). */
export interface BoardUiState {
  /** Kanban group labels the user has collapsed. */
  kanbanCollapsed: Set<string>;
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

/** The first image field declared in the config, if any. */
export function coverField(config: BoardConfig): FieldConfig | undefined {
  return config.fields.find((f) => f.type === 'image');
}

/** Non-image fields, in declared order (drawn as the card/table body). */
export function bodyFields(config: BoardConfig): FieldConfig[] {
  return config.fields.filter((f) => f.type !== 'image');
}

/**
 * Filter items by a search query. Matches against the title and any field
 * marked `searchable` (text/multi fields are searched by default if no field
 * opts in, to keep search useful out of the box).
 */
export function filterBySearch(items: BoardItem[], config: BoardConfig, query: string): BoardItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;

  const explicit = config.fields.filter((f) => f.searchable);
  const searchFields =
    explicit.length > 0 ? explicit : config.fields.filter((f) => f.type === 'text' || f.type === 'multi');

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return searchFields.some((f) => fieldSearchText(item, f).includes(q));
  });
}
