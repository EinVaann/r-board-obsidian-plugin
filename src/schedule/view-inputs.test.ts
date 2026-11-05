import { describe, expect, it } from 'vitest';
import type { BoardItem, DatabaseConfig } from '../types';
import { parseDatabaseConfig, serializeDatabase, makeDefaultView } from '../config';
import { defaultScheduleConfig, guessLogColumns, guessSchedule, parseSchedule } from './config';
import { formatRange } from './format';
import { stateOf, toScheduleItems, toSessions } from './inputs';

const sc = { ...defaultScheduleConfig(), status: 'status', live: 'live', duration: 'hours', score: 'score', vary: 'genre', startDate: 'start' };
const it_ = (id: string, values: Record<string, unknown>): BoardItem => ({ id, title: id, values, tags: [] });

describe('schedule config', () => {
  it('fills defaults and clamps bad values', () => {
    const c = parseSchedule({ lanes: 99, weekStart: 'sun', penalties: { running: 5, similarFactor: 7 }, similar: [['JRPG', 'VN'], ['alone']], pins: [{ item: 'x' }, { lane: 1 }] });
    expect(c.lanes).toBe(6);
    expect(c.weekStart).toBe('sun');
    expect(c.penalties).toEqual({ running: 5, previous: 2, long: 4, similarFactor: 1 });
    expect(c.similar).toEqual([['JRPG', 'VN']]);
    expect(c.pins).toEqual([{ item: 'x', lane: 0, position: 0 }]);
    expect(c.statuses.pool).toEqual(['planned']);
  });

  it('round-trips a schedule view through the .board file', () => {
    const view = makeDefaultView('schedule', []);
    view.schedule!.log = 'Log.table';
    const r = parseDatabaseConfig(serializeDatabase({ sourceTag: 'backlog', properties: [], views: [view] }));
    expect(r.ok && r.config.views[0]).toMatchObject({ name: 'Schedule', type: 'schedule', schedule: { log: 'Log.table', lanes: 2 } });
  });

  it('guesses properties by name and type', () => {
    const config = {
      sourceTag: 'b',
      views: [],
      properties: [
        { name: 'status', type: 'select' },
        { name: 'play-hours', type: 'number' },
        { name: 'score', type: 'number' },
        { name: 'genre', type: 'multi' },
        { name: 'live-service', type: 'checkbox' },
        { name: 'start-date', type: 'date' },
        { name: 'end-date', type: 'date' },
      ],
    } as DatabaseConfig;
    expect(guessSchedule(config, defaultScheduleConfig())).toMatchObject({
      status: 'status', duration: 'play-hours', score: 'score', vary: 'genre', live: 'live-service', startDate: 'start-date', endDate: 'end-date',
    });
    expect(guessLogColumns([{ name: 'notes', type: 'links' }, { name: 'h', type: 'number' }, { name: 'd', type: 'date' }], defaultScheduleConfig()))
      .toEqual({ logItem: 'notes', logHours: 'h', logDate: 'd', logType: undefined });
  });
});

describe('schedule inputs', () => {
  it('maps statuses and the live checkbox to states', () => {
    expect(stateOf(it_('a', { status: 'planned' }), sc).state).toBe('pool');
    expect(stateOf(it_('a', { status: 'playing' }), sc).state).toBe('active');
    expect(stateOf(it_('a', { status: 'playing', live: true }), sc).state).toBe('live');
    expect(stateOf(it_('a', { status: 'completed' }), sc)).toEqual({ state: 'ended', finished: true });
    expect(stateOf(it_('a', { status: 'dropped' }), sc)).toEqual({ state: 'ended', finished: false });
    expect(stateOf(it_('a', { status: 'on-hold' }), sc).state).toBe('ignored');
  });

  it('reads items from their values', () => {
    const [x] = toScheduleItems([it_('n.md', { status: 'planned', hours: '12', score: 8, genre: ['JRPG'], start: '2026-11-01T10:00' })], sc);
    expect(x).toMatchObject({ id: 'n.md', state: 'pool', duration: 12, score: 8, vary: ['JRPG'], start: '2026-11-01' });
  });

  it('reads log rows as sessions, resolving links and skipping empty rows', () => {
    const rows = [
      { id: '1', cells: { notes: ['[[Backlog Items/Ex Astris|Ex Astris]]'], h: 1.5, d: '2026-11-03' } },
      { id: '2', cells: { notes: ['[[Gone]]'], h: 2, d: '2026-11-03', t: 'Trial' } },
      { id: '3', cells: { notes: ['[[Ex Astris]]'], h: null, d: '2026-11-03' } },
    ];
    const sessions = toSessions(rows, { logItem: 'notes', logHours: 'h', logDate: 'd', logType: 't' }, (p) => (p.endsWith('Ex Astris') ? 'x.md' : null));
    expect(sessions).toEqual([
      { item: 'x.md', date: '2026-11-03', hours: 1.5 },
      { item: null, date: '2026-11-03', hours: 2, type: 'trial' },
    ]);
  });
});

describe('schedule format', () => {
  it('writes ranges compactly', () => {
    expect(formatRange({ early: '2026-12-18', late: '2026-12-28' }, 2026)).toBe('Dec 18–28');
    expect(formatRange({ early: '2026-12-28', late: '2027-01-04' }, 2026)).toBe('Dec 28, 2026 – Jan 4, 2027');
    expect(formatRange({ early: '2027-02-02', late: '2027-03-01' }, 2026)).toBe('Feb 2 – Mar 1, 2027');
    expect(formatRange({ early: '2026-11-13', late: '2026-11-13' }, 2026)).toBe('Nov 13');
  });
});
