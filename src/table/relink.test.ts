import { describe, expect, it } from 'vitest';
import type { TableRow } from '../types';
import { relinkRows, relinkText, targetsPath, type Relink } from './relink';

const OLD = 'Games/Backlog Items/Ender Magnolia.md';
const r = (resolves: string[] = []): Relink => ({ oldPath: OLD, linkText: 'Backlog Items/Ender Magnolia Bloom', resolves: (t) => resolves.includes(t) });

describe('targetsPath', () => {
  it('matches full paths with or without .md, and trailing segments', () => {
    expect(targetsPath('Games/Backlog Items/Ender Magnolia', OLD)).toBe(true);
    expect(targetsPath('Games/Backlog Items/Ender Magnolia.md', OLD)).toBe(true);
    expect(targetsPath('Backlog Items/Ender Magnolia', OLD)).toBe(true);
    expect(targetsPath('Ender Magnolia', OLD)).toBe(true);
    expect(targetsPath('ender magnolia', OLD)).toBe(true);
  });

  it('does not match other notes', () => {
    expect(targetsPath('Magnolia', OLD)).toBe(false);
    expect(targetsPath('Ender Magnolia 2', OLD)).toBe(false);
    expect(targetsPath('', OLD)).toBe(false);
  });
});

describe('relinkText', () => {
  it('rewrites the target and keeps alias, heading and embed', () => {
    expect(relinkText('[[Backlog Items/Ender Magnolia|Ender Magnolia]]', r())).toBe('[[Backlog Items/Ender Magnolia Bloom|Ender Magnolia]]');
    expect(relinkText('[[Ender Magnolia#Notes]]', r())).toBe('[[Backlog Items/Ender Magnolia Bloom#Notes]]');
    expect(relinkText('![[Ender Magnolia]]', r())).toBe('![[Backlog Items/Ender Magnolia Bloom]]');
  });

  it('rewrites only matching links in mixed text', () => {
    expect(relinkText('see [[Ender Magnolia]] and [[Hades]]', r())).toBe('see [[Backlog Items/Ender Magnolia Bloom]] and [[Hades]]');
  });

  it('leaves links that still resolve to another note', () => {
    expect(relinkText('[[Ender Magnolia]]', r(['Ender Magnolia']))).toBeNull();
  });

  it('returns null when nothing changed', () => {
    expect(relinkText('[[Hades]]', r())).toBeNull();
    expect(relinkText('plain text', r())).toBeNull();
  });
});

describe('relinkRows', () => {
  it('rewrites string and list cells, counting changed cells', () => {
    const rows: TableRow[] = [
      { id: 'a', cells: { game: ['[[Backlog Items/Ender Magnolia|Ender Magnolia]]'], hours: 1.2 } },
      { id: 'b', cells: { game: ['[[Hades]]'], note: 'after [[Ender Magnolia]]' } },
    ];
    expect(relinkRows(rows, r())).toBe(2);
    expect(rows[0].cells.game).toEqual(['[[Backlog Items/Ender Magnolia Bloom|Ender Magnolia]]']);
    expect(rows[0].cells.hours).toBe(1.2);
    expect(rows[1].cells.game).toEqual(['[[Hades]]']);
    expect(rows[1].cells.note).toBe('after [[Backlog Items/Ender Magnolia Bloom]]');
  });
});
