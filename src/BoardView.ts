import { Menu, TextFileView, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import type RBoardPlugin from '../main';
import type { BoardItem, DatabaseConfig, SortSpec, ViewConfig, ViewType } from './types';
import {
  effectiveSort,
  makeDefaultView,
  parseDatabaseConfig,
  propertyLabel,
  serializeDatabase,
  TITLE_SORT_KEY,
  visibleProperties,
} from './config';
import { queryItems } from './data/query';
import { applyFilter } from './data/filter';
import { filterBySearch, openNote, type BoardUiState, type RenderContext } from './render/common';
import { applySort } from './render/sort';
import { renderGallery } from './views/gallery';
import { renderKanban } from './views/kanban';
import { renderTable } from './views/table';
import { WizardModal } from './ui/WizardModal';
import { DatabaseSettingsModal } from './ui/DatabaseSettingsModal';
import { ViewSettingsModal } from './ui/ViewSettingsModal';
import { FilterModal } from './ui/FilterModal';

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

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    const result = parseDatabaseConfig(data);
    if (result.ok) {
      this.config = result.config;
      this.parseError = null;
      const saved = this.file ? this.plugin.getActiveView(this.file.path) : undefined;
      const exists = saved && this.config.views.some((v) => v.name === saved);
      this.activeView = exists
        ? (saved as string)
        : this.config.defaultView ?? this.config.views[0]?.name ?? '';
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
    const refresh = debounce(() => this.renderBody(), 250, true);
    this.registerEvent(this.app.metadataCache.on('resolved', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
  }

  // --- Config persistence ----------------------------------------------------

  /** Write a new config to the `.board` file and re-render. */
  private async writeConfig(config: DatabaseConfig): Promise<void> {
    const json = serializeDatabase(config);
    this.data = json;
    if (this.file) await this.app.vault.modify(this.file, json);
    this.setViewData(json, false);
  }

  private async writeView(view: ViewConfig): Promise<void> {
    if (!this.config) return;
    const views = this.config.views.map((v) => (v.name === this.activeView ? view : v));
    this.activeView = view.name;
    if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
    await this.writeConfig({ ...this.config, views });
  }

  private async deleteActiveView(): Promise<void> {
    if (!this.config) return;
    const views = this.config.views.filter((v) => v.name !== this.activeView);
    this.activeView = views[0]?.name ?? '';
    await this.writeConfig({ ...this.config, views, defaultView: views[0]?.name });
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

    if (!this.config) {
      this.renderSetup(root);
      return;
    }

    this.renderToolbar(root);
    this.bodyEl = root.createDiv({ cls: 'rb-body' });

    if (this.config.views.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'rb-empty rb-empty-views' });
      empty.createDiv({ text: 'This board has no views yet.' });
      const btn = empty.createEl('button', { cls: 'rb-view-more', text: 'Create view' });
      btn.onclick = (e) => this.openCreateViewMenu(e);
      return;
    }

    this.renderBody();
  }

  /** Setup prompt shown when the `.board` file is empty or unparseable. */
  private renderSetup(root: HTMLElement): void {
    const box = root.createDiv({ cls: 'rb-setup' });
    setIcon(box.createDiv({ cls: 'rb-setup-icon' }), 'layout-dashboard');
    box.createEl('h3', { text: 'Set up this board' });
    if (this.parseError && this.data.trim() !== '' && this.data.trim() !== '{}') {
      box.createEl('p', { cls: 'rb-setup-error', text: this.parseError });
    }
    const btn = box.createEl('button', { cls: 'rb-home-create', text: 'Configure board' });
    btn.onclick = () => {
      new WizardModal(this.app, {}, 'Set up board', (config) => void this.writeConfig(config)).open();
    };
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

    // View tabs.
    const tabs = bar.createDiv({ cls: 'rb-view-switch' });
    for (const view of this.config?.views ?? []) {
      const btn = tabs.createEl('button', {
        cls: view.name === this.activeView ? 'rb-view-btn rb-active' : 'rb-view-btn',
        attr: { title: `${view.name} (${view.type})` },
      });
      setIcon(btn.createSpan({ cls: 'rb-view-btn-icon' }), TYPE_ICON[view.type]);
      btn.createSpan({ text: view.name });
      btn.onclick = () => this.setActiveView(view.name);
    }
    const addBtn = tabs.createEl('button', { cls: 'rb-view-btn rb-view-add', attr: { title: 'Create view' } });
    setIcon(addBtn.createSpan({ cls: 'rb-view-btn-icon' }), 'plus');
    addBtn.onclick = (e) => this.openCreateViewMenu(e);

    // Right-aligned tools (only meaningful with an active view).
    const tools = bar.createDiv({ cls: 'rb-tools' });
    const view = this.currentView();
    if (view) {
      this.toolButton(tools, 'arrow-up-down', 'Sort', (e) => this.openSortMenu(e));
      this.toolButton(tools, 'filter', 'Filter', () => this.openFilter());
      this.toolButton(tools, 'sliders-horizontal', 'View settings', () => this.openViewSettings());
    }
    this.toolButton(tools, 'settings', 'Board settings', () => this.openBoardSettings());
  }

  private toolButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void): void {
    const btn = parent.createEl('button', { cls: 'rb-tool-btn', attr: { 'aria-label': label, title: label } });
    setIcon(btn, icon);
    btn.onclick = onClick;
  }

  // --- Toolbar actions -------------------------------------------------------

  private openCreateViewMenu(e: MouseEvent): void {
    if (!this.config) return;
    const menu = new Menu();
    (['gallery', 'kanban', 'table'] as ViewType[]).forEach((type) => {
      menu.addItem((item) =>
        item.setTitle(`New ${type} view`).setIcon(TYPE_ICON[type]).onClick(() => {
          const view = makeDefaultView(type, this.config!.views);
          void this.writeConfig({ ...this.config!, views: [...this.config!.views, view] }).then(() => {
            this.setActiveView(view.name);
            this.openViewSettings();
          });
        }),
      );
    });
    menu.showAtMouseEvent(e);
  }

  private openSortMenu(e: MouseEvent): void {
    const view = this.currentView();
    if (!this.config || !view) return;
    const current = effectiveSort(view);
    const menu = new Menu();

    const addItem = (key: string, label: string): void => {
      menu.addItem((item) => {
        item.setTitle(label);
        if (current.property === key) item.setIcon(current.dir === 'asc' ? 'arrow-up' : 'arrow-down');
        item.onClick(() => {
          const dir = current.property === key && current.dir === 'asc' ? 'desc' : 'asc';
          void this.writeView({ ...view, sort: { property: key, dir } });
        });
      });
    };

    addItem(TITLE_SORT_KEY, 'Title');
    for (const p of this.config.properties) addItem(p.name, propertyLabel(p));
    menu.showAtMouseEvent(e);
  }

  private openFilter(): void {
    const view = this.currentView();
    if (!this.config || !view) return;
    new FilterModal(this.app, view.filter ?? [], this.config.properties, (rules) => {
      void this.writeView({ ...view, filter: rules.length ? rules : undefined });
    }).open();
  }

  private openViewSettings(): void {
    const view = this.currentView();
    if (!this.config || !view) return;
    new ViewSettingsModal(
      this.app,
      view,
      this.config,
      (updated) => void this.writeView(updated),
      () => void this.deleteActiveView(),
    ).open();
  }

  private openBoardSettings(): void {
    if (!this.config) return;
    new DatabaseSettingsModal(this.app, this.config, (updated) => void this.writeConfig(updated)).open();
  }

  // --- Body ------------------------------------------------------------------

  /** Re-query the vault and draw the active view into the body. */
  private renderBody(): void {
    const body = this.bodyEl;
    const view = this.currentView();
    if (!body || !this.config || !view) return;
    body.empty();

    const properties = visibleProperties(this.config, view);
    const sort = effectiveSort(view);

    let items: BoardItem[] = queryItems(this.app, this.config);
    items = applyFilter(items, view.filter, this.config.properties);
    items = filterBySearch(items, properties, this.searchQuery);
    items = applySort(items, sort, this.config.properties);

    const ctx: RenderContext = {
      app: this.app,
      config: this.config,
      view,
      properties,
      boardFile: this.file!,
      component: this,
      sort,
      setSort: (s: SortSpec) => void this.writeView({ ...view, sort: s }),
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
