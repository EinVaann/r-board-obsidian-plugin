import { describe, expect, it } from 'vitest';
import type { ScheduleItem, ScheduleSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { forecast } from './engine';
import { nextCandidates } from './next';
import { livePins, movedPins, placePin, replan, setNotBefore, unpin } from './pins';

const TODAY = '2026-11-05';
const S = (o: Partial<ScheduleSettings> = {}): ScheduleSettings => ({ ...DEFAULT_SETTINGS, ...o });
const item = (id: string, o: Partial<ScheduleItem> = {}): ScheduleItem => ({ id, title: id, state: 'pool', duration: 10, score: 5, vary: [], ...o });

describe('pins', () => {
  it('places a pin and pushes later pins in that lane down', () => {
    const pins = [{ item: 'a', lane: 0, position: 0 }, { item: 'b', lane: 0, position: 1 }, { item: 'c', lane: 1, position: 0 }];
    expect(placePin(pins, 'x', 0, 1)).toEqual([{ item: 'a', lane: 0, position: 0 }, { item: 'b', lane: 0, position: 2 }, { item: 'c', lane: 1, position: 0 }, { item: 'x', lane: 0, position: 1 }]);
  });

  it('moving a pin keeps its not-before date', () => {
    const moved = placePin([{ item: 'dlc', lane: 0, position: 0, notBefore: '2027-01-01' }], 'dlc', 1, 2);
    expect(moved).toEqual([{ item: 'dlc', lane: 1, position: 2, notBefore: '2027-01-01' }]);
  });

  it('sets and clears not-before, pinning an unpinned item where it is', () => {
    const set = setNotBefore([], 'x', 1, 3, '2027-02-01');
    expect(set).toEqual([{ item: 'x', lane: 1, position: 3, notBefore: '2027-02-01' }]);
    expect(setNotBefore(set, 'x', 0, 0, null)).toEqual([{ item: 'x', lane: 1, position: 3 }]);
  });

  it('re-plans one lane or all, keeping not-before holds', () => {
    const pins = [{ item: 'a', lane: 0, position: 0 }, { item: 'b', lane: 1, position: 0 }, { item: 'dlc', lane: 0, position: 1, notBefore: '2027-01-01' }];
    expect(replan(pins, 0)).toEqual([pins[1], pins[2]]);
    expect(replan(pins)).toEqual([pins[2]]);
    expect(movedPins(pins, 1)).toBe(1);
    expect(movedPins(pins)).toBe(2);
  });

  it('unpins and drops pins of items no longer waiting', () => {
    const pins = [{ item: 'a', lane: 0, position: 0 }, { item: 'b', lane: 0, position: 1 }];
    expect(unpin(pins, 'a')).toEqual([{ item: 'b', lane: 0, position: 1 }]);
    expect(livePins(pins, new Set(['b']))).toEqual([{ item: 'b', lane: 0, position: 1 }]);
  });
});

describe('lane assignment', () => {
  it('keeps a running item in its assigned lane', () => {
    const items = [item('early', { state: 'active', start: '2026-10-01' }), item('late', { state: 'active', start: '2026-11-01' })];
    expect(forecast(items, [], S(), TODAY).lanes.map((l) => l[0].item)).toEqual(['early', 'late']);
    expect(forecast(items, [], S({ assign: { late: 0 } }), TODAY).lanes.map((l) => l[0].item)).toEqual(['late', 'early']);
  });

  it('leaves the other lane free when its game ended, so the next pick goes there', () => {
    const items = [item('stays', { state: 'active' }), item('next', { score: 9 })];
    const f = forecast(items, [], S({ assign: { stays: 1 } }), TODAY);
    expect(f.lanes[1][0]).toMatchObject({ item: 'stays', current: true });
    expect(f.lanes[0][0]).toMatchObject({ item: 'next', current: false });
  });

  it('a side game (-1) stays out of a lane that frees up', () => {
    const items = [item('a', { state: 'active' }), item('side', { state: 'active' }), item('next', { score: 9 })];
    const f = forecast(items, [], S({ assign: { a: 0, side: -1 } }), TODAY);
    expect(f.overflow).toEqual(['side']);
    expect(f.lanes[1][0]).toMatchObject({ item: 'next', current: false });
  });

  it('an assignment past the lane count falls back to a free lane', () => {
    const f = forecast([item('a', { state: 'active' })], [], S({ assign: { a: 5 } }), TODAY);
    expect(f.lanes[0][0].item).toBe('a');
  });
});

describe('next candidates', () => {
  it('ranks waiting items against the other lane and what just ended here', () => {
    const items = [
      item('ended', { state: 'ended', vary: ['JRPG'] }),
      item('other', { state: 'active', vary: ['Puzzle'] }),
      item('jrpg', { score: 9, vary: ['JRPG'] }),
      item('puzzle', { score: 8.5, vary: ['Puzzle'] }),
      item('fresh', { score: 7.5, vary: ['Racing'] }),
    ];
    const settings = S({ assign: { other: 1 } });
    const result = forecast(items, [], settings, TODAY);
    const ranked = nextCandidates(items, result, 0, 'ended', settings);
    expect(ranked.map((r) => r.item)).toEqual(['fresh', 'jrpg', 'puzzle']);
    expect(ranked[1].reasons).toEqual(['JRPG, like ended (just before)']);
    expect(ranked[2].reasons).toEqual(['Puzzle, like other (running)']);
  });
});
