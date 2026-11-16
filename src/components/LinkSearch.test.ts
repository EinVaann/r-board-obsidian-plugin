// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { isLinkText, searchFiles } from './LinkSearch';
import { typedLink } from './LinksEditor';
import { linkTo, parseLink } from '../render/values';

const f = (p: string): TFile => new (TFile as unknown as new (p: string) => TFile)(p);
const files = ['Backlog Items/Reverse 1999.md', 'Games/Reverse Collapse.md', 'Notes/About reverse.md', 'Art/reverse.png', 'Hades.md'].map(f);

describe('searchFiles', () => {
  it('puts names that start with the query first, notes before other files', () => {
    expect(searchFiles(files, 'rev').map((x) => x.path)).toEqual(['Backlog Items/Reverse 1999.md', 'Games/Reverse Collapse.md', 'Art/reverse.png', 'Notes/About reverse.md']);
  });

  it('matches every word anywhere in the path', () => {
    expect(searchFiles(files, 'backlog 1999').map((x) => x.path)).toEqual(['Backlog Items/Reverse 1999.md']);
    expect(searchFiles(files, '   ')).toEqual([]);
  });

  it('can be limited to some files', () => {
    expect(searchFiles(files, 'rev', (x) => x.extension === 'png').map((x) => x.path)).toEqual(['Art/reverse.png']);
  });
});

describe('typed links', () => {
  it('keeps links and URLs, wraps names', () => {
    expect(isLinkText('[[Hades]]')).toBe(true);
    expect(isLinkText('https://x.org')).toBe(true);
    expect(typedLink(' Hades ')).toBe('[[Hades]]');
    expect(typedLink('[[Games/Hades|Hades]]')).toBe('[[Games/Hades|Hades]]');
  });
});

describe('links show the note name', () => {
  it('uses the alias, else the name without folders', () => {
    expect(parseLink('[[Backlog Items/Reverse 1999|R99]]')?.text).toBe('R99');
    expect(parseLink('[[Backlog Items/Reverse 1999]]')?.text).toBe('Reverse 1999');
    expect(parseLink('[[Backlog Items/Reverse 1999.md#Notes]]')).toMatchObject({ text: 'Reverse 1999', linkpath: 'Backlog Items/Reverse 1999.md' });
    expect(parseLink('Hades')?.text).toBe('Hades');
  });

  it('labels a picked note only when the link text has folders', () => {
    const app = (full: boolean) => ({ metadataCache: { fileToLinktext: (x: TFile) => (full ? x.path.replace(/\.md$/, '') : x.basename) } }) as unknown as App;
    expect(linkTo(app(true), f('Backlog Items/Reverse 1999.md'), 'Games.table')).toBe('[[Backlog Items/Reverse 1999|Reverse 1999]]');
    expect(linkTo(app(false), f('Backlog Items/Reverse 1999.md'), 'Games.table')).toBe('[[Reverse 1999]]');
    expect(linkTo(app(true), f('Art/cover.png'), 'Games.table', false)).toBe('[[Art/cover.png]]');
  });
});
