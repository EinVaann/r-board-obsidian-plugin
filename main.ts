import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { BOARD_EXTENSION, BOARD_VIEW_TYPE, BoardView } from './src/BoardView';
import type { ViewMode } from './src/types';

interface RBoardData {
  /** Active view mode chosen per board, keyed by the `.board` file path. */
  boardViews?: Record<string, ViewMode>;
}

/** A starter `.board` config written by the "Create board" command. */
const STARTER_BOARD = {
  name: 'New Board',
  sourceTag: 'backlog',
  fields: [
    { name: 'cover', type: 'image', render: 'fill' },
    { name: 'title', type: 'text' },
    { name: 'genre', type: 'multi', render: 'pills' },
    { name: 'rating', type: 'number', render: 'stars', max: 5 },
    { name: 'score', type: 'number', render: 'bar', max: 100 },
  ],
  kanban: { groups: ['to-play', 'playing', 'completed', 'on-hold', 'dropped'] },
  defaultView: 'gallery',
};

export default class RBoardPlugin extends Plugin {
  private data: RBoardData = {};

  async onload(): Promise<void> {
    this.data = ((await this.loadData()) as RBoardData) ?? {};

    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);

    this.addCommand({
      id: 'create-board',
      name: 'Create new board',
      callback: () => void this.createBoard(),
    });
  }

  /** The view mode last chosen for a given board file, if any. */
  getBoardView(path: string): ViewMode | undefined {
    return this.data.boardViews?.[path];
  }

  /** Persist the chosen view mode for a board file. */
  async setBoardView(path: string, mode: ViewMode): Promise<void> {
    if (!this.data.boardViews) this.data.boardViews = {};
    if (this.data.boardViews[path] === mode) return;
    this.data.boardViews[path] = mode;
    await this.saveData(this.data);
  }

  /** Create a starter `.board` file at the vault root and open it. */
  private async createBoard(): Promise<void> {
    const folder = this.app.fileManager.getNewFileParent('');
    const base = folder instanceof TFolder ? folder.path : '';
    let path = normalizePath(`${base ? base + '/' : ''}New Board.${BOARD_EXTENSION}`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${base ? base + '/' : ''}New Board ${i++}.${BOARD_EXTENSION}`);
    }
    try {
      const file = await this.app.vault.create(path, JSON.stringify(STARTER_BOARD, null, 2));
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      new Notice(`R Board: could not create board — ${(e as Error).message}`);
    }
  }
}
