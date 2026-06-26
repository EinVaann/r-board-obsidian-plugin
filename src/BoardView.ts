import { Menu, Notice, TFolder, TextFileView, WorkspaceLeaf, debounce, normalizePath, setIcon } from 'obsidian';
import { NoteEditModal } from './ui/NoteEditModal';
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
import { applyFilter, countFilterRules } from './data/filter';
import { filterBySearch, openNote, type BoardUiState, type RenderContext } from './render/common';
import { applySort } from './render/sort';
import { renderGallery } from './views/gallery';
import { renderKanban } from './views/kanban';
import { renderTable } from './views/table';
import { WizardModal } from './ui/WizardModal';
import { FilterModal } from './ui/FilterModal';
import { renderDatabaseSettings, renderViewSettings } from './ui/SettingsForms';

export const BOARD_VIEW_TYPE = 'r-board-view';
/** File extension that opens as a database board (JSON content, like `.canvas`). */
export const BOARD_EXTENSION = 'board';

const TYPE_ICON: Record<ViewType, string> = {
  gallery: 'layout-grid',
  kanban: 'columns-3',
  table: 'table',
};

type SidebarMode = 'view' | 'board' | null;

/** A board pane: parses a `.board` database config and renders the active view. */
export class BoardView extends TextFileView {
  plugin: RBoardPlugin;

  /** While an edit modal is open, suppress re-renders until it closes. */
  private renderSuspended = false;

  private config: DatabaseConfig | null = null;
  private parseError: string | null = null;
  private activeView = '';
  private searchQuery = '';
  private sidebar: SidebarMode = null;
  private ui: BoardUiState = { collapsed: new Set(), pages: {}, listScroll: {} };

  private bodyEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;

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

  /**
   * Persist the current in-memory config to the `.board` file without forcing a
   * full reload (so the sidebar keeps focus). Refreshes body + toolbar.
   */
  private saveConfig(): void {
    if (!this.config) return;
    this.data = serializeDatabase(this.config);
    this.requestSave();
    this.renderToolbar();
    this.renderBody();
  }

  private currentView(): ViewConfig | null {
    if (!this.config) return null;
    return this.config.views.find((v) => v.name === this.activeView) ?? this.config.views[0] ?? null;
  }

  private setActiveView(name: string): void {
    if (this.activeView === name) return;
    this.activeView = name;
    this.ui.collapsed.clear();
    this.ui.pages = {};
    this.ui.listScroll = {};
    this.ui.kanbanScroll = 0;
    if (this.file) void this.plugin.setActiveView(this.file.path, name);
    this.render();
  }

  // --- Rendering -------------------------------------------------------------

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('rb-root');

    if (!this.config) {
      this.renderSetup(root);
      return;
    }

    this.toolbarEl = root.createDiv({ cls: 'rb-toolbar' });
    this.renderToolbar();

    const main = root.createDiv({ cls: 'rb-main' });
    this.bodyEl = main.createDiv({ cls: 'rb-body' });
    this.sidebarEl = main.createDiv({ cls: 'rb-sidebar' });

    if (this.config.views.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'rb-empty rb-empty-views' });
      empty.createDiv({ text: 'This board has no views yet.' });
      const btn = empty.createEl('button', { cls: 'rb-home-create', text: 'Create view' });
      btn.onclick = (e) => this.openCreateViewMenu(e);
    } else {
      this.renderBody();
    }

    this.renderSidebar();
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
      new WizardModal(this.app, {}, 'Set up board', (config) => {
        this.config = config;
        this.activeView = config.views[0]?.name ?? '';
        this.saveConfig();
        this.render();
      }).open();
    };
  }

  // --- Toolbar ---------------------------------------------------------------

  private renderToolbar(): void {
    const bar = this.toolbarEl;
    if (!bar || !this.config) return;
    bar.empty();

    // Row 1: view tabs + add view (left), board settings (right).
    const tabsRow = bar.createDiv({ cls: 'rb-tabs-row' });
    const tabs = tabsRow.createDiv({ cls: 'rb-view-switch' });
    for (const view of this.config.views) {
      const btn = tabs.createEl('button', {
        cls: view.name === this.activeView ? 'rb-view-btn rb-active' : 'rb-view-btn',
        attr: { title: `${view.name} (${view.type})` },
      });
      setIcon(btn.createSpan({ cls: 'rb-view-btn-icon' }), TYPE_ICON[view.type]);
      btn.createSpan({ text: view.name });
      btn.onclick = () => this.setActiveView(view.name);
      btn.oncontextmenu = (e) => this.openTabMenu(e, view);
    }

    // Row 1 right: add view + settings buttons.
    tabsRow.createDiv({ cls: 'rb-spacer' });
    const tools = tabsRow.createDiv({ cls: 'rb-tools' });
    const view = this.currentView();
    this.toolButton(tools, 'plus', 'Create view', (e) => this.openCreateViewMenu(e));
    if (view) {
      this.toolButton(tools, 'sliders-horizontal', 'View settings', () => this.toggleSidebar('view'), this.sidebar === 'view');
    }
    this.toolButton(tools, 'settings', 'Board settings', () => this.toggleSidebar('board'), this.sidebar === 'board');

    // Row 2: search + sort/filter chips.
    const ctrlRow = bar.createDiv({ cls: 'rb-controls-row' });
    const search = ctrlRow.createEl('input', {
      cls: 'rb-search',
      attr: { type: 'search', placeholder: 'Search…' },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderBody();
    };

    if (view) {
      this.renderSortChip(ctrlRow, view);
      this.renderFilterChip(ctrlRow, view);
    }

    ctrlRow.createDiv({ cls: 'rb-spacer' });
    const newNote = ctrlRow.createEl('button', { cls: 'rb-new-note', attr: { title: 'Create a new note in this database' } });
    setIcon(newNote.createSpan({ cls: 'rb-new-note-icon' }), 'file-plus');
    newNote.createSpan({ text: 'New note' });
    newNote.onclick = () => void this.createNewNote();
  }

  private renderSortChip(parent: HTMLElement, view: ViewConfig): void {
    const sort = effectiveSort(view);
    const active = !!view.sort;
    const label = active
      ? `${this.propLabel(sort.property)} ${sort.dir === 'asc' ? '↑' : '↓'}`
      : 'Sort';
    const chip = this.chip(parent, 'arrow-up-down', label, active);
    chip.onclick = (e) => this.openSortMenu(e, view);
  }

  private renderFilterChip(parent: HTMLElement, view: ViewConfig): void {
    const count = countFilterRules(view.filter);
    const chip = this.chip(parent, 'filter', count ? `Filter · ${count}` : 'Filter', count > 0);
    chip.onclick = () => this.openFilter(view);
  }

  private chip(parent: HTMLElement, icon: string, label: string, active: boolean): HTMLElement {
    const chip = parent.createEl('button', { cls: active ? 'rb-chip rb-chip-active' : 'rb-chip' });
    setIcon(chip.createSpan({ cls: 'rb-chip-icon' }), icon);
    chip.createSpan({ text: label });
    return chip;
  }

  private toolButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (e: MouseEvent) => void,
    active = false,
  ): void {
    const btn = parent.createEl('button', {
      cls: active ? 'rb-tool-btn rb-active' : 'rb-tool-btn',
      attr: { 'aria-label': label, title: label },
    });
    setIcon(btn, icon);
    btn.onclick = onClick;
  }

  private propLabel(key: string): string {
    if (key === TITLE_SORT_KEY) return 'Title';
    const p = this.config?.properties.find((q) => q.name === key);
    return p ? propertyLabel(p) : key;
  }

  // --- Toolbar actions -------------------------------------------------------

  private openCreateViewMenu(e: MouseEvent): void {
    if (!this.config) return;
    const menu = new Menu();
    (['gallery', 'kanban', 'table'] as ViewType[]).forEach((type) => {
      menu.addItem((item) =>
        item.setTitle(`New ${type} view`).setIcon(TYPE_ICON[type]).onClick(() => {
          const view = makeDefaultView(type, this.config!.views);
          this.config!.views.push(view);
          this.activeView = view.name;
          if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
          this.sidebar = 'view';
          this.saveConfig();
          this.render();
        }),
      );
    });
    menu.showAtMouseEvent(e);
  }

  /**
   * Create a new note (carrying the database's source tag) in the configured
   * "New note location" and open it. If that location isn't set, open Board
   * settings so the user can set it first.
   */
  private async createNewNote(): Promise<void> {
    if (!this.config) return;
    const folder = this.config.newNoteFolder?.trim();
    if (!folder) {
      new Notice('R Board: set a "New note location" in board settings to use this.');
      this.toggleSidebar('board', true);
      return;
    }

    try {
      // Ensure the folder exists.
      const dir = normalizePath(folder);
      if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
        await this.app.vault.createFolder(dir).catch(() => undefined);
      }

      // Pick a unique filename.
      let path = normalizePath(`${dir}/Untitled.md`);
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = normalizePath(`${dir}/Untitled ${i++}.md`);
      }

      const content = `---\ntags:\n  - ${this.config.sourceTag}\n---\n`;
      const file = await this.app.vault.create(path, content);
      // Open in a new tab so the board stays put.
      await this.app.workspace.getLeaf('tab').openFile(file);
    } catch (e) {
      new Notice(`R Board: could not create note — ${(e as Error).message}`);
    }
  }

  private openTabMenu(e: MouseEvent, view: ViewConfig): void {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('View settings').setIcon('sliders-horizontal').onClick(() => {
      this.setActiveView(view.name);
      this.toggleSidebar('view', true);
    }));
    menu.addItem((i) => i.setTitle('Delete view').setIcon('trash').onClick(() => this.deleteView(view.name)));
    menu.showAtMouseEvent(e);
  }

  private openSortMenu(e: MouseEvent, view: ViewConfig): void {
    if (!this.config) return;
    const current = effectiveSort(view);
    const menu = new Menu();
    const addItem = (key: string, label: string): void => {
      menu.addItem((item) => {
        item.setTitle(label);
        if (current.property === key) item.setIcon(current.dir === 'asc' ? 'arrow-up' : 'arrow-down');
        item.onClick(() => {
          const dir = current.property === key && current.dir === 'asc' ? 'desc' : 'asc';
          view.sort = { property: key, dir };
          this.saveConfig();
        });
      });
    };
    addItem(TITLE_SORT_KEY, 'Title');
    for (const p of this.config.properties) addItem(p.name, propertyLabel(p));
    menu.showAtMouseEvent(e);
  }

  private openFilter(view: ViewConfig): void {
    if (!this.config) return;
    new FilterModal(this.app, view.filter, this.config.properties, (group) => {
      view.filter = group;
      this.saveConfig();
    }).open();
  }

  private deleteView(name: string): void {
    if (!this.config) return;
    this.config.views = this.config.views.filter((v) => v.name !== name);
    if (this.activeView === name) this.activeView = this.config.views[0]?.name ?? '';
    this.config.defaultView = this.config.views[0]?.name;
    if (this.sidebar === 'view' && this.config.views.length === 0) this.sidebar = null;
    this.saveConfig();
    this.render();
  }

  // --- Sidebar ---------------------------------------------------------------

  private toggleSidebar(mode: Exclude<SidebarMode, null>, force = false): void {
    this.sidebar = !force && this.sidebar === mode ? null : mode;
    this.contentEl.toggleClass('rb-has-sidebar', this.sidebar !== null);
    this.renderToolbar();
    this.renderSidebar();
  }

  private renderSidebar(): void {
    const el = this.sidebarEl;
    if (!el || !this.config) return;
    el.empty();
    this.contentEl.toggleClass('rb-has-sidebar', this.sidebar !== null);
    if (!this.sidebar) return;

    const header = el.createDiv({ cls: 'rb-sidebar-header' });
    header.createSpan({ cls: 'rb-sidebar-title', text: this.sidebar === 'board' ? 'Board settings' : 'View settings' });
    const close = header.createEl('button', { cls: 'rb-sidebar-close', attr: { 'aria-label': 'Close' } });
    setIcon(close, 'x');
    close.onclick = () => this.toggleSidebar(this.sidebar as Exclude<SidebarMode, null>);

    const content = el.createDiv({ cls: 'rb-sidebar-content rb-wizard' });

    if (this.sidebar === 'board') {
      renderDatabaseSettings(content, this.config, {
        onChange: () => this.saveConfig(),
        onStructureChange: () => {
          this.saveConfig();
          this.renderSidebar();
        },
      });
    } else {
      const view = this.currentView();
      if (!view) {
        content.createDiv({ cls: 'rb-empty', text: 'No view selected.' });
        return;
      }
      // The view's name may be edited here; keep the active-view pointer in sync.
      const syncName = (): void => {
        if (this.activeView !== view.name) {
          this.activeView = view.name;
          if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
        }
      };
      renderViewSettings(
        this.app,
        content,
        this.config,
        view,
        {
          onChange: () => {
            syncName();
            this.saveConfig();
          },
          onStructureChange: () => {
            syncName();
            this.saveConfig();
            this.renderSidebar();
          },
        },
        () => this.deleteView(view.name),
      );
    }
  }

  // --- Body ------------------------------------------------------------------

  /**
   * Open the in-place edit modal for an item. Re-renders are suspended while
   * the modal is open, so the view repaints exactly once, on close.
   */
  private openEditModal(item: BoardItem): void {
    if (!this.config) return;
    this.renderSuspended = true;
    new NoteEditModal(this.app, item.file, item.title, () => {
      this.renderSuspended = false;
      this.renderBody();
    }).open();
  }

  private renderBody(): void {
    if (this.renderSuspended) return;
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
      editItem: (item: BoardItem) => this.openEditModal(item),
      sort,
      setSort: (s: SortSpec) => {
        view.sort = s;
        this.saveConfig();
      },
      commit: () => this.saveConfig(),
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
