import { describe, expect, it } from 'vitest';
import type { DatabaseConfig, ScheduleSection } from '../types';
import { addSideSection, defaultSections, fixedSections, matchSection, moveWrites, sectionProblems } from './sections';

const BOARD = {
  sourceTag: 'b',
  views: [],
  properties: [
    { name: 'status', type: 'select', options: ['planned', 'playing', 'completed', 'dropped', 'on-hold', 'wishlist'].map((value) => ({ value })) },
    { name: 'live-service', type: 'checkbox' },
    { name: 'casual', type: 'checkbox' },
    { name: 'genre', type: 'multi' },
  ],
} as DatabaseConfig;
const SECTIONS = defaultSections(BOARD, {});
const at = (name: string): number => SECTIONS.findIndex((s) => s.name === name);

describe('default sections', () => {
  it('guesses live, also playing, lanes, queue and the ends from the board', () => {
    expect(SECTIONS.map((s) => `${s.name}:${s.kind}`)).toEqual([
      'Live:live',
      'Also playing:side',
      'Lanes:lanes',
      'Queue:queue',
      'On hold:hidden',
      'Completed:finished',
      'Dropped:dropped',
    ]);
    expect(SECTIONS[1].conditions).toEqual([{ property: 'status', op: 'is', value: 'playing' }, { property: 'casual', op: 'checked' }]);
  });

  it('carries over the old status roles and live checkbox', () => {
    const s = defaultSections(BOARD, { status: 'status', live: 'live-service', statuses: { pool: ['planned', 'wishlist'], active: ['playing'], finished: ['completed'], dropped: [], paused: [] } });
    expect(s.find((x) => x.kind === 'queue')!.conditions).toEqual([{ property: 'status', op: 'anyOf', value: ['planned', 'wishlist'] }]);
    expect(s.map((x) => x.kind)).not.toContain('dropped');
  });
});

describe('matching', () => {
  it('takes the first section that matches', () => {
    expect(matchSection({ status: 'playing', 'live-service': true, casual: true }, SECTIONS)).toBe(at('Live'));
    expect(matchSection({ status: 'playing', casual: true }, SECTIONS)).toBe(at('Also playing'));
    expect(matchSection({ status: 'playing' }, SECTIONS)).toBe(at('Lanes'));
    expect(matchSection({ status: 'wishlist' }, SECTIONS)).toBe(-1);
  });
});

describe('move writes', () => {
  it('writes the target conditions', () => {
    expect(moveWrites({ status: 'playing', casual: true }, SECTIONS, at('Queue'))).toEqual({ status: 'planned' });
    expect(moveWrites({ status: 'playing' }, SECTIONS, at('Completed'))).toEqual({ status: 'completed' });
    expect(moveWrites({ status: 'planned' }, SECTIONS, at('Also playing'))).toEqual({ status: 'playing', casual: true });
  });

  it('unticks checkboxes so a section above stops catching the item', () => {
    // Also playing → Lanes: status already playing, but casual must go.
    expect(moveWrites({ status: 'playing', casual: true }, SECTIONS, at('Lanes'))).toEqual({ casual: false });
    expect(moveWrites({ status: 'planned', 'live-service': true, casual: true }, SECTIONS, at('Lanes'))).toEqual({ status: 'playing', 'live-service': false, casual: false });
  });

  it('writes the first value of an "any of" condition', () => {
    const s: ScheduleSection[] = [{ name: 'Done', kind: 'finished', conditions: [{ property: 'status', op: 'anyOf', value: ['completed', 'dropped'] }] }];
    expect(moveWrites({ status: 'playing' }, s, 0)).toEqual({ status: 'completed' });
    expect(moveWrites({ status: 'dropped' }, s, 0)).toEqual({});
  });

  it('refuses a move a section above would still catch', () => {
    const s: ScheduleSection[] = [
      { name: 'All playing', kind: 'live', conditions: [{ property: 'status', op: 'is', value: 'playing' }] },
      { name: 'Lanes', kind: 'lanes', conditions: [{ property: 'status', op: 'is', value: 'playing' }] },
    ];
    expect(moveWrites({ status: 'planned' }, s, 1)).toBeNull();
  });
});

describe('fixed sections', () => {
  it('keeps one of each kind, named after it, and adds missing kinds switched off', () => {
    const s: ScheduleSection[] = [
      { name: 'Now', kind: 'lanes', conditions: [{ property: 'status', op: 'is', value: 'playing' }] },
      { name: 'Done', kind: 'finished', conditions: [{ property: 'status', op: 'is', value: 'completed' }] },
      { name: 'Extra lanes', kind: 'lanes', conditions: [] },
    ];
    const out = fixedSections(s);
    expect(out.map((x) => x.kind)).toEqual(['live', 'side', 'lanes', 'queue', 'hidden', 'finished', 'dropped']);
    expect(out.map((x) => x.name)).toEqual(['Live', 'Also playing', 'Lanes', 'Queue', 'On hold', 'Completed', 'Dropped']);
    expect(out[2].conditions).toEqual(s[0].conditions);
    expect(out.filter((x) => x.conditions.length === 0).map((x) => x.kind)).toEqual(['live', 'side', 'queue', 'hidden', 'dropped']);
  });

  it('keeps a reordered list in its order', () => {
    const order = fixedSections(SECTIONS).reverse();
    expect(fixedSections(order).map((x) => x.kind)).toEqual(order.map((x) => x.kind));
  });

  it('a section with no conditions takes nothing', () => {
    const s = fixedSections(SECTIONS.filter((x) => x.kind !== 'live'));
    expect(matchSection({ status: 'playing', 'live-service': true }, s)).toBe(s.findIndex((x) => x.kind === 'lanes'));
  });
});

describe('problems', () => {
  it('is quiet for the defaults', () => {
    expect(sectionProblems(BOARD, SECTIONS)).toEqual([]);
  });

  it('asks for lanes and a queue, and flags sections that block moves', () => {
    const s: ScheduleSection[] = [
      { name: 'All playing', kind: 'live', conditions: [{ property: 'status', op: 'is', value: 'playing' }] },
      { name: 'Lanes', kind: 'lanes', conditions: [{ property: 'status', op: 'is', value: 'playing' }] },
    ];
    const p = sectionProblems(BOARD, s);
    expect(p.some((x) => /Give Queue a condition/.test(x))).toBe(true);
    expect(p.some((x) => /blocked by "All playing"/.test(x))).toBe(true);
  });

  it('rejects properties that are not select or checkbox', () => {
    const s: ScheduleSection[] = [{ name: 'X', kind: 'hidden', conditions: [{ property: 'genre', op: 'is', value: 'JRPG' }] }];
    expect(sectionProblems(BOARD, s).some((x) => /only select and checkbox/.test(x))).toBe(true);
  });
});

describe('adding a side section', () => {
  const noCasual = { ...BOARD, properties: BOARD.properties.filter((p) => p.name !== 'casual') } as DatabaseConfig;
  const base = defaultSections(noCasual, {});

  it('goes above the lanes with a new casual checkbox, and a playing game moves there', () => {
    const added = addSideSection(noCasual, base)!;
    expect(added.property).toEqual({ name: 'casual', label: 'Casual', type: 'checkbox' });
    expect(added.sections.map((s) => s.kind)).toEqual(['live', 'side', 'lanes', 'queue', 'hidden', 'finished', 'dropped']);
    expect(moveWrites({ status: 'playing' }, added.sections, added.index)).toEqual({ casual: true });
    expect(moveWrites({ status: 'planned' }, added.sections, added.index)).toEqual({ status: 'playing', casual: true });
  });

  it('reuses an unused casual checkbox and is skipped when a side section exists', () => {
    expect(addSideSection(BOARD, SECTIONS)).toBeNull();
    expect(addSideSection(BOARD, SECTIONS.filter((s) => s.kind !== 'side'))!.property).toBeNull();
  });
});
