import { Menu, Notice, TFile, TFolder, TextFileView, WorkspaceLeaf, debounce, normalizePath, setIcon } from 'obsidian';
import { NoteEditModal } from './ui/NoteEditModal';
import type RBoardPlugin from '../main';
import type { BoardItem, DatabaseConfig, SortSpec, ViewConfig, ViewType } from './types';
import {
  effectiveSort,
  makeDefaultView,
  NO_SORT_KEY,
  normalizeTag,
  parseDatabaseConfig,
  propertyLabel,
  serializeDatabase,
  TITLE_SORT_KEY,
  visibleProperties,
} from './config';
import { queryItems, tagsForFile } from './data/query';
import { applyFilter, countFilterRules } from './data/filter';
import { filterBySearch, openNote, type BoardUiState, type RenderContext } from './render/common';
import { applySort } from './render/sort';
import { renderGallery } from './views/gallery';
import { renderKanban } from './views/kanban';
import { renderTable } from './views/table';
import { renderRecipeView } from './views/recipe';
import { WizardModal } from './ui/WizardModal';
import { FilterModal } from './ui/FilterModal';
import {
  type FormHooks,
  renderBoardGeneral,
  renderBoardProperties,
  renderColumnConfig,
  renderViewDisplay,
  renderViewGeneral,
} from './ui/SettingsForms';
import { SettingsModal } from './ui/SettingsModal';

export const BOARD_VIEW_TYPE = 'r-board-view';
/** File extension that opens as a database board (JSON content, like `.canvas`). */
export const BOARD_EXTENSION = 'board';

const TYPE_ICON: Record<ViewType, string> = {
  gallery: 'layout-grid',
  kanban: 'columns-3',
  table: 'table',
  recipe: 'utensils',
};

/** A board pane: parses a `.board` database config and renders the active view. */
export class BoardView extends TextFileView {
  plugin: RBoardPlugin;

  /** While an edit modal is open, suppress re-renders until it closes. */
  private renderSuspended = false;

  private config: DatabaseConfig | null = null;
  private parseError: string | null = null;
  private activeView = '';
  private searchQuery = '';
  private ui: BoardUiState = { collapsed: new Set(), pages: {}, listScroll: {} };
  /** Paths of every note in the database at the last render (pre-filter). */
  private itemPaths = new Set<string>();

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
    // Only the first `resolved` matters (initial index); later ones follow every edit.
    let initialResolve = true;
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      if (!initialResolve) return;
      initialResolve = false;
      refresh();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (this.affectsBoard(file)) refresh();
    }));
    this.registerEvent(this.app.metadataCache.on('deleted', (file) => {
      if (this.itemPaths.has(file.path)) refresh();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.itemPaths.has(oldPath) || (file instanceof TFile && this.affectsBoard(file))) refresh();
    }));
  }

  /** Whether a changed note is, or was at the last render, one of this board's items. */
  private affectsBoard(file: TFile): boolean {
    if (!this.config || file.extension !== 'md') return false;
    if (this.itemPaths.has(file.path)) return true;
    return tagsForFile(this.app, file).includes(normalizeTag(this.config.sourceTag));
  }

  // --- Config persistence ----------------------------------------------------

  /**
   * Persist the current in-memory config to the `.board` file without forcing a
   * full reload (so an open settings modal keeps focus). Refreshes body + toolbar.
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

    if (this.config.views.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'rb-empty rb-empty-views' });
      empty.createDiv({ text: 'This board has no views yet.' });
      const btn = empty.createEl('button', { cls: 'rb-home-create', text: 'Create view' });
      btn.onclick = (e) => this.openCreateViewMenu(e);
    } else {
      this.renderBody();
    }
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
      this.toolButton(tools, 'sliders-horizontal', 'View settings', () => this.openViewSettings(view));
    }
    this.toolButton(tools, 'settings', 'Board settings', () => this.openBoardSettings());

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
    const unsorted = sort.property === NO_SORT_KEY;
    const active = !!view.sort && !unsorted;
    const label = unsorted
      ? 'No sort'
      : active
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
  ): void {
    const btn = parent.createEl('button', {
      cls: 'rb-tool-btn',
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
    (['gallery', 'kanban', 'table', 'recipe'] as ViewType[]).forEach((type) => {
      menu.addItem((item) =>
        item.setTitle(`New ${type} view`).setIcon(TYPE_ICON[type]).onClick(() => {
          const view = makeDefaultView(type, this.config!.views);
          this.config!.views.push(view);
          this.activeView = view.name;
          if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
          this.saveConfig();
          this.render();
          this.openViewSettings(view);
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
      this.openBoardSettings();
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
      this.openViewSettings(view);
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
    menu.addItem((item) => {
      item.setTitle('No sort');
      if (current.property === NO_SORT_KEY) item.setIcon('check');
      item.onClick(() => {
        view.sort = { property: NO_SORT_KEY, dir: 'asc' };
        this.saveConfig();
      });
    });
    menu.addSeparator();
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
    this.saveConfig();
    this.render();
  }

  // --- Settings modals -------------------------------------------------------

  /** Hooks for settings forms: persist on change, re-render the modal on structural change. */
  private settingsHooks(modal: () => SettingsModal): FormHooks {
    return {
      onChange: () => this.saveConfig(),
      onStructureChange: () => {
        this.saveConfig();
        modal().refresh();
      },
      onRefresh: () => this.renderBody(),
    };
  }

  private openBoardSettings(): void {
    const config = this.config;
    if (!config) return;
    const hooks = this.settingsHooks(() => modal);
    const modal = new SettingsModal(this.app, 'Board settings', () => [
      { id: 'general', label: 'General', icon: 'settings', render: (el) => renderBoardGeneral(el, config, hooks) },
      { id: 'properties', label: 'Properties', icon: 'list', render: (el) => renderBoardProperties(el, config, hooks) },
    ]);
    modal.open();
  }

  private openViewSettings(view: ViewConfig): void {
    const config = this.config;
    if (!config) return;
    const base = this.settingsHooks(() => modal);
    // The view's name may be edited here; keep the active-view pointer in sync.
    const syncName = (): void => {
      if (this.activeView !== view.name) {
        this.activeView = view.name;
        if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
      }
    };
    const hooks: FormHooks = {
      onChange: () => {
        syncName();
        base.onChange();
      },
      onStructureChange: () => {
        syncName();
        base.onStructureChange();
      },
    };
    const onDelete = (): void => {
      modal.close();
      this.deleteView(view.name);
    };
    const modal = new SettingsModal(this.app, 'View settings', () => [
      { id: 'general', label: 'General', icon: 'sliders-horizontal', render: (el) => renderViewGeneral(this.app, el, config, view, hooks, onDelete) },
      { id: 'display', label: 'Display', icon: 'eye', render: (el) => renderViewDisplay(el, config, view, hooks) },
      ...(view.type === 'kanban'
        ? [{ id: 'columns', label: 'Columns', icon: 'columns-3', render: (el: HTMLElement) => renderColumnConfig(el, view, hooks) }]
        : []),
    ]);
    modal.open();
  }

  // --- Body ------------------------------------------------------------------

  /**
   * Open the in-place edit modal for an item. Re-renders are suspended while
   * the modal is open, so the view repaints exactly once, on close.
   */
  private openEditModal(file: TFile, title?: string): void {
    if (!this.config) return;
    this.renderSuspended = true;
    new NoteEditModal(this.app, file, title ?? file.basename, (changed) => {
      this.renderSuspended = false;
      // Only rebuild the board if the edit touched frontmatter the board reads.
      // Unchanged closes (the common case) skip a full card re-render.
      if (changed) this.renderBody();
    }).open();
  }

  private renderBody(): void {
    if (this.renderSuspended) return;
    const body = this.bodyEl;
    const view = this.currentView();
    if (!body || !this.config || !view) return;
    const { scrollTop, scrollLeft } = body;
    body.empty();

    const properties = visibleProperties(this.config, view);
    const sort = effectiveSort(view);

    const all: BoardItem[] = queryItems(this.app, this.config);
    this.itemPaths = new Set(all.map((i) => i.file.path));
    let items = applyFilter(all, view.filter, this.config.properties);
    items = filterBySearch(items, properties, this.searchQuery);
    items = applySort(items, sort, this.config.properties);

    // An empty kanban still shows its columns so cards can be added to them.
    if (items.length === 0 && !(all.length === 0 && view.type === 'kanban')) {
      this.renderEmptyState(body, view, all.length);
      return;
    }

    const ctx: RenderContext = {
      app: this.app,
      config: this.config,
      view,
      properties,
      boardFile: this.file!,
      component: this,
      editFile: (file: TFile, title?: string) => this.openEditModal(file, title),
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
      case 'recipe':
        renderRecipeView(body, items, ctx);
        break;
      case 'gallery':
      default:
        renderGallery(body, items, ctx);
        break;
    }
    body.scrollTop = scrollTop;
    body.scrollLeft = scrollLeft;
  }

  /** Explain why the view is empty and offer the matching way out. */
  private renderEmptyState(body: HTMLElement, view: ViewConfig, total: number): void {
    const box = body.createDiv({ cls: 'rb-empty rb-empty-state' });
    const actions = (): HTMLElement => box.createDiv({ cls: 'rb-empty-actions' });

    if (total === 0) {
      box.createDiv({ text: `No notes tagged #${this.config!.sourceTag} yet.` });
      const btn = actions().createEl('button', { cls: 'rb-home-create', text: 'New note' });
      btn.onclick = () => void this.createNewNote();
      return;
    }

    const hasSearch = this.searchQuery.trim() !== '';
    const hasFilter = countFilterRules(view.filter) > 0;
    const reason = hasSearch && hasFilter ? 'search and filter' : hasSearch ? 'search' : 'filter';
    box.createDiv({ text: `All ${total} notes are hidden by the current ${reason}.` });
    const row = actions();
    if (hasSearch) {
      row.createEl('button', { text: 'Clear search' }).onclick = () => {
        this.searchQuery = '';
        this.renderToolbar();
        this.renderBody();
      };
    }
    if (hasFilter) {
      row.createEl('button', { text: 'Clear filter' }).onclick = () => {
        view.filter = undefined;
        this.saveConfig();
      };
    }
  }
}
