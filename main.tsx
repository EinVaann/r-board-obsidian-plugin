import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf, normalizePath } from 'obsidian';
import { BOARD_EXTENSION, BOARD_VIEW_TYPE, BoardView, TABLE_EXTENSION } from './src/BoardView';
import { newTableFile, serializeTableFile } from './src/table/format';
import { BoardHomeView, HOME_VIEW_TYPE } from './src/home/HomeView';
import { serializeDatabase } from './src/config';
import type { DatabaseConfig } from './src/types';
import { openWizard } from './src/settings/Wizard';
import { parseRecipe } from './src/recipe/parse';
import { Recipe } from './src/recipe/Recipe';
import { ReactRenderChild } from './src/react/mount';

interface RBoardData {
  /** Active view name chosen per database, keyed by the `.board` file path. */
  activeViews?: Record<string, string>;
}

export default class RBoardPlugin extends Plugin {
  private data: RBoardData = {};

  async onload(): Promise<void> {
    this.data = ((await this.loadData()) as RBoardData) ?? {};

    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(HOME_VIEW_TYPE, (leaf) => new BoardHomeView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);
    try {
      this.registerExtensions([TABLE_EXTENSION], BOARD_VIEW_TYPE);
    } catch {
      // Another plugin (R Sheet) already handles .table files.
      new Notice('R Board: .table files are handled by another plugin (R Sheet?). Disable it to open tables in R Board.');
    }

    // Interactive recipe blocks: ```recipe → portions-scaled ingredients/times.
    this.registerMarkdownCodeBlockProcessor('recipe', (source, el, ctx) => {
      ctx.addChild(new ReactRenderChild(this.app, el, <Recipe recipe={parseRecipe(source)} />));
    });

    this.addRibbonIcon('circuit-board', 'R Board', () => void this.openHome());

    this.addCommand({
      id: 'open-home',
      name: 'Open R Board',
      callback: () => void this.openHome(),
    });
    this.addCommand({
      id: 'create-database',
      name: 'Create new database',
      callback: () => this.openCreateWizard(),
    });
    this.addCommand({
      id: 'create-table',
      name: 'Create new table',
      callback: () => void this.createTable(),
    });

    // File-explorer right-click → "New board" (in the folder, or a file's folder).
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        const folder = file instanceof TFolder ? file : file instanceof TFile ? file.parent : null;
        if (!folder) return;
        menu.addItem((item) =>
          item
            .setTitle('New board')
            .setIcon('circuit-board')
            // Group with the core "New note / New folder / New canvas" actions.
            .setSection('action')
            .onClick(() => this.openCreateWizard(folder.path)),
        );
        menu.addItem((item) =>
          item
            .setTitle('New table')
            .setIcon('table')
            .setSection('action')
            .onClick(() => void this.createTable(folder.path)),
        );
      }),
    );
  }

  // --- Active-view persistence ----------------------------------------------

  getActiveView(path: string): string | undefined {
    return this.data.activeViews?.[path];
  }

  async setActiveView(path: string, name: string): Promise<void> {
    if (!this.data.activeViews) this.data.activeViews = {};
    if (this.data.activeViews[path] === name) return;
    this.data.activeViews[path] = name;
    await this.saveData(this.data);
  }

  // --- Home + boards ---------------------------------------------------------

  /** Open (or reveal) the R Board home view in a tab. */
  async openHome(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      (existing[0].view as BoardHomeView).render();
      return;
    }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Every `.board` and `.table` file in the vault, sorted by path. */
  listBoardFiles(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => f.extension === BOARD_EXTENSION || f.extension === TABLE_EXTENSION)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Create an empty `.table` (Name + Notes columns) and open it. */
  async createTable(folderPath?: string): Promise<void> {
    await this.createFile('New Table', TABLE_EXTENSION, serializeTableFile(newTableFile()), folderPath);
  }

  /** Open a `.board` file as a board view. */
  async openBoard(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private openCreateWizard(folderPath?: string): void {
    openWizard(this.app, {}, 'Create database', (config) => {
      void this.createDatabaseFromConfig(config, folderPath);
    });
  }

  /** Write a new `.board` file from a config and open it. */
  async createDatabaseFromConfig(config: DatabaseConfig, folderPath?: string): Promise<void> {
    await this.createFile(config.name?.trim() || 'New Database', BOARD_EXTENSION, serializeDatabase(config), folderPath);
  }

  /** Write a new file (unique name in the folder, default: Obsidian's new-file location) and open it. */
  private async createFile(name: string, extension: string, content: string, folderPath?: string): Promise<void> {
    const folder = folderPath !== undefined
      ? this.app.vault.getAbstractFileByPath(folderPath)
      : this.app.fileManager.getNewFileParent('');
    const dir = folder instanceof TFolder && folder.path ? `${folder.path}/` : '';
    const base = name.replace(/[\\/:*?"<>|]/g, '-');

    let path = normalizePath(`${dir}${base}.${extension}`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}${base} ${i++}.${extension}`);
    }
    try {
      const file = await this.app.vault.create(path, content);
      await this.openBoard(file);
    } catch (e) {
      new Notice(`R Board: could not create file — ${(e as Error).message}`);
    }
  }
}
