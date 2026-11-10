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
import { DatabaseEmbed, parseEmbed } from '../src/embed/Embed';
import SCHEDULE_FIXTURE from '../src/schedule/fixture.json';
import { AutoDateWatcher } from '../src/data/AutoDateWatcher';
import { applyTheme, parseTheme } from '../src/theme';

const BOARD_PATH = 'Backlog.board';

declare global {
  interface Window {
    __store: BoardStore;
    __saved: string;
    __notes: Record<string, Record<string, unknown>>;
    /** Set by e2e tests (before load) to replace the sample data. */
    __fixture?: { table?: string; board?: unknown; notes?: Record<string, Record<string, unknown>> };
    /** Console-style log of actions the fake Obsidian received (open note, notices…). */
    __log: string[];
    /** Non-note files of the fake vault (e.g. the schedule's log table), by path. */
    __files: Record<string, string>;
  }
}

window.__log = [];
const log = (msg: string): void => {
  window.__log.push(msg);
  console.info(msg);
};

// An in-memory "vault" of game notes for the board harness.
const NOTES: Record<string, Record<string, unknown>> = {
  'Games/Hades.md': { tags: ['backlog'], status: 'playing', score: 9, genre: ['roguelike', 'action'], released: '2020-09-17', owned: true },
  'Games/Celeste.md': { tags: ['backlog'], status: 'to-play', score: 8.5, genre: ['platformer'], released: '2018-01-25', owned: true },
  'Games/Outer Wilds.md': { tags: ['backlog'], status: 'completed', score: 10, genre: ['exploration'], released: '2019-05-28' },
  'Games/Hollow Knight.md': { tags: ['backlog'], status: 'playing', score: 9.5, genre: ['metroidvania', 'action'] },
  'Games/Stardew Valley.md': { tags: ['backlog'], status: 'on-hold', score: 7, genre: ['farming'] },
  'Games/Disco Elysium.md': { tags: ['backlog'], status: 'to-play', genre: ['rpg'] },
};
if (window.__fixture?.notes) {
  for (const k of Object.keys(NOTES)) delete NOTES[k];
  Object.assign(NOTES, window.__fixture.notes);
}
window.__notes = NOTES;

/**
 * ?schedule: the real backlog snapshot as notes, plus a session log table.
 * ?showcase: the same notes with every view type on one board (&mode=light|dark).
 */
const SHOWCASE = new URLSearchParams(location.search).has('showcase');
const SCHEDULE = SHOWCASE || new URLSearchParams(location.search).has('schedule');
const LOG_PATH = 'Backlog timelog.table';
const FILES: Record<string, string> = {};
if (SCHEDULE) {
  for (const k of Object.keys(NOTES)) delete NOTES[k];
  for (const r of SCHEDULE_FIXTURE as { id: string; status: string; genre: string[]; duration: number | null; score: number | null; live?: boolean }[]) {
    NOTES[`Backlog Items/${r.id}.md`] = { tags: ['backlog'], status: r.status, score: r.score, genre: r.genre, 'play-hours': r.duration, 'live-service': r.live === true };
  }
  NOTES['Backlog Items/Hades.md'] = { tags: ['backlog'], status: 'completed', score: 9, genre: ['Roguelike'], 'play-hours': 22 };
  NOTES['Backlog Items/Is this Seat Taken.md'].casual = true;
  if (SHOWCASE) {
    // Every status shows up somewhere, plus owned / released for the other views.
    const extra: [string, string, number, string[], number, string][] = [
      ['Celeste', 'completed', 9.5, ['Platformer'], 12, '2018-01-25'],
      ['Outer Wilds', 'completed', 10, ['Metroidbrainia'], 17, '2019-05-28'],
      ['Stardew Valley', 'on-hold', 7, ['Life sim', 'Cozy'], 53, '2016-02-26'],
      ['Disco Elysium', 'dropped', 8, ['Interactive drama'], 25, '2019-10-15'],
      ['Hollow Knight', 'to-play', 9.5, ['Metroidvania'], 30, '2017-02-24'],
    ];
    for (const [t, status, score, genre, h, released] of extra) {
      NOTES[`Backlog Items/${t}.md`] = { tags: ['backlog'], status, score, genre, 'play-hours': h, released, owned: score >= 9 };
    }
    let i = 0;
    for (const n of Object.values(NOTES)) {
      n.owned ??= i % 3 !== 0;
      n.released ??= `20${String(14 + (i % 11)).padStart(2, '0')}-0${(i % 9) + 1}-1${i % 9}`;
      i++;
    }
  }
  const row = (id: string, game: string, h: number, d: string) => ({ id, cells: { notes: [`[[Backlog Items/${game}|${game}]]`], hours: h, date: d } });
  FILES[LOG_PATH] = JSON.stringify({
    version: 1,
    kind: 'table',
    name: 'Backlog timelog',
    titleProperty: 'notes',
    properties: [
      { name: 'notes', type: 'links', label: 'Game' },
      { name: 'hours', type: 'number', label: 'Timeplay' },
      { name: 'date', type: 'date', label: 'Timestamp' },
      { name: 'type', type: 'select', label: 'Type', options: ['lane', 'live', 'detour', 'trial'].map((value) => ({ value })) },
    ],
    views: [{ name: 'Table', type: 'table' }],
    rows: [
      row('r1', 'Ender Magnolia Bloom in the Mist', 4, '2026-10-20'),
      row('r2', 'Arknights', 3, '2026-10-21'),
      row('r3', 'Ender Magnolia Bloom in the Mist', 6, '2026-10-27'),
      row('r4', 'Ex Astris', 5, '2026-10-29'),
      row('r5', 'Reverse 1999', 2, '2026-10-30'),
      row('r6', 'Ex Astris', 3, '2026-11-03'),
      row('r7', 'Ender Magnolia Bloom in the Mist', 2, '2026-11-04'),
    ],
  });
}

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

const SCHEDULE_BOARD = {
  name: 'Backlog',
  sourceTag: 'backlog',
  properties: [
    { name: 'status', type: 'select', options: ['to-play', 'planned', 'playing', 'completed', 'dropped', 'on-hold'].map((value) => ({ value })) },
    { name: 'score', type: 'number', render: 'stars', max: 10 },
    { name: 'genre', type: 'multi', render: 'pills' },
    { name: 'play-hours', type: 'number' },
    { name: 'live-service', type: 'checkbox' },
    { name: 'casual', type: 'checkbox' },
    { name: 'start-date', type: 'date' },
    { name: 'end-date', type: 'date' },
  ],
  views: [
    { name: 'Schedule', type: 'schedule', schedule: { log: LOG_PATH, similar: [['JRPG', 'Visual novel']] } },
    { name: 'Board', type: 'kanban', group: 'status', cardSize: 'small' },
  ],
};

/** ?showcase: one board with every view type over the real backlog. */
const STATUS_OPTIONS = [
  { value: 'to-play', label: 'To Play', color: '#7066ff' },
  { value: 'planned', label: 'Planned', color: '#4d7bd6' },
  { value: 'playing', label: 'Playing', color: '#22aa44' },
  { value: 'completed', label: 'Completed', color: '#d4a400' },
  { value: 'on-hold', label: 'On Hold', color: '#c26a2a' },
  { value: 'dropped', label: 'Dropped', color: '#c0263f' },
];
const SHOWCASE_BOARD = {
  name: 'Backlog',
  sourceTag: 'backlog',
  newNoteFolder: 'Backlog Items',
  properties: [
    { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    { name: 'score', label: 'Score', type: 'number', render: 'stars', max: 10 },
    { name: 'genre', label: 'Genre', type: 'multi', render: 'pills' },
    { name: 'play-hours', label: 'Hours', type: 'number', suffix: ' h' },
    { name: 'released', label: 'Released', type: 'date', render: 'relative' },
    { name: 'age', label: 'Age', type: 'formula', formula: 'dateDiff(today(), {Released}, "years")', suffix: ' yrs' },
    { name: 'owned', label: 'Owned', type: 'checkbox' },
    { name: 'live-service', label: 'Live service', type: 'checkbox' },
    { name: 'casual', label: 'Casual', type: 'checkbox' },
    { name: 'start-date', label: 'Started', type: 'date' },
    { name: 'end-date', label: 'Ended', type: 'date' },
  ],
  views: [
    { name: 'Schedule', type: 'schedule', schedule: { log: LOG_PATH, logType: 'type', similar: [['JRPG', 'Visual novel']] } },
    {
      name: 'Board',
      type: 'kanban',
      group: 'status',
      sort: { property: 'score', dir: 'desc' },
      cardSize: 'small',
      properties: ['score', 'genre', 'play-hours'],
      columns: ['playing', 'planned', 'to-play', 'on-hold'],
      groupConfig: { 'to-play': { label: 'Up next' }, 'on-hold': { hidden: true } },
    },
    { name: 'Lanes', type: 'kanban', group: 'status', subGroup: 'owned', cardSize: 'small', properties: ['score'] },
    { name: 'Table', type: 'table', limit: 'none', sort: { property: 'score', dir: 'desc' }, summary: true, calculations: { score: 'avg', 'play-hours': 'sum', owned: 'checked' } },
    { name: 'Gallery', type: 'gallery', limit: 'none', group: 'status', properties: ['score', 'genre'] },
    { name: 'Hours by status', type: 'chart', limit: 'none', chart: { type: 'bar', x: 'status', values: ['play-hours'], aggregate: 'sum', splitBy: 'owned', stacked: true, sort: 'value-desc', showLegend: true, showLabels: true } },
    { name: 'Games by status', type: 'chart', limit: 'none', chart: { type: 'donut', x: 'status', values: [], aggregate: 'count', sort: 'value-desc', showLegend: true, showLabels: true } },
  ],
  defaultView: 'Schedule',
  autoDates: [
    { property: 'status', values: ['playing'], date: 'start-date' },
    { property: 'status', values: ['completed', 'dropped'], date: 'end-date' },
  ],
};

/** Metadata-cache `changed` listeners (the auto-date watcher). */
const changedHandlers: ((f: TFile) => void)[] = [];
/** Vault `modify` listeners (views reading another file, like the schedule's log). */
const modifyHandlers: ((f: TFile) => void)[] = [];
window.__files = FILES;

function fakeApp(onNotesChanged: () => void): App {
  const files = () => Object.keys(NOTES).map((p) => new TFile(p));
  return {
    vault: {
      getFiles: () => [...files(), ...Object.keys(FILES).map((p) => new TFile(p))],
      getMarkdownFiles: files,
      getAbstractFileByPath: (p: string) => (p in NOTES || p in FILES ? new TFile(p) : null),
      cachedRead: async (f: TFile) => FILES[f.path] ?? 'Some note body.',
      process: async (f: TFile, fn: (text: string) => string) => {
        FILES[f.path] = fn(FILES[f.path] ?? '');
        log(`[write] ${f.path}`);
        setTimeout(() => modifyHandlers.forEach((h) => h(new TFile(f.path))), 0);
        return FILES[f.path];
      },
      on: (name: string, fn: (f: TFile) => void) => (name === 'modify' && modifyHandlers.push(fn), {}),
      offref: () => undefined,
      getResourcePath: () => '',
      createFolder: async () => undefined,
      create: async (p: string) => {
        NOTES[p] = {};
        return new TFile(p);
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => {
        if (!SCHEDULE) return null;
        const hit = Object.keys(NOTES).find((p) => p === `${link}.md` || p.endsWith(`/${link}.md`));
        return hit ? new TFile(hit) : null;
      },
      getFileCache: (f: TFile) => ({ frontmatter: NOTES[f.path] }),
      fileToLinktext: (f: TFile) => f.path.replace(/\.md$/, ''),
      on: (name: string, fn: (f: TFile) => void) => (name === 'changed' && changedHandlers.push(fn), {}),
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const next = { ...NOTES[f.path] };
        fn(next);
        NOTES[f.path] = next;
        // Like Obsidian: the metadata cache reports the change a moment later.
        setTimeout(() => {
          changedHandlers.forEach((h) => h(new TFile(f.path)));
          onNotesChanged();
        }, 50);
      },
    },
    workspace: {
      openLinkText: (t: string) => log(`[open link] ${t}`),
      getLeavesOfType: () => [],
      on: () => null,
      offref: () => undefined,
      getLeaf: () => ({ openFile: (f: TFile) => log(`[open] ${f.path}`) }),
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
    workspace: { on: () => ({}), offref: () => undefined, getLeaf: () => ({ openFile: (f: TFile) => log(`[open] ${f.path}`) }) },
  } as unknown as App;
  const root = document.getElementById('root')!;
  root.style.cssText = 'height:auto;display:block;max-width:760px;margin:0 auto;padding:16px';
  root.createEl('h2', { text: 'Monthly review' });
  for (const block of ['file: R Sheet/Expenses.table\nchart: Where the money goes\nid: chshare\nheight: 260', 'file: R Sheet/Expenses.table\nview: Table\nheight: 300']) {
    const el = root.createDiv();
    new DatabaseEmbed(app, el, parseEmbed(block), 'Monthly review.md').onload();
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('embed')) return embedMain();
  const kind = params.get('kind') === 'board' || SCHEDULE ? 'board' : 'table';
  if (params.has('mobile')) document.body.classList.add('is-mobile', 'is-phone');
  // Plugin appearance, as the setting would set it: ?theme=classic, ?mode=dark (default industrial / light).
  applyTheme(document, parseTheme({ theme: params.get('theme') ?? 'industrial', mode: params.get('mode') ?? 'light' }));

  let store!: BoardStore;
  const app = fakeApp(() => store.getState().bumpVault());
  const watcher = new AutoDateWatcher(app, () => Object.keys(FILES).map((p) => new TFile(p)));
  store = createBoardStore({
    saveConfig: (config) => {
      window.__saved = kind === 'table' ? serializeTableFile({ config, rows: store.getState().rows }) : serializeDatabase(config);
      if (kind === 'board') {
        FILES[BOARD_PATH] = window.__saved;
        void watcher.boardChanged(new TFile(BOARD_PATH));
      }
    },
    saveRows: (rows) => {
      window.__saved = serializeTableFile({ config: store.getState().config!, rows });
    },
    saveActiveView: () => undefined,
  });
  window.__store = store;

  const fixture = window.__fixture;
  if (kind === 'board') {
    const r = parseDatabaseConfig(JSON.stringify(fixture?.board ?? (SHOWCASE ? SHOWCASE_BOARD : SCHEDULE ? SCHEDULE_BOARD : BACKLOG)));
    if (!r.ok) throw new Error(r.error);
    store.getState().loadConfig(r.config, null);
    // The real auto-date watcher, fed by the fake metadata cache (as main.tsx wires it).
    FILES[BOARD_PATH] = serializeDatabase(r.config);
    await watcher.scan();
    changedHandlers.push((f) => void watcher.noteChanged(f));
  } else {
    const r = parseTableFile(fixture?.table ?? (await (await fetch('./sample.table')).text()));
    if (!r.ok) throw new Error(r.error);
    store.getState().loadRows(r.table.rows);
    store.getState().loadConfig(r.table.config, null);
  }

  const ctx: BoardContextValue = {
    app,
    store,
    boardFile: new TFile(kind === 'board' ? BOARD_PATH : 'Expenses.table') as unknown as BoardContextValue['boardFile'],
    scrollRef: createRef<HTMLDivElement>(),
    actions: {
      editFile: (f) => log(`[edit note] ${f.path}`),
      openNote: (item) => log(`[open note] ${item.id}`),
      editItem: (item) => {
        if (item.file) return log(`[edit note] ${item.id}`);
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
        else log(`[new note] ${JSON.stringify(values)}`);
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
