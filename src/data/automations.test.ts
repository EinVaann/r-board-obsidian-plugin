// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { Automation, DatabaseConfig, PropertyConfig } from '../types';
import { parseDatabaseConfig, serializeDatabase } from '../config';
import { parseTableFile, serializeTableFile, newTableFile } from '../table/format';
import { activeAutomations, applyEffects, automateRows, findChains, firedAutomations, newChains } from './automations';
import { AutomationWatcher } from './AutomationWatcher';

/** The mock TFile takes a path (the real one has no public constructor). */
const mkFile = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

const NOW = new Date(2026, 10, 5, 14, 30);
const PROPS: PropertyConfig[] = [
  { name: 'status', type: 'select', options: [{ value: 'planned' }, { value: 'playing' }, { value: 'completed' }, { value: 'dropped' }] },
  { name: 'start-date', type: 'date' },
  { name: 'end-date', type: 'date' },
  { name: 'owned', type: 'checkbox' },
  { name: 'score', type: 'number' },
  { name: 'tags', type: 'multi' },
  { name: 'related', type: 'links' },
  { name: 'double', type: 'formula', formula: '{score} * 2' },
];
const START: Automation = { id: 's', triggers: [{ property: 'status', op: 'becomes', values: ['playing'] }], effects: [{ property: 'start-date', op: 'today', onlyIfEmpty: true }] };
const END: Automation = { id: 'e', triggers: [{ property: 'status', op: 'becomes', values: ['completed', 'dropped'] }], effects: [{ property: 'end-date', op: 'today', onlyIfEmpty: true }] };

/** Run automations on one change and return what they write. */
const run = (autos: Automation[], before: Record<string, unknown> | undefined, after: Record<string, unknown>) => {
  const active = activeAutomations(autos, PROPS);
  return applyEffects(firedAutomations(active, PROPS, before, after), PROPS, after, NOW);
};

describe('triggers', () => {
  it('becomes: fires on the change to a value, case-insensitively, not when it stays', () => {
    expect(run([START, END], { status: 'planned' }, { status: 'playing' })).toEqual({ 'start-date': '2026-11-05' });
    expect(run([START, END], { status: 'playing' }, { status: 'Dropped' })).toEqual({ 'end-date': '2026-11-05' });
    expect(run([START], { status: 'playing' }, { status: 'playing' })).toEqual({});
    expect(run([START], { status: 'planned' }, { status: 'completed' })).toEqual({});
  });

  it('becomes … from: only from the listed values', () => {
    const a: Automation = { id: 'x', triggers: [{ property: 'status', op: 'becomes', values: ['playing'], from: ['planned'] }], effects: [{ property: 'owned', op: 'check' }] };
    expect(run([a], { status: 'planned' }, { status: 'playing' })).toEqual({ owned: true });
    expect(run([a], { status: 'dropped' }, { status: 'playing' })).toEqual({});
  });

  it('a record not seen before counts as changed from empty', () => {
    expect(run([START], undefined, { status: 'playing' })).toEqual({ 'start-date': '2026-11-05' });
  });

  it('numbers fire when they cross the line, not on every edit', () => {
    const a: Automation = { id: 'x', triggers: [{ property: 'score', op: 'above', number: 8 }], effects: [{ property: 'owned', op: 'check' }] };
    expect(run([a], { score: 7 }, { score: 9 })).toEqual({ owned: true });
    expect(run([a], { score: 9 }, { score: 10 })).toEqual({});
  });

  it('multi gains / loses specific values or any', () => {
    const gain: Automation = { id: 'g', triggers: [{ property: 'tags', op: 'gains', values: ['favorite'] }], effects: [{ property: 'owned', op: 'check' }] };
    const anyLoss: Automation = { id: 'l', triggers: [{ property: 'tags', op: 'loses' }], effects: [{ property: 'owned', op: 'uncheck' }] };
    expect(run([gain], { tags: ['rpg'] }, { tags: ['rpg', 'Favorite'] })).toEqual({ owned: true });
    expect(run([gain], { tags: ['rpg'] }, { tags: ['rpg', 'cozy'] })).toEqual({});
    expect(run([anyLoss], { tags: ['rpg', 'cozy'], owned: true }, { tags: ['rpg'], owned: true })).toEqual({ owned: false });
  });

  it('links match by note name, whatever the folder or label', () => {
    const a: Automation = { id: 'x', triggers: [{ property: 'related', op: 'gains', values: ['[[Hades]]'] }], effects: [{ property: 'owned', op: 'check' }] };
    expect(run([a], {}, { related: ['[[Games/Hades|The Hades]]'] })).toEqual({ owned: true });
  });

  it('formula triggers react to their inputs', () => {
    const a: Automation = { id: 'x', triggers: [{ property: 'double', op: 'above', number: 15 }], effects: [{ property: 'owned', op: 'check' }] };
    expect(run([a], { score: 7 }, { score: 8 })).toEqual({ owned: true });
  });

  it('any: one trigger is enough; all: every trigger holds and one just changed', () => {
    const triggers = [
      { property: 'status', op: 'becomes', values: ['completed'] },
      { property: 'owned', op: 'checked' },
    ] as Automation['triggers'];
    const any: Automation = { id: 'any', triggers, effects: [{ property: 'score', op: 'set', value: 10 }] };
    const all: Automation = { ...any, id: 'all', match: 'all' };
    expect(run([any], { status: 'playing' }, { status: 'completed' })).toEqual({ score: 10 });
    expect(run([all], { status: 'playing' }, { status: 'completed' })).toEqual({});
    expect(run([all], { status: 'playing', owned: true }, { status: 'completed', owned: true })).toEqual({ score: 10 });
    // The other order: owned is checked later, status already completed.
    expect(run([all], { status: 'completed' }, { status: 'completed', owned: true })).toEqual({ score: 10 });
  });

  it('skips disabled automations and half-filled triggers', () => {
    expect(run([{ ...START, disabled: true }], { status: 'planned' }, { status: 'playing' })).toEqual({});
    const blank: Automation = { ...START, triggers: [{ property: 'status', op: 'becomes' }] };
    expect(run([blank], { status: 'planned' }, { status: 'playing' })).toEqual({});
  });
});

describe('effects', () => {
  const fire = (effects: Automation['effects'], values: Record<string, unknown> = {}) =>
    run([{ id: 'x', triggers: [{ property: 'status', op: 'changes' }], effects }], { ...values, status: 'planned' }, { ...values, status: 'playing' });

  it('one trigger, several effects, applied in order', () => {
    expect(
      fire([
        { property: 'owned', op: 'check' },
        { property: 'tags', op: 'add', value: ['started'] },
        { property: 'score', op: 'increment', number: 2 },
        { property: 'end-date', op: 'today', number: 7 },
      ], { tags: ['rpg'], score: 5 }),
    ).toEqual({ owned: true, tags: ['rpg', 'started'], score: 7, 'end-date': '2026-11-12' });
  });

  it('never overwrites with "only if empty", and leaves unchanged values out', () => {
    expect(fire([{ property: 'start-date', op: 'today', onlyIfEmpty: true }], { 'start-date': '2026-01-02' })).toEqual({});
    expect(fire([{ property: 'owned', op: 'check' }], { owned: true })).toEqual({});
  });

  it('clears, removes, writes the time when asked', () => {
    expect(fire([{ property: 'tags', op: 'remove', value: ['RPG'] }, { property: 'score', op: 'clear' }], { tags: ['rpg', 'cozy'], score: 3 })).toEqual({ tags: ['cozy'], score: null });
    expect(fire([{ property: 'start-date', op: 'today', includeTime: true }])).toEqual({ 'start-date': '2026-11-05T14:30' });
  });

  it('skips a "set to" with no value yet instead of clearing', () => {
    expect(fire([{ property: 'score', op: 'set' }], { score: 3 })).toEqual({});
  });
});

describe('chains', () => {
  it('finds an effect that sets off another automation, or itself', () => {
    const own: Automation = { id: 'o', triggers: [{ property: 'owned', op: 'checked' }], effects: [{ property: 'tags', op: 'add', value: ['mine'] }] };
    const done: Automation = { id: 'd', triggers: [{ property: 'status', op: 'becomes', values: ['completed'] }], effects: [{ property: 'owned', op: 'check' }] };
    expect(findChains([own, done], PROPS).map((c) => `${c.from.id}->${c.to.id}`)).toEqual(['d->o']);
    const loop: Automation = { id: 'l', triggers: [{ property: 'score', op: 'changes' }], effects: [{ property: 'score', op: 'increment', number: 1 }] };
    expect(findChains([loop], PROPS).map((c) => `${c.from.id}->${c.to.id}`)).toEqual(['l->l']);
  });

  it('knows a value that can never match is not a chain', () => {
    const toDone: Automation = { id: 'a', triggers: [{ property: 'owned', op: 'checked' }], effects: [{ property: 'status', op: 'set', value: 'completed' }] };
    const whenPlaying: Automation = { id: 'b', triggers: [{ property: 'status', op: 'becomes', values: ['playing'] }], effects: [{ property: 'score', op: 'set', value: 1 }] };
    expect(findChains([toDone, whenPlaying], PROPS)).toEqual([]);
    expect(findChains([toDone, { ...whenPlaying, triggers: [{ property: 'status', op: 'becomes', values: ['completed'] }] }], PROPS)).toHaveLength(1);
  });

  it('follows formulas: setting an input sets off a trigger on the formula', () => {
    const a: Automation = { id: 'a', triggers: [{ property: 'owned', op: 'checked' }], effects: [{ property: 'score', op: 'set', value: 9 }] };
    const b: Automation = { id: 'b', triggers: [{ property: 'double', op: 'above', number: 10 }], effects: [{ property: 'tags', op: 'add', value: ['top'] }] };
    expect(findChains([a, b], PROPS)).toHaveLength(1);
  });

  it('newChains reports only what an edit adds', () => {
    const a: Automation = { id: 'a', triggers: [{ property: 'owned', op: 'checked' }], effects: [{ property: 'score', op: 'set', value: 9 }] };
    const b: Automation = { id: 'b', triggers: [{ property: 'score', op: 'changes' }], effects: [{ property: 'tags', op: 'add', value: ['x'] }] };
    expect(newChains([a], [a, b], PROPS)).toHaveLength(1);
    expect(newChains([a, b], [a, b], PROPS)).toHaveLength(0);
  });
});

describe('config', () => {
  const base = { sourceTag: 'backlog', views: [], properties: PROPS };

  it('round-trips automations and drops broken parts', () => {
    const r = parseDatabaseConfig(JSON.stringify({ ...base, automations: [START, { id: 'bad', triggers: [{ property: 'x', op: 'nope' }], effects: ['no'] }] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.config.automations).toEqual([START, { id: 'bad', triggers: [], effects: [] }]);
    const again = parseDatabaseConfig(serializeDatabase(r.config));
    expect(again.ok && again.config.automations).toEqual(r.config.automations);
  });

  it('converts 1.0 auto-date rules, and saves them as automations', () => {
    const r = parseDatabaseConfig(JSON.stringify({ ...base, autoDates: [{ property: 'status', values: ['playing'], date: 'start-date', includeTime: true }] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.config.automations).toEqual([
      { id: 'd1', triggers: [{ property: 'status', op: 'becomes', values: ['playing'] }], effects: [{ property: 'start-date', op: 'today', onlyIfEmpty: true, includeTime: true }] },
    ]);
    const saved = serializeDatabase(r.config);
    expect(saved).not.toContain('autoDates');
    expect(saved).toContain('"automations"');
  });

  it('.table files keep their automations', () => {
    const t = newTableFile('T');
    t.config.automations = [START];
    const r = parseTableFile(serializeTableFile(t));
    expect(r.ok && r.table.config.automations).toEqual([START]);
  });

  it('leaves files without automations unchanged', () => {
    expect(serializeDatabase(base as DatabaseConfig)).not.toContain('automations');
  });
});

describe('table rows', () => {
  const active = activeAutomations([START], PROPS);
  it('applies to edited and new rows only, once', () => {
    const prev: { id: string; cells: Record<string, unknown> }[] = [{ id: 'a', cells: { status: 'planned' } }, { id: 'b', cells: { status: 'playing' } }];
    const next = [{ id: 'a', cells: { status: 'playing' } }, prev[1], { id: 'c', cells: { status: 'playing' } }];
    const out = automateRows(active, PROPS, undefined, prev, next, NOW);
    expect(out.map((r) => r.cells['start-date'])).toEqual(['2026-11-05', undefined, '2026-11-05']);
    expect(out[1]).toBe(prev[1]);
  });

  it('returns the same rows when nothing fires', () => {
    const prev = [{ id: 'a', cells: { status: 'planned' } }];
    const next = [{ id: 'a', cells: { status: 'dropped' } }];
    expect(automateRows(active, PROPS, undefined, prev, next, NOW)).toBe(next);
  });
});

/** A vault with one board and some tagged notes; frontmatter writes go through `processFrontMatter`. */
function vault(notes: Record<string, Record<string, unknown>>, automations: Automation[] = [START, END]) {
  const board = mkFile('Backlog.board');
  const text = JSON.stringify({ sourceTag: 'backlog', views: [], properties: PROPS, automations });
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
  const watcher = new AutomationWatcher(app, () => [board], () => NOW);
  return { watcher, writes, notes };
}

describe('AutomationWatcher', () => {
  it('does not touch notes on startup, then runs on a real change', async () => {
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

  it('runs one step deep: an effect never sets off another automation', async () => {
    const done: Automation = { id: 'd', triggers: [{ property: 'status', op: 'becomes', values: ['completed'] }], effects: [{ property: 'owned', op: 'check' }] };
    const own: Automation = { id: 'o', triggers: [{ property: 'owned', op: 'checked' }], effects: [{ property: 'score', op: 'set', value: 10 }] };
    const { watcher, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'playing' } }, [done, own]);
    await watcher.scan();
    notes['G/A.md'].status = 'completed';
    await watcher.noteChanged(mkFile('G/A.md'));
    // The metadata cache reports the watcher's own write as a change.
    await watcher.noteChanged(mkFile('G/A.md'));
    expect(notes['G/A.md'].owned).toBe(true);
    expect(notes['G/A.md'].score).toBeUndefined();
  });

  it('keeps the first start date when a game is resumed, and follows renames', async () => {
    const { watcher, writes, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'on-hold', 'start-date': '2026-03-01' } });
    await watcher.scan();
    notes['G/B.md'] = notes['G/A.md'];
    delete notes['G/A.md'];
    watcher.renamed('G/A.md', mkFile('G/B.md'));
    await watcher.noteChanged(mkFile('G/B.md'));
    expect(writes).toEqual([]);
    notes['G/B.md'].status = 'playing';
    await watcher.noteChanged(mkFile('G/B.md'));
    expect(notes['G/B.md']['start-date']).toBe('2026-03-01');
  });

  it('clears a value when an effect says so', async () => {
    const drop: Automation = { id: 'x', triggers: [{ property: 'status', op: 'becomes', values: ['dropped'] }], effects: [{ property: 'score', op: 'clear' }] };
    const { watcher, notes } = vault({ 'G/A.md': { tags: ['backlog'], status: 'playing', score: 7 } }, [drop]);
    await watcher.scan();
    notes['G/A.md'].status = 'dropped';
    await watcher.noteChanged(mkFile('G/A.md'));
    expect('score' in notes['G/A.md']).toBe(false);
  });
});
