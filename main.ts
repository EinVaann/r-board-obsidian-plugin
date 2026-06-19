import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { BOARD_EXTENSION, BOARD_VIEW_TYPE, BoardView } from './src/BoardView';

interface RBoardData {
  /** Active view name chosen per database, keyed by the `.board` file path. */
  activeViews?: Record<string, string>;
}

/** A starter `.board` database written by the "Create database" command. */
const STARTER_DATABASE = {
  name: 'Game Backlog',
  sourceTag: 'backlog',
  properties: [
    { name: 'cover', type: 'image', render: 'fill' },
    { name: 'genre', type: 'multi', render: 'pills' },
    { name: 'status', type: 'text', render: 'badge' },
    { name: 'rating', type: 'number', render: 'stars', max: 5 },
    { name: 'score', type: 'number', render: 'bar', max: 100 },
  ],
  views: [
    {
      name: 'Gallery',
      type: 'gallery',
      limit: 50,
      properties: ['cover', 'genre', 'rating', 'score'],
    },
    {
      name: 'Board',
      type: 'kanban',
      limit: 'none',
      group: 'status',
      columns: ['to-play', 'playing', 'completed', 'on-hold', 'dropped'],
      properties: ['cover', 'score'],
    },
    {
      name: 'Table',
      type: 'table',
      limit: 100,
      properties: ['status', 'genre', 'rating', 'score'],
    },
  ],
  defaultView: 'Gallery',
};

export default class RBoardPlugin extends Plugin {
  private data: RBoardData = {};

  async onload(): Promise<void> {
    this.data = ((await this.loadData()) as RBoardData) ?? {};

    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);

    this.addCommand({
      id: 'create-database',
      name: 'Create new database',
      callback: () => void this.createDatabase(),
    });
  }

  /** The view name last chosen for a given database file, if any. */
  getActiveView(path: string): string | undefined {
    return this.data.activeViews?.[path];
  }

  /** Persist the chosen view name for a database file. */
  async setActiveView(path: string, name: string): Promise<void> {
    if (!this.data.activeViews) this.data.activeViews = {};
    if (this.data.activeViews[path] === name) return;
    this.data.activeViews[path] = name;
    await this.saveData(this.data);
  }

  /** Create a starter `.board` database at the vault root and open it. */
  private async createDatabase(): Promise<void> {
    const folder = this.app.fileManager.getNewFileParent('');
    const base = folder instanceof TFolder ? folder.path : '';
    const dir = base ? `${base}/` : '';
    let path = normalizePath(`${dir}New Database.${BOARD_EXTENSION}`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}New Database ${i++}.${BOARD_EXTENSION}`);
    }
    try {
      const file = await this.app.vault.create(path, JSON.stringify(STARTER_DATABASE, null, 2));
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      new Notice(`R Board: could not create database — ${(e as Error).message}`);
    }
  }
}
