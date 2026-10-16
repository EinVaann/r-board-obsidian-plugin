import { createRef, useLayoutEffect, useState } from 'react';
import { MarkdownRenderChild, Notice, TFile, debounce, type App } from 'obsidian';
import type { DatabaseConfig } from '../types';
import { parseDatabaseConfig, serializeDatabase } from '../config';
import { parseTableFile, serializeTableFile } from '../table/format';
import { addRow, deleteRows, duplicateRow, setCell } from '../table/rows';
import { openRecordEditor } from '../table/RecordEditor';
import { setProperty } from '../data/properties';
import { createNoteFor } from '../data/notes';
import { tagsForFile } from '../data/query';
import { createBoardStore, type BoardStore } from '../board/store';
import { BoardContext, useBoard, useBoardContext, type BoardContextValue } from '../board/context';
import { Body } from '../board/BoardApp';
import { mountReact } from '../react/mount';
import { Icon } from '../react/Icon';
import { NoteEditModal } from '../ui/NoteEditModal';

/** What an embed block asks for: a database file, one of its views, a height. */
export interface EmbedSpec {
  file: string;
  view?: string;
  height?: number;
}

/**
 * Parse an ```rboard block (`file:`, `view:`, `height:` lines). The old
 * ```table-chart block names its chart with `chart:`, which is now a view.
 */
export function parseEmbed(source: string): EmbedSpec | { error: string } {
  const spec: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const m = /^\s*([a-zA-Z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (m) spec[m[1].toLowerCase()] = m[2];
  }
  const file = spec.file?.replace(/^\[\[|\]\]$/g, '').trim();
  if (!file) return { error: 'Add a "file:" line naming a .board or .table file.' };
  const height = Number(spec.height);
  return { file, view: spec.view || spec.chart || undefined, height: Number.isFinite(height) && height > 0 ? height : undefined };
}

/** A database view rendered inside a note. Edits are written back to the database file. */
export class DatabaseEmbed extends MarkdownRenderChild {
  private unmount: (() => void) | null = null;
  private store: BoardStore | null = null;
  private file: TFile | null = null;
  /** The text this embed last wrote, so its own writes don't reload it. */
  private written = '';
  private itemPaths = new Set<string>();

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly spec: EmbedSpec | { error: string },
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.addClass('rb-embed');
    if ('error' in this.spec) return this.showError(this.spec.error);
    const spec = this.spec;
    const dest = this.app.metadataCache.getFirstLinkpathDest(spec.file, this.sourcePath) ?? this.app.vault.getAbstractFileByPath(spec.file);
    if (!(dest instanceof TFile) || (dest.extension !== 'board' && dest.extension !== 'table')) {
      return this.showError(`R Board: no .board or .table file "${spec.file}".`);
    }
    this.file = dest;
    const file = dest;

    const save = debounce(
      () => {
        const s = this.store?.getState();
        if (!s?.config) return;
        const text = s.config.kind === 'table' ? serializeTableFile({ config: s.config, rows: s.rows }) : serializeDatabase(s.config);
        this.written = text;
        void this.app.vault.modify(file, text);
      },
      300,
      true,
    );
    const store = createBoardStore({ saveConfig: save, saveRows: save, saveActiveView: () => undefined });
    this.store = store;

    const ctx: BoardContextValue = {
      app: this.app,
      store,
      boardFile: file,
      scrollRef: createRef<HTMLDivElement>(),
      actions: {
        editFile: (f, title) => this.editNote(f, title),
        openNote: (item, newLeaf) => {
          if (item.file) void this.app.workspace.openLinkText(item.file.path, item.file.path, newLeaf);
        },
        editItem: (item) => {
          if (item.file) this.editNote(item.file, item.title);
          else
            openRecordEditor(this.app, ctx, item.id, {
              remove: () => store.getState().updateRows((rows) => deleteRows(rows, [item.id])),
              duplicate: () => store.getState().updateRows((rows) => void duplicateRow(rows, item.id)),
            });
        },
        setValue: async (item, prop, value) => {
          if (item.file) {
            await setProperty(this.app, item.file, prop, value).catch((e) => {
              new Notice(`R Board: could not update ${prop.name} — ${(e as Error).message}`);
              throw e;
            });
          } else store.getState().updateRows((rows) => setCell(rows, item.id, prop, value));
        },
        addRow: (cells, after) => {
          if (store.getState().config?.kind !== 'table') return null;
          let id = '';
          store.getState().updateRows((rows) => void (id = addRow(rows, cells, after)));
          return id;
        },
        deleteRows: (ids) => store.getState().updateRows((rows) => deleteRows(rows, ids)),
        duplicateRow: (id) => store.getState().updateRows((rows) => void duplicateRow(rows, id)),
        // Settings live in the database itself: open it.
        openBoardSettings: () => this.openDatabase(),
        openViewSettings: () => this.openDatabase(),
        openFilter: () => this.openDatabase(),
        createNewNote: (values) => {
          const config = store.getState().config;
          if (!config) return;
          if (config.kind === 'table') {
            let id = '';
            store.getState().updateRows((rows) => void (id = addRow(rows, values)));
            ctx.actions.editItem({ id, title: '', values: {}, tags: [] });
          } else void createNoteFor(this.app, config, values);
        },
        openSetup: () => this.openDatabase(),
        reportItems: (items) => {
          this.itemPaths = new Set(items.map((i) => i.id));
        },
      },
    };

    void this.load_(spec.view);
    this.unmount = mountReact(
      this.app,
      this.containerEl,
      <BoardContext.Provider value={ctx}>
        <EmbedApp file={file} height={spec.height} onOpen={() => this.openDatabase()} />
      </BoardContext.Provider>,
    );

    // Reload when the database file changes elsewhere (not from this embed's own writes).
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f.path === file.path) void this.load_(store.getState().activeView);
      }),
    );
    // Boards: repaint when one of their notes changes.
    const refresh = debounce(() => store.getState().bumpVault(), 250, true);
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        const config = store.getState().config;
        if (!config || config.kind === 'table' || f.extension !== 'md') return;
        if (this.itemPaths.has(f.path) || tagsForFile(this.app, f).includes(config.sourceTag)) refresh();
      }),
    );
  }

  onunload(): void {
    this.unmount?.();
    this.unmount = null;
  }

  /** (Re)read the database file into the store, showing `view` (default: the database's default view). */
  private async load_(view?: string): Promise<void> {
    const file = this.file;
    const store = this.store;
    if (!file || !store) return;
    const text = await this.app.vault.read(file);
    if (text === this.written) return;
    this.written = text;
    let config: DatabaseConfig | null = null;
    let error: string | null = null;
    if (file.extension === 'table') {
      const r = parseTableFile(text);
      if (r.ok) {
        config = r.table.config;
        store.getState().loadRows(r.table.rows);
      } else error = r.error;
    } else {
      const r = parseDatabaseConfig(text);
      if (r.ok) config = r.config;
      else error = r.error;
    }
    const wanted = view && config?.views.some((v) => v.name === view) ? view : undefined;
    store.getState().loadConfig(config, error, wanted);
    if (view && config && !wanted) store.setState({ parseError: `No view named "${view}" in ${file.basename}.` });
  }

  private editNote(file: TFile, title?: string): void {
    new NoteEditModal(this.app, file, title ?? file.basename, (changed) => {
      if (changed) this.store?.getState().bumpVault();
    }).open();
  }

  private openDatabase(): void {
    if (this.file) void this.app.workspace.getLeaf('tab').openFile(this.file);
  }

  private showError(message: string): void {
    this.containerEl.createDiv({ cls: 'rb-embed-error', text: message });
  }
}

/** The embed: a small header (database · view, open button) over the view itself. */
function EmbedApp({ file, height, onOpen }: { file: TFile; height?: number; onOpen: () => void }) {
  const { scrollRef } = useBoardContext();
  const config = useBoard((s) => s.config);
  const parseError = useBoard((s) => s.parseError);
  const activeView = useBoard((s) => s.activeView);
  const view = config?.views.find((v) => v.name === activeView) ?? config?.views[0];
  // Lists virtualize against the scroll element: render them once it exists.
  const [attached, setAttached] = useState(false);
  useLayoutEffect(() => setAttached(true), []);

  return (
    <div className="rb-root rb-embed-root">
      <div className="rb-embed-head">
        <Icon name={file.extension === 'table' ? 'table' : 'layout-dashboard'} />
        <span className="rb-embed-name">{config?.name ?? file.basename}</span>
        {view && <span className="rb-embed-view">· {view.name}</span>}
        <button className="rb-icon-btn rb-embed-open" aria-label="Open" title={`Open ${file.basename}`} onClick={onOpen}>
          <Icon name="external-link" />
        </button>
      </div>
      {parseError && <div className="rb-embed-error">{parseError}</div>}
      <div
        className={view?.type === 'chart' ? 'rb-embed-body rb-embed-chart' : 'rb-embed-body'}
        ref={scrollRef}
        style={height && view?.type !== 'chart' ? { maxHeight: height } : undefined}
      >
        <div className="rb-body-inner">{attached && config && view && <EmbedBody config={config} viewName={view.name} height={height} />}</div>
      </div>
    </div>
  );
}

/** One view of the database; a chart takes the block's height, other views scroll inside the embed. */
function EmbedBody({ config, viewName, height }: { config: DatabaseConfig; viewName: string; height?: number }) {
  const view = config.views.find((v) => v.name === viewName);
  return view ? <Body config={config} view={view} chartHeight={height} /> : null;
}
