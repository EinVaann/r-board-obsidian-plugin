/** Dev harness: the real R Board UI in a browser, with a fake `obsidian` and an in-memory vault. */
import { createRef } from 'react';
import { TFile, type App } from 'obsidian';
import { mountReact } from '../src/react/mount';
import { parseDatabaseConfig, serializeDatabase } from '../src/config';
import { parseTableFile, serializeTableFile } from '../src/table/format';
import { addRow, deleteRows, duplicateRow, setCell } from '../src/table/rows';
import { createBoardStore, type BoardStore } from '../src/board/store';
import { BoardContext, type BoardContextValue } from '../src/board/context';
import { BoardApp } from '../src/board/BoardApp';
import { setProperty } from '../src/data/properties';
import { openBoardSettings, openFilterModal, openViewSettings } from '../src/settings/modals';
import { openRecordEditor } from '../src/table/RecordEditor';

declare global {
  interface Window {
    __store: BoardStore;
    __saved: string;
    __notes: Record<string, Record<string, unknown>>;
  }
}

// An in-memory "vault" of game notes for the board harness.
const NOTES: Record<string, Record<string, unknown>> = {
  'Games/Hades.md': { tags: ['backlog'], status: 'playing', score: 9, genre: ['roguelike', 'action'], released: '2020-09-17' },
  'Games/Celeste.md': { tags: ['backlog'], status: 'to-play', score: 8.5, genre: ['platformer'], released: '2018-01-25' },
  'Games/Outer Wilds.md': { tags: ['backlog'], status: 'completed', score: 10, genre: ['exploration'], released: '2019-05-28' },
  'Games/Hollow Knight.md': { tags: ['backlog'], status: 'playing', score: 9.5, genre: ['metroidvania', 'action'] },
  'Games/Stardew Valley.md': { tags: ['backlog'], status: 'on-hold', score: 7, genre: ['farming'] },
  'Games/Disco Elysium.md': { tags: ['backlog'], status: 'to-play', genre: ['rpg'] },
};
window.__notes = NOTES;

const BACKLOG = {
  name: 'Backlog',
  sourceTag: 'backlog',
  newNoteFolder: 'Games',
  properties: [
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'to-play', label: 'To Play', color: '#7066ff' }, { value: 'playing', label: 'Playing', color: '#22aa44' }, { value: 'completed', label: 'Completed', color: '#d4a400' }, { value: 'on-hold', label: 'On Hold' }] },
    { name: 'score', label: 'Score', type: 'number', render: 'stars', max: 10 },
    { name: 'genre', label: 'Genre', type: 'multi', render: 'pills' },
    { name: 'released', label: 'Released', type: 'date', render: 'relative' },
    { name: 'age', label: 'Age', type: 'formula', formula: 'dateDiff(today(), {Released}, "years")', suffix: ' yrs' },
  ],
  views: [
    { name: 'Board', type: 'kanban', group: 'status', sort: { property: 'score', dir: 'desc' }, cardSize: 'small' },
    { name: 'Table', type: 'table', limit: 50 },
    { name: 'Gallery', type: 'gallery', limit: 50, group: 'status' },
  ],
  defaultView: 'Table',
};

function fakeApp(onNotesChanged: () => void): App {
  const files = () => Object.keys(NOTES).map((p) => new TFile(p));
  return {
    vault: {
      getFiles: files,
      getMarkdownFiles: files,
      getAbstractFileByPath: (p: string) => (p in NOTES ? new TFile(p) : null),
      cachedRead: async () => 'Some note body.',
      getResourcePath: () => '',
      createFolder: async () => undefined,
      create: async (p: string) => {
        NOTES[p] = {};
        return new TFile(p);
      },
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache: (f: TFile) => ({ frontmatter: NOTES[f.path] }),
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const next = { ...NOTES[f.path] };
        fn(next);
        NOTES[f.path] = next;
        setTimeout(onNotesChanged, 50);
      },
    },
    workspace: {
      openLinkText: (t: string) => console.info('[open link]', t),
      on: () => null,
      offref: () => undefined,
      getLeaf: () => ({ openFile: (f: TFile) => console.info('[open]', f.path) }),
    },
  } as unknown as App;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') === 'board' ? 'board' : 'table';
  if (params.has('mobile')) document.body.classList.add('is-mobile', 'is-phone');

  let store!: BoardStore;
  const app = fakeApp(() => store.getState().bumpVault());
  store = createBoardStore({
    saveConfig: (config) => {
      window.__saved = kind === 'table' ? serializeTableFile({ config, rows: store.getState().rows }) : serializeDatabase(config);
    },
    saveRows: (rows) => {
      window.__saved = serializeTableFile({ config: store.getState().config!, rows });
    },
    saveActiveView: () => undefined,
  });
  window.__store = store;

  if (kind === 'board') {
    const r = parseDatabaseConfig(JSON.stringify(BACKLOG));
    if (!r.ok) throw new Error(r.error);
    store.getState().loadConfig(r.config, null);
  } else {
    const r = parseTableFile(await (await fetch('./sample.table')).text());
    if (!r.ok) throw new Error(r.error);
    store.getState().loadRows(r.table.rows);
    store.getState().loadConfig(r.table.config, null);
  }

  const ctx: BoardContextValue = {
    app,
    store,
    boardFile: new TFile(kind === 'board' ? 'Backlog.board' : 'Expenses.table') as unknown as BoardContextValue['boardFile'],
    scrollRef: createRef<HTMLDivElement>(),
    actions: {
      editFile: (f) => console.info('[edit note]', f.path),
      openNote: (item) => console.info('[open note]', item.id),
      editItem: (item) => {
        if (item.file) return console.info('[edit note]', item.id);
        openRecordEditor(app, ctx, item.id, {
          remove: () => store.getState().updateRows((rows) => deleteRows(rows, [item.id])),
          duplicate: () => store.getState().updateRows((rows) => void duplicateRow(rows, item.id)),
        });
      },
      setValue: async (item, prop, value) => {
        if (item.file) return setProperty(app, item.file, prop, value);
        store.getState().updateRows((rows) => setCell(rows, item.id, prop, value));
      },
      addRow: (cells, after) => {
        if (kind !== 'table') return null;
        let id = '';
        store.getState().updateRows((rows) => void (id = addRow(rows, cells, after)));
        return id;
      },
      deleteRows: (ids) => store.getState().updateRows((rows) => deleteRows(rows, ids)),
      duplicateRow: (id) => store.getState().updateRows((rows) => void duplicateRow(rows, id)),
      openBoardSettings: () => openBoardSettings(app, ctx),
      openViewSettings: (i) => openViewSettings(app, ctx, i, () => undefined),
      openFilter: (i) => openFilterModal(app, ctx, i),
      createNewNote: () => {
        if (kind === 'table') ctx.actions.addRow();
      },
      openSetup: () => undefined,
      reportItems: () => undefined,
    },
  };

  const root = document.getElementById('root')!;
  root.classList.add('rb-root');
  mountReact(
    app,
    root,
    <BoardContext.Provider value={ctx}>
      <BoardApp />
    </BoardContext.Provider>,
  );
}

void main();
