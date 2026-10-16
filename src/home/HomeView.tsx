import { useEffect, useState } from 'react';
import { ItemView, type TFile, type WorkspaceLeaf } from 'obsidian';
import type RBoardPlugin from '../../main';
import { parseDatabaseConfig, type ParseResult } from '../config';
import { mountReact, useApp } from '../react/mount';
import { Icon } from '../react/Icon';
import { openWizard } from '../settings/Wizard';
import { parseTableFile } from '../table/format';

export const HOME_VIEW_TYPE = 'r-board-home';

/** A hub listing every `.board` database in the vault, with a create button. */
export class BoardHomeView extends ItemView {
  private unmount: (() => void) | null = null;
  /** Bumped on vault changes so the React list re-reads the boards. */
  private listeners = new Set<() => void>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: RBoardPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'R Board';
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('rb-home');
    const subscribe = (fn: () => void): (() => void) => {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    };
    this.unmount = mountReact(this.app, this.contentEl, <Home plugin={this.plugin} subscribe={subscribe} />);
    // Reflect databases added/removed/renamed while open.
    this.registerEvent(this.app.vault.on('create', () => this.render()));
    this.registerEvent(this.app.vault.on('delete', () => this.render()));
    this.registerEvent(this.app.vault.on('rename', () => this.render()));
  }

  async onClose(): Promise<void> {
    this.unmount?.();
    this.unmount = null;
  }

  /** Re-read the list of boards. */
  render(): void {
    for (const fn of this.listeners) fn();
  }
}

interface BoardEntry {
  file: TFile;
  result: ParseResult;
  /** Tables: how many rows the file holds. */
  rows?: number;
}

function readEntry(file: TFile, raw: string): BoardEntry {
  if (file.extension !== 'table') return { file, result: parseDatabaseConfig(raw) };
  const t = parseTableFile(raw);
  return t.ok ? { file, result: { ok: true, config: t.table.config }, rows: t.table.rows.length } : { file, result: t };
}

function Home({ plugin, subscribe }: { plugin: RBoardPlugin; subscribe: (fn: () => void) => () => void }) {
  const app = useApp();
  const [tick, setTick] = useState(0);
  const [boards, setBoards] = useState<BoardEntry[] | null>(null);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), [subscribe]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      plugin.listBoardFiles().map(async (file) => {
        const raw = await app.vault.cachedRead(file).catch(() => '');
        return readEntry(file, raw);
      }),
    ).then((list) => {
      if (!cancelled) setBoards(list);
    });
    return () => {
      cancelled = true;
    };
  }, [app, plugin, tick]);

  const create = (): void =>
    openWizard(app, {}, 'Create database', (config) => void plugin.createDatabaseFromConfig(config));

  return (
    <>
      <div className="rb-home-header">
        <h2>Boards</h2>
        <button className="rb-home-create" onClick={() => void plugin.createTable()}>
          <Icon name="table" className="rb-home-create-icon" />
          <span>Create table</span>
        </button>
        <button className="rb-home-create" onClick={create}>
          <Icon name="plus" className="rb-home-create-icon" />
          <span>Create board</span>
        </button>
      </div>
      {boards && boards.length === 0 && (
        <div className="rb-home-empty">No boards yet. A board shows notes by tag; a table keeps its rows in the file.</div>
      )}
      {boards && boards.length > 0 && (
        <div className="rb-home-grid">
          {boards.map(({ file, result, rows }) => (
            <div key={file.path} className="rb-home-card" onClick={() => void plugin.openBoard(file)}>
              <Icon name={file.extension === 'table' ? 'table' : 'layout-dashboard'} className="rb-home-card-icon" />
              <div className="rb-home-card-body">
                <div className="rb-home-card-title">{result.ok ? result.config.name ?? file.basename : file.basename}</div>
                {result.ok ? (
                  <div className="rb-home-card-meta">
                    {rows !== undefined ? `${rows} row${rows === 1 ? '' : 's'}` : `#${result.config.sourceTag}`} · {result.config.views.length} view
                    {result.config.views.length === 1 ? '' : 's'}
                  </div>
                ) : (
                  <div className="rb-home-card-meta rb-home-card-error">Not configured yet</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
