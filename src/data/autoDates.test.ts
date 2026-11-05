// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { AutoDateRule, DatabaseConfig } from '../types';
import { parseDatabaseConfig, serializeDatabase } from '../config';
import { activeRules, datesToFill } from './autoDates';
import { AutoDateWatcher } from './AutoDateWatcher';

/** The mock TFile takes a path (the real one has no public constructor). */
const mkFile = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

const NOW = new Date(2026, 10, 5, 14, 30);
const START: AutoDateRule = { property: 'status', values: ['playing'], date: 'start-date' };
const END: AutoDateRule = { property: 'status', values: ['completed', 'dropped'], date: 'end-date' };

describe('datesToFill', () => {
  it('fills the date when the property changes to a trigger value', () => {
    expect(datesToFill([START, END], { status: 'planned' }, { status: 'playing' }, NOW)).toEqual({ 'start-date': '2026-11-05' });
    expect(datesToFill([START, END], { status: 'playing' }, { status: 'dropped' }, NOW)).toEqual({ 'end-date': '2026-11-05' });
  });

  it('matches values case-insensitively and in lists', () => {
    expect(datesToFill([START], { status: 'planned' }, { status: 'Playing' }, NOW)).toEqual({ 'start-date': '2026-11-05' });
    expect(datesToFill([START], { status: [] }, { status: ['playing'] }, NOW)).toEqual({ 'start-date': '2026-11-05' });
  });

  it('never overwrites a date that is set', () => {
    expect(datesToFill([START], { status: 'on-hold' }, { status: 'playing', 'start-date': '2026-01-02' }, NOW)).toEqual({});
  });

  it('does nothing when the value did not change, or changed to something else', () => {
    expect(datesToFill([START], { status: 'playing' }, { status: 'playing' }, NOW)).toEqual({});
    expect(datesToFill([START], { status: 'planned' }, { status: 'on-hold' }, NOW)).toEqual({});
  });

  it('treats a note not seen before as changed', () => {
    expect(datesToFill([START], undefined, { status: 'playing' }, NOW)).toEqual({ 'start-date': '2026-11-05' });
  });

  it('writes the time when asked', () => {
    expect(datesToFill([{ ...START, includeTime: true }], {}, { status: 'playing' }, NOW)).toEqual({ 'start-date': '2026-11-05T14:30' });
  });
});

describe('auto-date config', () => {
  const base = { sourceTag: 'backlog', views: [], properties: [{ name: 'status', type: 'select' }, { name: 'start-date', type: 'date' }] };

  it('round-trips and drops incomplete rules', () => {
    const r = parseDatabaseConfig(JSON.stringify({ ...base, autoDates: [START, { property: 'status', values: ['x'] }, 'bad'] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.config.autoDates).toEqual([START]);
    const again = parseDatabaseConfig(serializeDatabase(r.config));
    expect(again.ok && again.config.autoDates).toEqual([START]);
  });

  it('only keeps rules whose properties exist', () => {
    const config = { ...base, autoDates: [START, END] } as DatabaseConfig;
    expect(activeRules(config)).toEqual([START]);
  });

  it('leaves boards without rules unchanged', () => {
    expect(serializeDatabase(base as DatabaseConfig)).not.toContain('autoDates');
  });
});

/** A vault with one board and some tagged notes; frontmatter writes go through `processFrontMatter`. */
function vault(notes: Record<string, Record<string, unknown>>, rules: AutoDateRule[] = [START, END]) {
  const board = mkFile('Backlog.board');
  const text = JSON.stringify({
    sourceTag: 'backlog',
    views: [],
    properties: [{ name: 'status', type: 'select' }, { name: 'start-date', type: 'date' }, { name: 'end-date', type: 'date' }],
    autoDates: rules,
  });
  const writes: string[] = [];
  const app = {
    vault: {
      getMarkdownFiles: () => Object.keys(notes).map((p) => mkFile(p)),
      cachedRead: async () => text,
    },
    metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: notes[f.path] }) },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        writes.push(f.path);
        fn(notes[f.path]);
      },
    },
  } as unknown as App;
  const watcher = new AutoDateWatcher(app, () => [board], () => NOW);
  return { watcher, writes, notes };
}

describe('AutoDateWatcher', () => {
  it('does not touch notes on startup, then fills on a real change', async () => {
    const { watcher, writes, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'playing' } });
    await watcher.scan();
    await watcher.noteChanged(mkFile('G/A.md'));
    expect(writes).toEqual([]);

    notes['G/A.md'].status = 'completed';
    await watcher.noteChanged(mkFile('G/A.md'));
    expect(notes['G/A.md']['end-date']).toBe('2026-11-05');
    expect(notes['G/A.md']['start-date']).toBeUndefined();
  });

  it('ignores notes of other boards and its own write', async () => {
    const { watcher, writes, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'planned' }, 'N/B.md': { tags: ['other'], status: 'planned' } });
    await watcher.scan();
    notes['G/A.md'].status = 'playing';
    notes['N/B.md'].status = 'playing';
    await watcher.noteChanged(mkFile('G/A.md'));
    await watcher.noteChanged(mkFile('N/B.md'));
    await watcher.noteChanged(mkFile('G/A.md'));
    expect(writes).toEqual(['G/A.md']);
    expect(notes['N/B.md']['start-date']).toBeUndefined();
  });

  it('keeps the first start date when a game is resumed', async () => {
    const { watcher, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'on-hold', 'start-date': '2026-03-01' } });
    await watcher.scan();
    notes['G/A.md'].status = 'playing';
    await watcher.noteChanged(mkFile('G/A.md'));
    expect(notes['G/A.md']['start-date']).toBe('2026-03-01');
  });

  it('follows renames', async () => {
    const { watcher, writes, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'playing' } });
    await watcher.scan();
    notes['G/B.md'] = notes['G/A.md'];
    delete notes['G/A.md'];
    watcher.renamed('G/A.md', mkFile('G/B.md'));
    await watcher.noteChanged(mkFile('G/B.md'));
    expect(writes).toEqual([]);
  });
});
