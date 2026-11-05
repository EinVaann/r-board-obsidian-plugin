import { TFile, type App } from 'obsidian';
import type { AutoDateRule, DatabaseConfig } from '../types';
import { parseDatabaseConfig } from '../config';
import { tagsForFile } from './query';
import { activeRules, datesToFill, snapshot } from './autoDates';

interface Board {
  tag: string;
  rules: AutoDateRule[];
}

/**
 * Fills date properties when a note's watched property changes (see
 * `autoDates` in board settings). Works for every board, open or not: board
 * rules are read from the `.board` files, and each note's last seen values are
 * kept in memory to tell a change from a first sighting.
 */
export class AutoDateWatcher {
  /** `.board` path → its tag and rules (boards without rules are left out). */
  private readonly boards = new Map<string, Board>();
  /** Note path → watched values as last seen. */
  private readonly seen = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly app: App,
    private readonly listBoards: () => TFile[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read every board's rules, and remember the current values of their notes. */
  async scan(): Promise<void> {
    this.boards.clear();
    for (const file of this.listBoards()) if (file.extension === 'board') await this.loadBoard(file);
    this.seen.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.remember(file);
  }

  /**
   * A `.board` file was created or changed: re-read its rules and take a fresh
   * snapshot, so a newly added rule doesn't fire for notes that already match it.
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

  /**
   * A note's metadata changed: fill any dates its rules call for. The watcher's
   * own write triggers this again, but the watched value is then already seen.
   */
  async noteChanged(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    const rules = this.rulesFor(file);
    if (!rules.length) return;
    const after = this.frontmatter(file);
    const before = this.seen.get(file.path);
    this.seen.set(file.path, snapshot(rules, after));
    const fill = datesToFill(rules, before, after, this.now());
    if (!Object.keys(fill).length) return;
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      // Re-check inside the write: the note may have gained a date meanwhile.
      for (const [k, v] of Object.entries(fill)) if (fm[k] === undefined || fm[k] === null || String(fm[k]).trim() === '') fm[k] = v;
    });
  }

  private async loadBoard(file: TFile): Promise<void> {
    const r = parseDatabaseConfig(await this.app.vault.cachedRead(file));
    const rules = r.ok ? activeRules(r.config) : [];
    if (r.ok && rules.length) this.boards.set(file.path, { tag: (r.config as DatabaseConfig).sourceTag, rules });
    else this.boards.delete(file.path);
  }

  /** The rules of every board the note belongs to. */
  private rulesFor(file: TFile): AutoDateRule[] {
    if (!this.boards.size) return [];
    const tags = tagsForFile(this.app, file);
    const out: AutoDateRule[] = [];
    for (const b of this.boards.values()) if (tags.includes(b.tag)) out.push(...b.rules);
    return out;
  }

  private remember(file: TFile): void {
    const rules = this.rulesFor(file);
    if (rules.length) this.seen.set(file.path, snapshot(rules, this.frontmatter(file)));
  }

  private frontmatter(file: TFile): Record<string, unknown> {
    return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
  }
}
