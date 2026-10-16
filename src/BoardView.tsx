import { createRef } from 'react';
import { Notice, TFile, TFolder, TextFileView, WorkspaceLeaf, debounce, normalizePath } from 'obsidian';
import type RBoardPlugin from '../main';
import type { BoardItem, DatabaseConfig } from './types';
import { parseDatabaseConfig, serializeDatabase } from './config';
import { tagsForFile } from './data/query';
import { setProperty } from './data/properties';
import { parseTableFile, serializeTableFile } from './table/format';
import { addRow, deleteRows, duplicateRow, setCell } from './table/rows';
import { openRecordEditor } from './table/RecordEditor';
import { createBoardStore, type BoardStore } from './board/store';
import { BoardContext, type BoardActions, type BoardContextValue } from './board/context';
import { BoardApp } from './board/BoardApp';
import { mountReact } from './react/mount';
import { NoteEditModal } from './ui/NoteEditModal';
import { openWizard } from './settings/Wizard';
import { openBoardSettings, openFilterModal, openViewSettings } from './settings/modals';

export const BOARD_VIEW_TYPE = 'r-board-view';
export const BOARD_EXTENSION = 'board';
export const TABLE_EXTENSION = 'table';

/**
 * A board pane. Obsidian side only: it owns the `.board` file, the store, and
 * vault-change detection; everything visible is the React tree in `BoardApp`.
 */
export class BoardView extends TextFileView {
  plugin: RBoardPlugin;

  private readonly store: BoardStore;
  private readonly ctx: BoardContextValue;
  private unmount: (() => void) | null = null;
  /** Paths of every note in the database at the last query (pre-filter). */
  private itemPaths = new Set<string>();
  /** While the edit modal is open, vault changes don't repaint the board. */
  private editing = false;

  constructor(leaf: WorkspaceLeaf, plugin: RBoardPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.store = createBoardStore({
      saveConfig: (config) => {
        this.data = config.kind === 'table' ? serializeTableFile({ config, rows: this.store.getState().rows }) : serializeDatabase(config);
        this.requestSave();
      },
      saveRows: (rows) => {
        const config = this.store.getState().config;
        if (!config) return;
        this.data = serializeTableFile({ config, rows });
        this.requestSave();
      },
      saveActiveView: (name) => {
        if (this.file) void this.plugin.setActiveView(this.file.path, name);
      },
    });

    const actions: BoardActions = {
      editFile: (file, title) => this.openEditModal(file, title),
      openNote: (item, newLeaf) => {
        if (item.file) void this.app.workspace.openLinkText(item.file.path, item.file.path, newLeaf);
      },
      editItem: (item) => {
        if (item.file) this.openEditModal(item.file, item.title);
        else this.openRowEditor(item.id);
      },
      setValue: async (item, prop, value) => {
        if (!item.file) {
          this.store.getState().updateRows((rows) => setCell(rows, item.id, prop, value));
          return;
        }
        try {
          await setProperty(this.app, item.file, prop, value);
        } catch (e) {
          new Notice(`R Board: could not update ${prop.name} — ${(e as Error).message}`);
          throw e;
        }
      },
      openBoardSettings: () => openBoardSettings(this.app, this.ctx),
      openViewSettings: (index) => openViewSettings(this.app, this.ctx, index, () => this.deleteView(index)),
      openFilter: (index) => openFilterModal(this.app, this.ctx, index),
      createNewNote: () => void this.createNewNote(),
      openSetup: () => this.openSetup(),
      reportItems: (items: BoardItem[]) => {
        this.itemPaths = new Set(items.map((i) => i.id));
      },
    };

    // `boardFile` is read lazily: the file is attached after construction.
    const view = this;
    this.ctx = {
      app: this.app,
      store: this.store,
      actions,
      get boardFile() {
        return view.file as TFile;
      },
      scrollRef: createRef<HTMLDivElement>(),
    };
  }

  getViewType(): string {
    return BOARD_VIEW_TYPE;
  }

  getIcon(): string {
    return this.isTable ? 'table' : 'layout-dashboard';
  }

  getDisplayText(): string {
    return this.store.getState().config?.name ?? this.file?.basename ?? 'Board';
  }

  // --- TextFileView contract -------------------------------------------------

  getViewData(): string {
    return this.data;
  }

  /** Whether this pane shows a `.table` file (rows stored in the file). */
  private get isTable(): boolean {
    return this.file?.extension === TABLE_EXTENSION;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    const saved = this.file ? this.plugin.getActiveView(this.file.path) : undefined;
    if (this.isTable) {
      const result = parseTableFile(data);
      if (!result.ok) {
        this.store.getState().loadRows([]);
        this.store.getState().loadConfig(null, result.error);
        return;
      }
      if (result.migrated) new Notice(`R Board: ${this.file?.basename} is an R Sheet table. It will be saved in R Board's format on the first edit.`);
      this.store.getState().loadRows(result.table.rows);
      this.store.getState().loadConfig(result.table.config, null, saved);
      return;
    }
    const result = parseDatabaseConfig(data);
    if (result.ok) this.store.getState().loadConfig(result.config, null, saved);
    else this.store.getState().loadConfig(null, data.trim() === '' || data.trim() === '{}' ? null : result.error);
  }

  clear(): void {
    this.store.getState().loadRows([]);
    this.store.getState().loadConfig(null, null);
  }

  // --- Lifecycle -------------------------------------------------------------

  async onOpen(): Promise<void> {
    this.contentEl.addClass('rb-root');
    this.unmount = mountReact(
      this.app,
      this.contentEl,
      <BoardContext.Provider value={this.ctx}>
        <BoardApp />
      </BoardContext.Provider>,
    );

    const refresh = debounce(() => this.store.getState().bumpVault(), 250, true);
    // Only the first `resolved` matters (initial index); later ones follow every edit.
    let initialResolve = true;
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      if (!initialResolve) return;
      initialResolve = false;
      refresh();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (!this.editing && this.affectsBoard(file)) refresh();
    }));
    this.registerEvent(this.app.metadataCache.on('deleted', (file) => {
      if (this.itemPaths.has(file.path)) refresh();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.itemPaths.has(oldPath) || (file instanceof TFile && this.affectsBoard(file))) refresh();
    }));
  }

  async onClose(): Promise<void> {
    this.unmount?.();
    this.unmount = null;
  }

  /** Whether a changed note is, or was at the last query, one of this board's items. */
  private affectsBoard(file: TFile): boolean {
    const config = this.store.getState().config;
    if (!config || file.extension !== 'md') return false;
    if (this.itemPaths.has(file.path)) return true;
    return tagsForFile(this.app, file).includes(config.sourceTag.toLowerCase());
  }

  // --- Actions ---------------------------------------------------------------

  /**
   * The in-place edit modal. Vault changes are ignored while it's open; on
   * close the board re-queries once, and only if the note's frontmatter changed.
   */
  private openEditModal(file: TFile, title?: string): void {
    this.editing = true;
    new NoteEditModal(this.app, file, title ?? file.basename, (changed) => {
      this.editing = false;
      if (changed) this.store.getState().bumpVault();
    }).open();
  }

  private openRowEditor(rowId: string): void {
    const { updateRows } = this.store.getState();
    openRecordEditor(this.app, this.ctx, rowId, {
      remove: () => updateRows((rows) => deleteRows(rows, [rowId])),
      duplicate: () => {
        let id: string | null = null;
        updateRows((rows) => void (id = duplicateRow(rows, rowId)));
        if (id) this.openRowEditor(id);
      },
    });
  }

  /** Tables: add a row (with optional starting cells) and open it. */
  private addRow(cells?: Record<string, unknown>): void {
    let id = '';
    this.store.getState().updateRows((rows) => void (id = addRow(rows, cells)));
    this.openRowEditor(id);
  }

  private openSetup(): void {
    if (this.isTable) {
      new Notice('R Board: this table file could not be read. Fix or replace its contents.');
      return;
    }
    openWizard(this.app, {}, 'Set up board', (config: DatabaseConfig) => {
      this.store.getState().loadConfig(config, null);
      this.data = serializeDatabase(config);
      this.requestSave();
    });
  }

  private deleteView(index: number): void {
    const { config, updateConfig, activeView, setActiveView } = this.store.getState();
    const name = config?.views[index]?.name;
    if (name === undefined) return;
    updateConfig((c) => {
      c.views.splice(index, 1);
      c.defaultView = c.views[0]?.name;
    });
    if (activeView === name) setActiveView(this.store.getState().config?.views[0]?.name ?? '');
  }

  /**
   * Create a note (carrying the database's source tag) in the configured
   * "New note location" and open it. If that location isn't set, open Board
   * settings so the user can set it first.
   */
  private async createNewNote(): Promise<void> {
    const config = this.store.getState().config;
    if (!config) return;
    if (config.kind === 'table') return this.addRow();
    const folder = config.newNoteFolder?.trim();
    if (!folder) {
      new Notice('R Board: set a "New note location" in board settings to use this.');
      openBoardSettings(this.app, this.ctx);
      return;
    }

    try {
      const dir = normalizePath(folder);
      if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
        await this.app.vault.createFolder(dir).catch(() => undefined);
      }
      let path = normalizePath(`${dir}/Untitled.md`);
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = normalizePath(`${dir}/Untitled ${i++}.md`);
      }
      const file = await this.app.vault.create(path, `---\ntags:\n  - ${config.sourceTag}\n---\n`);
      // Open in a new tab so the board stays put.
      await this.app.workspace.getLeaf('tab').openFile(file);
    } catch (e) {
      new Notice(`R Board: could not create note — ${(e as Error).message}`);
    }
  }
}
