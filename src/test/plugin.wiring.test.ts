// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
// `../../main` would resolve to the built main.js; the source is main.tsx.
// @ts-expect-error TS5097: .tsx extension in an import path
import RBoardPlugin from '../../main.tsx';
import { serializeDatabase } from '../config';
import { parseTableFile, serializeTableFile, newTableFile } from '../table/format';

const mkFile = (p: string): TFile => new (TFile as unknown as new (p: string) => TFile)(p);
type Handler = (...a: unknown[]) => void;

/**
 * A vault that behaves like Obsidian's where it matters here: files in memory,
 * frontmatter in a metadata cache, and `on()` handlers fired on change / rename.
 */
function fakeVault(files: Record<string, string>, frontmatter: Record<string, Record<string, unknown>>) {
  const handlers: Record<string, Handler[]> = {};
  const on = (name: string, fn: Handler) => ((handlers[name] ??= []).push(fn), { name, fn });
  const emit = (name: string, ...a: unknown[]) => (handlers[name] ?? []).forEach((h) => h(...a));
  const all = () => [...Object.keys(files), ...Object.keys(frontmatter)].map(mkFile);
  let ready: (() => void) | null = null;
  const app = {
    vault: {
      getFiles: all,
      getMarkdownFiles: () => Object.keys(frontmatter).map(mkFile),
      getAbstractFileByPath: (p: string) => (p in files || p in frontmatter ? mkFile(p) : null),
      cachedRead: async (f: TFile) => files[f.path] ?? '',
      read: async (f: TFile) => files[f.path] ?? '',
      process: async (f: TFile, fn: (t: string) => string) => (files[f.path] = fn(files[f.path])),
      on,
      offref: () => undefined,
    },
    metadataCache: {
      getFileCache: (f: TFile) => (frontmatter[f.path] ? { frontmatter: frontmatter[f.path] } : null),
      getFirstLinkpathDest: (link: string) => {
        const hit = Object.keys(frontmatter).find((p) => p === `${link}.md` || p.endsWith(`/${link}.md`));
        return hit ? mkFile(hit) : null;
      },
      fileToLinktext: (f: TFile) => f.path.replace(/\.md$/, ''),
      on,
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const next = { ...frontmatter[f.path] };
        fn(next);
        frontmatter[f.path] = next;
        emit('changed', mkFile(f.path));
      },
    },
    workspace: {
      onLayoutReady: (fn: () => void) => void (ready = fn),
      getLeavesOfType: () => [],
      iterateAllLeaves: () => undefined,
      on,
      offref: () => undefined,
    },
  } as unknown as App;
  return {
    app,
    emit,
    /** Obsidian finished loading the layout. */
    ready: () => ready?.(),
    /** A note's frontmatter was edited (from anywhere), as Obsidian reports it. */
    edit: (path: string, patch: Record<string, unknown>) => {
      frontmatter[path] = { ...frontmatter[path], ...patch };
      emit('changed', mkFile(path));
    },
    /** A file moved; Obsidian fires the vault's rename with the old path. */
    rename: (from: string, to: string) => {
      if (from in frontmatter) (frontmatter[to] = frontmatter[from]), delete frontmatter[from];
      emit('rename', mkFile(to), from);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const BOARD = serializeDatabase({
  sourceTag: 'backlog',
  properties: [
    { name: 'status', type: 'select' },
    { name: 'start-date', type: 'date' },
    { name: 'end-date', type: 'date' },
  ],
  views: [],
  autoDates: [
    { property: 'status', values: ['playing'], date: 'start-date' },
    { property: 'status', values: ['completed', 'dropped'], date: 'end-date' },
  ],
});

function logTable(link: string): string {
  const t = newTableFile('Log');
  t.config.properties = [{ name: 'game', type: 'links' }, { name: 'hours', type: 'number' }];
  t.config.titleProperty = 'game';
  t.rows = [{ id: 'r1', cells: { game: [`[[${link}|Ex Astris]]`], hours: 2 } }, { id: 'r2', cells: { game: ['[[Other]]'], hours: 1 } }];
  return serializeTableFile(t);
}

async function loadPlugin(v: ReturnType<typeof fakeVault>): Promise<void> {
  const plugin = new RBoardPlugin(v.app, {} as never);
  await plugin.onload();
  v.ready();
  await flush();
  await flush();
}

describe('plugin wiring (fake vault)', () => {
  it('fills start and end dates on real status changes, not on startup', async () => {
    const fm: Record<string, Record<string, unknown>> = {
      'Games/Ex Astris.md': { tags: ['backlog'], status: 'playing' },
      'Games/Other.md': { tags: ['other'], status: 'planned' },
    };
    const v = fakeVault({ 'Backlog.board': BOARD }, fm);
    await loadPlugin(v);
    // Already playing at startup: nothing is filled.
    expect(fm['Games/Ex Astris.md']['start-date']).toBeUndefined();

    v.edit('Games/Ex Astris.md', { status: 'completed' });
    await flush();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(fm['Games/Ex Astris.md']['end-date']).toBe(iso);

    // Notes of other boards are left alone.
    v.edit('Games/Other.md', { status: 'playing' });
    await flush();
    expect(fm['Games/Other.md']['start-date']).toBeUndefined();
  });

  it('never overwrites a date that is already set', async () => {
    const fm: Record<string, Record<string, unknown>> = { 'Games/A.md': { tags: ['backlog'], status: 'planned', 'start-date': '2026-01-02' } };
    const v = fakeVault({ 'Backlog.board': BOARD }, fm);
    await loadPlugin(v);
    v.edit('Games/A.md', { status: 'playing' });
    await flush();
    expect(fm['Games/A.md']['start-date']).toBe('2026-01-02');
  });

  it('rewrites links in a closed .table when a note is renamed', async () => {
    const files: Record<string, string> = { 'Backlog.board': BOARD, 'Log.table': logTable('Games/Ex Astris') };
    const fm: Record<string, Record<string, unknown>> = { 'Games/Ex Astris.md': { tags: ['backlog'] }, 'Games/Other.md': {} };
    const v = fakeVault(files, fm);
    await loadPlugin(v);
    v.rename('Games/Ex Astris.md', 'Games/Done/Ex Astris Remastered.md');
    await flush();
    const r = parseTableFile(files['Log.table']);
    expect(r.ok && r.table.rows.map((row) => row.cells.game)).toEqual([['[[Games/Done/Ex Astris Remastered|Ex Astris]]'], ['[[Other]]']]);
  });

  it('keeps auto-dates working for a note after it is renamed', async () => {
    const fm: Record<string, Record<string, unknown>> = { 'Games/A.md': { tags: ['backlog'], status: 'planned' } };
    const v = fakeVault({ 'Backlog.board': BOARD }, fm);
    await loadPlugin(v);
    v.rename('Games/A.md', 'Games/B.md');
    v.edit('Games/B.md', { status: 'playing' });
    await flush();
    expect(fm['Games/B.md']['start-date']).toBeTruthy();
  });
});
