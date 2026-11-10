import { describe, expect, it } from 'vitest';
import type { ScheduleItem, ScheduleSettings, Session } from './types';
import { DEFAULT_SETTINGS } from './types';
import { forecast } from './engine';
import { clash, penalty, randomCandidate, rankCandidates } from './rules';
import { fromDay, toDay, weekStart } from './dates';
import REAL from './fixture.json';

const TODAY = '2026-11-05'; // a Thursday
const S = (o: Partial<ScheduleSettings> = {}): ScheduleSettings => ({ ...DEFAULT_SETTINGS, ...o });
const item = (id: string, o: Partial<ScheduleItem> = {}): ScheduleItem => ({ id, title: id, state: 'pool', duration: 10, score: 5, vary: [], ...o });

/** Lane entries as `title@endEarly` per lane. */
const plan = (items: ScheduleItem[], sessions: Session[] = [], settings = S()) =>
  forecast(items, sessions, settings, TODAY).lanes.map((l) => l.map((e) => e.item));

describe('dates', () => {
  it('round-trips days and finds week starts', () => {
    const d = toDay(TODAY)!;
    expect(fromDay(d)).toBe(TODAY);
    expect(fromDay(weekStart(d, 'mon'))).toBe('2026-11-02');
    expect(fromDay(weekStart(d, 'sun'))).toBe('2026-11-01');
    expect(fromDay(weekStart(toDay('2026-11-02')!, 'mon'))).toBe('2026-11-02');
  });
});

describe('rules', () => {
  const jrpg = item('a', { title: 'Ex Astris', vary: ['JRPG'] });
  const vn = item('b', { title: 'Fata Morgana', vary: ['Visual novel'] });
  const both = item('c', { vary: ['Visual novel', 'RTS'] });

  it('clashes on any shared value, case-insensitively', () => {
    expect(clash(vn, both, [])).toEqual({ kind: 'same', label: 'Visual novel' });
    expect(clash(item('x', { vary: ['jrpg'] }), jrpg, [])?.kind).toBe('same');
    expect(clash(jrpg, vn, [])).toBeNull();
  });

  it('clashes on values in the same similar group', () => {
    expect(clash(jrpg, vn, [['JRPG', 'Visual novel']])).toEqual({ kind: 'similar', label: 'JRPG ≈ Visual novel' });
  });

  it('penalises instead of forbidding: running, previous, long, similar', () => {
    const s = S({ similar: [['JRPG', 'Visual novel']] });
    expect(penalty(item('p', { vary: ['JRPG'] }), [jrpg], null, s)).toEqual({ total: 3, reasons: ['JRPG, like Ex Astris (running)'] });
    expect(penalty(item('p', { vary: ['JRPG'] }), [], jrpg, s).total).toBe(2);
    expect(penalty(item('p', { vary: ['Visual novel'] }), [jrpg], null, s).total).toBe(1.5);
    expect(penalty(item('p', { duration: 65 }), [item('x', { title: 'Xeno', duration: 56 })], null, s)).toEqual({ total: 4, reasons: ['second long game next to Xeno'] });
    expect(penalty(item('p', { duration: 65 }), [item('x', { duration: 20 })], null, s).total).toBe(0);
  });

  it('ranks by score minus penalty, so a strong match can still win', () => {
    const ranked = rankCandidates([item('hi', { score: 9, vary: ['JRPG'] }), item('lo', { score: 6 })], [jrpg], null, S());
    expect(ranked.map((r) => r.item)).toEqual(['hi', 'lo']); // 9 - 3 = 6 ties with 6; higher score wins the tie
    const weaker = rankCandidates([item('hi', { score: 8, vary: ['JRPG'] }), item('lo', { score: 6 })], [jrpg], null, S());
    expect(weaker.map((r) => r.item)).toEqual(['lo', 'hi']);
    expect(weaker[1].reasons[0]).toMatch(/JRPG, like Ex Astris/);
  });

  it('random picks among the least penalised candidates', () => {
    const ranked = [{ item: 'ok', penalty: 0, reasons: [] }, { item: 'bad', penalty: 3, reasons: ['x'] }];
    expect(randomCandidate(ranked, () => 0.99)?.item).toBe('ok');
    expect(randomCandidate([ranked[1]], () => 0)?.item).toBe('bad');
  });
});

describe('forecast', () => {
  it('puts active items in lanes and fills by score without repeating genres', () => {
    const items = [
      item('A', { state: 'active', vary: ['JRPG'], start: '2026-11-01' }),
      item('B', { state: 'active', vary: ['Metroidvania'], start: '2026-11-02' }),
      item('jrpg', { score: 9, vary: ['JRPG'] }),
      item('mv', { score: 8.5, vary: ['Metroidvania'] }),
      item('puzzle', { score: 8, vary: ['Puzzle'] }),
    ];
    const lanes = plan(items);
    // Each lane starts with its active item; no lane gets two of one genre in a row.
    expect(lanes.map((l) => l[0])).toEqual(['A', 'B']);
    expect(lanes.flat().sort()).toEqual(['A', 'B', 'jrpg', 'mv', 'puzzle']);
    for (const l of lanes) for (let i = 1; i < l.length; i++) expect([l[i - 1], l[i]].sort()).not.toEqual(['A', 'jrpg']);
  });

  it('prefers not to run two long games together', () => {
    const items = [
      item('long1', { state: 'active', duration: 60 }),
      item('short1', { state: 'active', duration: 5 }),
      item('long2', { duration: 50, score: 7 }),
      item('short2', { duration: 5, score: 5 }),
    ];
    const f = forecast(items, [], S(), TODAY);
    // long2 (7 - 4 = 3) ranks below short2 (5) while long1 runs.
    expect(f.lanes[1].map((e) => e.item).slice(0, 2)).toEqual(['short1', 'short2']);
  });

  it('a much better game still goes next despite the penalty', () => {
    const items = [
      item('long1', { state: 'active', duration: 60 }),
      item('short1', { state: 'active', duration: 5 }),
      item('long2', { duration: 50, score: 10 }),
      item('short2', { duration: 5, score: 5 }),
    ];
    const entry = forecast(items, [], S(), TODAY).lanes[1][1];
    expect(entry).toMatchObject({ item: 'long2', penalty: 4 });
    expect(entry.reasons).toEqual(['second long game next to long1']);
  });

  it('places a game even when every option is penalised', () => {
    const items = [item('A', { state: 'active', vary: ['JRPG'] }), item('B', { state: 'active', vary: ['JRPG'] }), item('C', { vary: ['JRPG'] })];
    const entry = forecast(items, [], S(), TODAY).lanes.flat().find((e) => e.item === 'C')!;
    expect(entry.penalty).toBeGreaterThan(0);
    expect(entry.reasons.join()).toMatch(/JRPG/);
  });

  it('logged lane hours shorten an item, and finishing sooner moves the next one up', () => {
    const items = [item('A', { state: 'active', duration: 20 }), item('next')];
    const base = forecast(items, [], S({ lanes: 1 }), TODAY);
    const played = forecast(items, [{ item: 'A', date: '2026-11-04', hours: 15 }], S({ lanes: 1 }), TODAY);
    expect(played.lanes[0][0].remaining).toBe(5);
    expect(played.lanes[0][1].start.early < base.lanes[0][1].start.early).toBe(true);
  });

  it('marks an item played past its estimate, without dropping it', () => {
    const f = forecast([item('A', { state: 'active', duration: 10 })], [{ item: 'A', date: '2026-11-04', hours: 14 }], S(), TODAY);
    expect(f.lanes[0][0]).toMatchObject({ item: 'A', overEstimate: true });
    expect(f.lanes[0][0].remaining).toBeGreaterThan(0);
  });

  it('counts only logged hours: an empty week lowers pace once history exists', () => {
    // Four past weeks: one played week of 20h, three empty.
    const sessions: Session[] = [{ item: 'A', date: '2026-10-06', hours: 20 }, { item: 'A', date: '2026-11-01', hours: 0 }];
    const items = [item('A', { state: 'active', duration: 100, start: '2026-10-01' })];
    const f = forecast(items, sessions, S({ estimates: { weekly: 19, live: 0 } }), TODAY);
    expect(f.pace.history).toBe(4);
    expect(f.pace.weekly).toBe(5);
  });

  it('blends with the estimates while history is short', () => {
    const f = forecast([item('A', { state: 'active' })], [], S({ estimates: { weekly: 19, live: 4 } }), TODAY);
    expect(f.pace).toMatchObject({ weekly: 19, live: 4, lane: 15, history: 0 });
  });

  it('live and detour time come off the lane pace', () => {
    const items = [item('A', { state: 'active', duration: 100, start: '2026-10-01' }), item('G', { state: 'live' }), item('H', { state: 'ignored' })];
    const sessions: Session[] = [];
    for (const d of ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']) {
      sessions.push({ item: 'A', date: d, hours: 10 }, { item: 'G', date: d, hours: 4 }, { item: 'H', date: d, hours: 2 });
    }
    // Logged: 10 lane + 4 live + 2 other a week, on top of the 4 h unlogged daily baseline.
    const f = forecast(items, sessions, S(), TODAY);
    expect(f.pace).toMatchObject({ weekly: 20, live: 8, other: 2, lane: 10, history: 4 });
    expect(f.live).toEqual([{ item: 'G', weekly: 8 }]);
  });

  it('keeps the live baseline when gacha dailies are never logged', () => {
    const items = [item('A', { state: 'active', duration: 100, start: '2026-10-01' }), item('G1', { state: 'live' }), item('G2', { state: 'live' })];
    const sessions = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map((d) => ({ item: 'A', date: d, hours: 12 }));
    const f = forecast(items, sessions, S({ estimates: { weekly: 19, live: 3 } }), TODAY);
    // Lane time is all that was logged; the 3 h of dailies don't take from it.
    expect(f.pace).toMatchObject({ weekly: 15, live: 3, lane: 12 });
    expect(f.live.map((l) => l.weekly)).toEqual([1.5, 1.5]);
  });

  it('infers types: trial when written, detour before an item started', () => {
    const items = [item('A', { state: 'active', start: '2026-11-03' })];
    const f = forecast(items, [{ item: 'A', date: '2026-11-02', hours: 2 }, { item: 'A', date: '2026-11-04', hours: 3 }, { item: 'X', date: '2026-11-04', hours: 1, type: 'trial' }], S(), TODAY);
    expect(f.week.logged).toEqual({ lane: 3, live: 0, detour: 2, trial: 1 });
    // Mon Nov 2: 2 h; Wed Nov 4: 3 + 1 h; Thursday (today) and later: nothing yet.
    expect(f.week.days).toEqual([2, 0, 4, 0, 0, 0, 0]);
  });

  it('suggests a week split that gives a nearly-done item what it needs', () => {
    const items = [item('A', { state: 'active', duration: 50 }), item('B', { state: 'active', duration: 12 })];
    const f = forecast(items, [{ item: 'B', date: '2026-10-20', hours: 10 }], S({ estimates: { weekly: 19, live: 4 } }), TODAY);
    const split = Object.fromEntries(f.week.suggested.map((s) => [s.item, s.hours]));
    expect(split.B).toBe(2);
    expect(split.A + split.B).toBeCloseTo(f.pace.lane, 0);
  });

  it('places pins at their position, even when penalised, with the reasons', () => {
    const items = [
      item('A', { state: 'active', vary: ['JRPG'], duration: 30 }),
      item('B', { state: 'active', vary: ['Puzzle'] }),
      item('p3r', { vary: ['JRPG'], score: 1 }),
      item('x', { score: 9 }),
    ];
    const f = forecast(items, [], S({ pins: [{ item: 'p3r', lane: 1, position: 0 }] }), TODAY);
    expect(f.lanes[1].map((e) => e.item).slice(0, 2)).toEqual(['B', 'p3r']);
    expect(f.lanes[1][1]).toMatchObject({ pinned: true });
    expect(f.lanes[1][1].penalty).toBeGreaterThan(0);
    expect(f.lanes[1][1].reasons.join()).toMatch(/JRPG/);
  });

  it('holds a pin until its not-before date', () => {
    const items = [item('A', { state: 'active', duration: 2 }), item('dlc', { duration: 5 })];
    const f = forecast(items, [], S({ lanes: 1, pins: [{ item: 'dlc', lane: 0, position: 0, notBefore: '2026-12-08' }] }), TODAY);
    const dlc = f.lanes[0].find((e) => e.item === 'dlc')!;
    expect(dlc.start.early >= '2026-12-08').toBe(true);
  });

  it('flags an active item paused after weeks without lane time', () => {
    const items = [item('A', { state: 'active', start: '2026-09-01' })];
    const f = forecast(items, [{ item: 'A', date: '2026-10-01', hours: 1 }], S(), TODAY);
    expect(f.lanes[0][0].paused).toBe(true);
  });

  it('keeps extra active items out of the lanes', () => {
    const items = [item('A', { state: 'active', start: '2026-10-01' }), item('B', { state: 'active', start: '2026-10-02' }), item('C', { state: 'active', start: '2026-10-03' })];
    expect(forecast(items, [], S(), TODAY).overflow).toEqual(['C']);
  });

  it('learns the overrun from finished items', () => {
    const done = Array.from({ length: 5 }, (_, i) => item(`d${i}`, { state: 'ended', finished: true, duration: 10, start: '2026-01-01', end: '2026-02-01' }));
    const sessions = done.map((d) => ({ item: d.id, date: '2026-01-15', hours: 15 }));
    expect(forecast(done, sessions, S(), TODAY).overrun).toBe(1.5);
    expect(forecast([], [], S(), TODAY).overrun).toBe(1.3);
  });

  it('gives ranges: late ends after early ends', () => {
    const f = forecast([item('A', { state: 'active', duration: 30 }), item('B')], [], S({ lanes: 1 }), TODAY);
    for (const e of f.lanes[0]) expect(e.end.late > e.end.early).toBe(true);
    expect(f.finish!.late > f.finish!.early).toBe(true);
  });
});

describe('forecast on a snapshot of the real backlog', () => {
  const items: ScheduleItem[] = (REAL as { id: string; title: string; status: string; genre: string[]; duration: number; score: number; live?: boolean }[]).map((r) => ({
    id: r.id,
    title: r.title,
    state: r.status === 'planned' ? 'pool' : r.live ? 'live' : 'active',
    duration: r.duration,
    score: r.score,
    vary: r.genre,
  }));
  const settings = S({ similar: [['JRPG', 'Visual novel']] });
  const f = forecast(items, [{ item: 'Ender Magnolia Bloom in the Mist', date: '2026-10-27', hours: 12 }], settings, TODAY);

  it('schedules every planned game once', () => {
    const scheduled = f.lanes.flat().map((e) => e.item);
    expect(new Set(scheduled).size).toBe(scheduled.length);
    const expected = items.filter((i) => i.state === 'pool' || (i.state === 'active' && !f.overflow.includes(i.id))).map((i) => i.id);
    expect(scheduled.sort()).toEqual(expected.sort());
  });

  it('keeps live games and the palette cleanser out of the lanes', () => {
    expect(f.live.map((l) => l.item).sort()).toEqual(['Arknights', 'Arknights Endfield', 'Reverse 1999']);
    expect(f.overflow).toEqual(['Is this Seat Taken']);
  });

  it('never runs two long games at once, and finishes within a few years', () => {
    const long = (id: string) => (items.find((i) => i.id === id)!.duration ?? 0) > settings.longOver;
    const spans = f.lanes.flatMap((l, n) => l.filter((e) => long(e.item)).map((e) => ({ n, a: e.start.early, b: e.end.early })));
    for (const x of spans) for (const y of spans) if (x.n !== y.n) expect(x.b <= y.a || y.b <= x.a).toBe(true);
    expect(f.finish!.late < '2030-01-01').toBe(true);
  });

  it('mostly avoids penalised picks', () => {
    const penalised = f.lanes.flat().filter((e) => e.penalty > 0);
    expect(penalised.length).toBeLessThanOrEqual(6);
    for (const e of penalised) expect(e.reasons.length).toBeGreaterThan(0);
  });
});
