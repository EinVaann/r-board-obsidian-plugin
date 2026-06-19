import { TextFileView, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import type RBoardPlugin from '../main';
import type { BoardConfig, BoardItem, ViewMode } from './types';
import { parseBoardConfig } from './config';
import { queryItems } from './data/query';
import { filterBySearch, type BoardUiState, type RenderContext } from './render/common';
import { renderGallery } from './views/gallery';
import { renderKanban } from './views/kanban';
import { renderTable } from './views/table';

export const BOARD_VIEW_TYPE = 'r-board-view';
/** File extension that opens as a board (a JSON document, like `.canvas`). */
export const BOARD_EXTENSION = 'board';

const VIEW_LABELS: Record<ViewMode, { label: string; icon: string }> = {
  gallery: { label: 'Gallery', icon: 'layout-grid' },
  kanban: { label: 'Kanban', icon: 'columns-3' },
  table: { label: 'Table', icon: 'table' },
};

/** A board pane: parses a `.board` config file and renders the active view. */
export class BoardView extends TextFileView {
  plugin: RBoardPlugin;

  private config: BoardConfig | null = null;
  private parseError: string | null = null;
  private mode: ViewMode = 'gallery';
  private searchQuery = '';
  private ui: BoardUiState = { kanbanCollapsed: new Set() };

  private bodyEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return BOARD_VIEW_TYPE;
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  getDisplayText(): string {
    return this.config?.name ?? this.file?.basename ?? 'Board';
  }

  // --- TextFileView contract -------------------------------------------------

  /** The `.board` file is config we display, not edit; hand back the raw text. */
  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    const result = parseBoardConfig(data);
    if (result.ok) {
      this.config = result.config;
      this.parseError = null;
      // Restore the saved view for this board, else fall back to its default.
      const saved = this.file ? this.plugin.getBoardView(this.file.path) : undefined;
      this.mode = saved ?? this.config.defaultView ?? 'gallery';
    } else {
      this.config = null;
      this.parseError = result.error;
    }
    this.render();
  }

  clear(): void {
    this.config = null;
    this.parseError = null;
    this.contentEl.empty();
  }

  // --- Lifecycle -------------------------------------------------------------

  async onOpen(): Promise<void> {
    this.contentEl.addClass('rb-root');
    // Live-refresh the body when vault metadata changes (notes added/edited).
    const refresh = debounce(() => this.renderBody(), 250, true);
    this.registerEvent(this.app.metadataCache.on('resolved', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
  }

  // --- Rendering -------------------------------------------------------------

  private setMode(mode: ViewMode): void {
    this.mode = mode;
    if (this.file) void this.plugin.setBoardView(this.file.path, mode);
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('rb-root');

    if (this.parseError) {
      const err = root.createDiv({ cls: 'rb-error' });
      err.createEl('h3', { text: 'Invalid board config' });
      err.createEl('p', { text: this.parseError });
      return;
    }
    if (!this.config) return;

    this.renderToolbar(root);
    this.bodyEl = root.createDiv({ cls: 'rb-body' });
    this.renderBody();
  }

  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'rb-toolbar' });
    this.toolbarEl = bar;

    bar.createDiv({ cls: 'rb-toolbar-title', text: this.config?.name ?? this.file?.basename ?? 'Board' });

    const search = bar.createEl('input', {
      cls: 'rb-search',
      attr: { type: 'search', placeholder: 'Search…' },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderBody();
    };

    const switcher = bar.createDiv({ cls: 'rb-view-switch' });
    const modes: ViewMode[] = ['gallery', 'kanban', 'table'];
    for (const mode of modes) {
      const { label, icon } = VIEW_LABELS[mode];
      const btn = switcher.createEl('button', {
        cls: mode === this.mode ? 'rb-view-btn rb-active' : 'rb-view-btn',
        attr: { 'aria-label': label, title: label },
      });
      const ic = btn.createSpan({ cls: 'rb-view-btn-icon' });
      setIcon(ic, icon);
      btn.createSpan({ text: label });
      btn.onclick = () => this.setMode(mode);
    }
  }

  /** Re-query the vault and draw the active view into the body. */
  private renderBody(): void {
    const body = this.bodyEl;
    if (!body || !this.config) return;
    body.empty();

    const all = queryItems(this.app, this.config);
    const items: BoardItem[] = filterBySearch(all, this.config, this.searchQuery);

    const ctx: RenderContext = {
      app: this.app,
      config: this.config,
      boardFile: this.file!,
      refresh: () => this.renderBody(),
      ui: this.ui,
    };

    switch (this.mode) {
      case 'kanban':
        renderKanban(body, items, ctx);
        break;
      case 'table':
        renderTable(body, items, ctx);
        break;
      case 'gallery':
      default:
        renderGallery(body, items, ctx);
        break;
    }
  }
}
