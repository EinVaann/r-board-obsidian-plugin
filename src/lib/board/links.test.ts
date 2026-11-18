// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../../types/database';
import { boardSubpath, linkableView, parseBoardLink, viewForLink } from './links';

const config = {
  views: [
    { name: 'Lanes', type: 'kanban' },
    { name: 'All rows', type: 'table' },
    { name: 'Spend', type: 'chart' },
    { name: 'Recent', type: 'table' },
  ],
} as unknown as DatabaseConfig;

describe('board links', () => {
  it('reads a view, a row, or both from the subpath', () => {
    expect(parseBoardLink('#Lanes')).toEqual({ view: 'Lanes' });
    expect(parseBoardLink('#^r1a2b3')).toEqual({ row: 'r1a2b3' });
    expect(parseBoardLink('#All rows#^r1a2b3')).toEqual({ view: 'All rows', row: 'r1a2b3' });
    expect(parseBoardLink('')).toEqual({});
  });

  it('writes the subpath back', () => {
    expect(boardSubpath({ view: 'All rows', row: 'r1' })).toBe('#All rows#^r1');
    expect(boardSubpath({ row: 'r1' })).toBe('#^r1');
    expect(parseBoardLink(boardSubpath({ view: 'Spend' }))).toEqual({ view: 'Spend' });
  });

  it('picks the view: exact name, then any case; unknown names stay put', () => {
    expect(viewForLink(config, 'Lanes', { view: 'Spend' })).toBe('Spend');
    expect(viewForLink(config, 'Lanes', { view: 'all ROWS' })).toBe('All rows');
    expect(viewForLink(config, 'Lanes', { view: 'Nope' })).toBeUndefined();
  });

  it('shows a row in a table view: the named one, the current one, else the first', () => {
    expect(viewForLink(config, 'Lanes', { view: 'Recent', row: 'r1' })).toBe('Recent');
    expect(viewForLink(config, 'Recent', { row: 'r1' })).toBeUndefined();
    expect(viewForLink(config, 'Lanes', { row: 'r1' })).toBe('All rows');
    expect(viewForLink(config, 'Lanes', { view: 'Spend', row: 'r1' })).toBe('All rows');
  });

  it('refuses view names that would break a link', () => {
    expect(linkableView('Q1 spend')).toBe(true);
    for (const bad of ['A#B', 'A^B', 'A|B', 'A[B]']) expect(linkableView(bad)).toBe(false);
  });
});
