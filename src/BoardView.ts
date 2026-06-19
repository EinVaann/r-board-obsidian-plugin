import { TextFileView, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import type RBoardPlugin from '../main';
import type { BoardItem, DatabaseConfig, ViewConfig, ViewType } from './types';
import { parseDatabaseConfig, visibleProperties } from './config';
import { queryItems } from './data/query';
import { applyFilter } from './data/filter';
import { filterBySearch, type BoardUiState, type RenderContext } from './render/common';
import { renderGallery } from './views/gallery';
import { renderKanban } from './views/kanban';
import { renderTable } from './views/table';

export const BOARD_VIEW_TYPE = 'r-board-view';
/** File extension that opens as a database board (JSON content, like `.canvas`). */
export const BOARD_EXTENSION = 'board';

const TYPE_ICON: Record<ViewType, string> = {
  gallery: 'layout-grid',
  kanban: 'columns-3',
  table: 'table',
};

/** A board pane: parses a `.board` database config and renders the active view. */
export class BoardView extends TextFileView {
  plugin: RBoardPlugin;

  private config: DatabaseConfig | null = null;
  private parseError: string | null = null;
  private activeView = '';
  private searchQuery = '';
  private ui: BoardUiState = { collapsed: new Set() };

  private bodyEl: HTMLElement | null = null;

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
    const result = parseDatabaseConfig(data);
    if (result.ok) {
      this.config = result.config;
      this.parseError = null;
      // Restore the saved view for this database, else its default.
      const saved = this.file ? this.plugin.getActiveView(this.file.path) : undefined;
      const exists = saved && this.config.views.some((v) => v.name === saved);
      this.activeView = exists ? (saved as string) : this.config.defaultView ?? this.config.views[0].name;
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

  private currentView(): ViewConfig | null {
    if (!this.config) return null;
    return this.config.views.find((v) => v.name === this.activeView) ?? this.config.views[0] ?? null;
  }

  private setActiveView(name: string): void {
    if (this.activeView === name) return;
    this.activeView = name;
    this.ui.collapsed.clear();
    if (this.file) void this.plugin.setActiveView(this.file.path, name);
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('rb-root');

    if (this.parseError) {
      const err = root.createDiv({ cls: 'rb-error' });
      err.createEl('h3', { text: 'Invalid database config' });
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

    bar.createDiv({
      cls: 'rb-toolbar-title',
      text: this.config?.name ?? this.file?.basename ?? 'Board',
    });

    const search = bar.createEl('input', {
      cls: 'rb-search',
      attr: { type: 'search', placeholder: 'Search…' },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderBody();
    };

    // One tab per saved view.
    const tabs = bar.createDiv({ cls: 'rb-view-switch' });
    for (const view of this.config?.views ?? []) {
      const btn = tabs.createEl('button', {
        cls: view.name === this.activeView ? 'rb-view-btn rb-active' : 'rb-view-btn',
        attr: { title: `${view.name} (${view.type})` },
      });
      const ic = btn.createSpan({ cls: 'rb-view-btn-icon' });
      setIcon(ic, TYPE_ICON[view.type]);
      btn.createSpan({ text: view.name });
      btn.onclick = () => this.setActiveView(view.name);
    }
  }

  /** Re-query the vault and draw the active view into the body. */
  private renderBody(): void {
    const body = this.bodyEl;
    const view = this.currentView();
    if (!body || !this.config || !view) return;
    body.empty();

    const properties = visibleProperties(this.config, view);

    let items: BoardItem[] = queryItems(this.app, this.config);
    items = applyFilter(items, view.filter, this.config.properties);
    items = filterBySearch(items, properties, this.searchQuery);

    const ctx: RenderContext = {
      app: this.app,
      config: this.config,
      view,
      properties,
      boardFile: this.file!,
      refresh: () => this.renderBody(),
      ui: this.ui,
    };

    switch (view.type) {
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
