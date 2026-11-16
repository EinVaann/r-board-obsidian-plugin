import { TFile, type App } from 'obsidian';
import type { Automation, PropertyConfig } from '../types';
import { parseDatabaseConfig } from '../config';
import { tagsForFile } from './query';
import { activeAutomations, applyEffects, firedAutomations } from './automations';

interface Board {
  tag: string;
  properties: PropertyConfig[];
  automations: Automation[];
}

/**
 * Runs board automations when a note's values change, from anywhere (a board,
 * a table view, the note itself). Works for every board, open or not: each
 * note's last seen frontmatter is kept to tell a change from a first sighting.
 * Effects never set off other automations: the watcher's own write is
 * recorded as seen before it lands, so the change it causes is not a change.
 */
export class AutomationWatcher {
  /** `.board` path → its tag, properties and automations (boards without any are left out). */
  private readonly boards = new Map<string, Board>();
  /** Note path → frontmatter as last seen. */
  private readonly seen = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly app: App,
    private readonly listBoards: () => TFile[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read every board's automations, and remember the current values of their notes. */
  async scan(): Promise<void> {
    this.boards.clear();
    for (const file of this.listBoards()) if (file.extension === 'board') await this.loadBoard(file);
    this.seen.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.remember(file);
  }

  /**
   * A `.board` file was created or changed: re-read its automations and take a
   * fresh snapshot, so a new automation doesn't fire for notes that already match it.
   */
  async boardChanged(file: TFile): Promise<void> {
    await this.loadBoard(file);
    for (const note of this.app.vault.getMarkdownFiles()) this.remember(note);
  }

  boardDeleted(path: string): void {
    this.boards.delete(path);
  }

  renamed(oldPath: string, file: TFile): void {
    const board = this.boards.get(oldPath);
    if (board) {
      this.boards.delete(oldPath);
      this.boards.set(file.path, board);
    }
    const values = this.seen.get(oldPath);
    if (values) {
      this.seen.delete(oldPath);
      this.seen.set(file.path, values);
    }
  }

  noteDeleted(path: string): void {
    this.seen.delete(path);
  }

  /** A note's metadata changed: run the automations its change sets off. */
  async noteChanged(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    const boards = this.boardsFor(file);
    if (!boards.length) return;
    const after = this.frontmatter(file);
    const before = this.seen.get(file.path);
    this.seen.set(file.path, { ...after });
    const changes: Record<string, unknown> = {};
    for (const b of boards) {
      const fired = firedAutomations(b.automations, b.properties, before, after, file.basename);
      Object.assign(changes, applyEffects(fired, b.properties, { ...after, ...changes }, this.now()));
    }
    if (!Object.keys(changes).length) return;
    // Depth 1: the write below is already "seen", so it sets nothing else off.
    this.seen.set(file.path, { ...after, ...changes });
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) delete fm[k];
        else fm[k] = v;
      }
    });
  }

  private async loadBoard(file: TFile): Promise<void> {
    const r = parseDatabaseConfig(await this.app.vault.cachedRead(file));
    const automations = r.ok ? activeAutomations(r.config.automations, r.config.properties) : [];
    if (r.ok && automations.length) this.boards.set(file.path, { tag: r.config.sourceTag, properties: r.config.properties, automations });
    else this.boards.delete(file.path);
  }

  /** Every board the note belongs to that has automations. */
  private boardsFor(file: TFile): Board[] {
    if (!this.boards.size) return [];
    const tags = tagsForFile(this.app, file);
    return [...this.boards.values()].filter((b) => tags.includes(b.tag));
  }

  private remember(file: TFile): void {
    if (this.boardsFor(file).length) this.seen.set(file.path, { ...this.frontmatter(file) });
  }

  private frontmatter(file: TFile): Record<string, unknown> {
    return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
  }
}
