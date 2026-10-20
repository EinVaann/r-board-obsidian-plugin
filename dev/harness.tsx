/** Dev harness: the real R Board UI in a browser, with a fake `obsidian` and an in-memory vault. */
import { createRef, useState } from 'react';
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
import { DatabaseEmbed, parseEmbed } from '../src/embed/Embed';
import { parseFactory } from '../src/factory/parse';
import { Factory } from '../src/factory/Factory';
import { FactoryWorkspace } from '../src/factory/Workspace';
import { newPlan, serializeFactoryDoc, type FactoryDoc } from '../src/factory/plan';
import { parseData } from '../src/factory/book';

declare global {
  interface Window {
    __store: BoardStore;
    __saved: string;
    __notes: Record<string, Record<string, unknown>>;
  }
}

// An in-memory "vault" of game notes for the board harness.
const NOTES: Record<string, Record<string, unknown>> = {
  'Games/Hades.md': { tags: ['backlog'], status: 'playing', score: 9, genre: ['roguelike', 'action'], released: '2020-09-17', owned: true },
  'Games/Celeste.md': { tags: ['backlog'], status: 'to-play', score: 8.5, genre: ['platformer'], released: '2018-01-25', owned: true },
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
    { name: 'owned', label: 'Owned', type: 'checkbox' },
  ],
  views: [
    { name: 'Board', type: 'kanban', group: 'status', sort: { property: 'score', dir: 'desc' }, cardSize: 'small' },
    { name: 'Lanes', type: 'kanban', group: 'status', subGroup: 'owned', cardSize: 'small', properties: ['score'] },
    { name: 'By year', type: 'kanban', group: 'released', groupBucket: 'year', cardSize: 'small', properties: ['status'] },
    { name: 'Table', type: 'table', limit: 50 },
    { name: 'Gallery', type: 'gallery', limit: 50, group: 'status' },
  ],
  defaultView: 'Lanes',
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

/** ?embed: a "note" with two embed blocks over the sample table, edited through a fake file. */
async function embedMain(): Promise<void> {
  let text = await (await fetch('./sample.table')).text();
  const file = new TFile('R Sheet/Expenses.table');
  const handlers: ((f: TFile) => void)[] = [];
  const app = {
    vault: {
      read: async () => text,
      modify: async (_f: TFile, t: string) => {
        text = t;
        window.__saved = t;
        handlers.forEach((h) => h(file));
      },
      on: (name: string, fn: (f: TFile) => void) => (name === 'modify' && handlers.push(fn), {}),
      getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
    },
    metadataCache: { getFirstLinkpathDest: (p: string) => (p === file.path ? file : null), on: () => ({}) },
    workspace: { on: () => ({}), offref: () => undefined, getLeaf: () => ({ openFile: (f: TFile) => console.info('[open]', f.path) }) },
  } as unknown as App;
  const root = document.getElementById('root')!;
  root.style.cssText = 'height:auto;display:block;max-width:760px;margin:0 auto;padding:16px';
  root.createEl('h2', { text: 'Monthly review' });
  for (const block of ['file: R Sheet/Expenses.table\nchart: Where the money goes\nid: chshare\nheight: 260', 'file: R Sheet/Expenses.table\nview: Table\nheight: 300']) {
    const el = root.createDiv();
    new DatabaseEmbed(app, el, parseEmbed(block), 'Monthly review.md').onload();
  }
}

/** ?factory: a "note" with ```factory blocks over a sample recipe table, plus an inline recycling loop. */
async function factoryMain(): Promise<void> {
  const text = await (await fetch('./factory.table')).text();
  const file = new TFile('Games/Satisfactory.table');
  const app = {
    vault: {
      read: async () => text,
      on: () => ({}),
      offref: () => undefined,
      getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
    },
    metadataCache: { getFirstLinkpathDest: (p: string) => (p === 'Satisfactory' || p === 'Satisfactory.table' ? file : null) },
    workspace: { on: () => ({}), offref: () => undefined },
  } as unknown as App;
  const root = document.getElementById('root')!;
  root.style.cssText = 'height:auto;display:block;max-width:820px;margin:0 auto;padding:16px';
  const blocks: [string, string][] = [
    ['Reinforced plates (alternatives)', 'recipes: [[Satisfactory]]\nmake: 5 Reinforced Iron Plate/min'],
    ['Recycling loop (input mode)', 'make: Plate\ninput: 20 Ore\nrecipe: Press | Press | 2 | 2 Ore | 1 Plate, 1 Scrap\nrecipe: Recycler | Recycler | 4 | 2 Scrap | 1 Ore'],
  ];
  for (const [title, block] of blocks) {
    root.createEl('h3', { text: title });
    const el = root.createDiv();
    mountReact(app, el, <Factory spec={parseFactory(block)} sourcePath="Games/Factory.md" />);
  }
}

/** ?planner: a `.factory` file (Planner + Data tabs) built from the sample tables; edits land in window.__saved. */
async function plannerMain(): Promise<void> {
  const json = async (name: string): Promise<unknown> => JSON.parse(await (await fetch(`./${name}.table`)).text());
  // The sample tables are in R Board's table format: parseData converts them.
  const data = parseData({ recipes: await json('factory'), items: await json('factory-items'), transport: await json('factory-transport') });
  const file = new TFile('Games/Satisfactory.factory');
  const app = fakeApp(() => undefined);
  const root = document.getElementById('root')!;
  root.classList.add('rb-root', 'rb-planner-root');
  root.style.cssText = 'height:100vh;display:block';
  function Host() {
    const [doc, setDoc] = useState<FactoryDoc>({
      data,
      plans: [{ ...newPlan('Iron line'), outputs: [{ item: 'Reinforced Iron Plate', rate: 5 }] }, { ...newPlan('Ore budget'), priority: 'input', outputs: [{ item: 'Iron Plate', rate: 2 }, { item: 'Iron Rod', rate: 1 }], inputs: [{ item: 'Iron Ore', mode: 'max', qty: 120 }] }],
      active: 0,
    });
    return (
      <FactoryWorkspace
        doc={doc}
        onChange={(next) => {
          window.__saved = serializeFactoryDoc(next);
          setDoc(next);
        }}
      />
    );
  }
  mountReact(app, root, <Host />);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('planner')) return plannerMain();
  if (params.has('embed')) return embedMain();
  if (params.has('factory')) return factoryMain();
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
      createNewNote: (values) => {
        if (kind === 'table') ctx.actions.addRow(values);
        else console.info('[new note]', values);
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
