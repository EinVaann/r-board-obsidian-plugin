// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { draftExtension, freePath, imageFromUrl, imageUrlFromTransfer, nameFromUrl, newImageDraft, saveImageDraft, sniffMime, type SourceImage } from './imageImport';

const transfer = (data: Record<string, string>) => ({ getData: (t: string) => data[t] ?? '' });
const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe('image import', () => {
  it('takes the dragged <img> src over the link around it', () => {
    const dt = transfer({
      'text/uri-list': 'https://example.com/article',
      'text/html': '<a href="https://example.com/article"><img alt="x" src="https://cdn.example.com/a/cat%20photo.jpg?w=800&amp;q=1"></a>',
    });
    expect(imageUrlFromTransfer(dt)).toBe('https://cdn.example.com/a/cat%20photo.jpg?w=800&q=1');
  });

  it('falls back to the uri-list, then plain text, and ignores non-URLs', () => {
    expect(imageUrlFromTransfer(transfer({ 'text/uri-list': '# comment\nhttps://x.org/a.png' }))).toBe('https://x.org/a.png');
    expect(imageUrlFromTransfer(transfer({ 'text/plain': ' https://x.org/b.gif ' }))).toBe('https://x.org/b.gif');
    expect(imageUrlFromTransfer(transfer({ 'text/plain': 'just words' }))).toBeNull();
    expect(imageUrlFromTransfer(transfer({ 'text/html': '<img src="//cdn.x.org/c.webp">' }))).toBe('https://cdn.x.org/c.webp');
  });

  it('names a file from the URL path', () => {
    expect(nameFromUrl('https://cdn.example.com/a/cat%20photo.jpg?w=800')).toBe('cat photo');
    expect(nameFromUrl('https://example.com/')).toMatch(/^Pasted image \d{14}$/);
  });

  it('recognises image bytes by signature', () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('image/png');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>').buffer)).toBe('image/svg+xml');
    expect(sniffMime(new TextEncoder().encode('<html>').buffer)).toBeNull();
  });

  it('decodes a data URL', async () => {
    const img = await imageFromUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
    expect(img.mime).toBe('image/svg+xml');
    expect(img.name).toMatch(/^Pasted image/);
  });

  it('picks the extension from the chosen format', () => {
    const source = { mime: 'image/webp' } as SourceImage;
    expect(draftExtension({ source, format: 'original' })).toBe('webp');
    expect(draftExtension({ source, format: 'jpeg' })).toBe('jpg');
  });

  it('starts a draft in the field folder, else the last folder used for that field', async () => {
    const vault = { getAbstractFileByPath: () => null, createFolder: async () => undefined, createBinary: async (p: string) => ({ path: p }) };
    const app = { vault, fileManager: { getAvailablePathForAttachment: async (n: string) => `Attachments/${n}` } } as unknown as App;
    const source = { data: new Uint8Array([1]).buffer, mime: 'image/png', name: 'a', origin: 'a.png' } as SourceImage;
    expect((await newImageDraft(app, source, 'x.table', 'Covers', 'x#cover')).folder).toBe('Covers');
    expect((await newImageDraft(app, source, 'x.table', undefined, 'x#shot')).folder).toBe('Attachments');
    await saveImageDraft(app, { ...(await newImageDraft(app, source, 'x.table', undefined, 'x#shot')), folder: 'Shots' });
    expect((await newImageDraft(app, source, 'x.table', undefined, 'x#shot')).folder).toBe('Shots');
    // Another field doesn't inherit it.
    expect((await newImageDraft(app, source, 'x.table', undefined, 'x#thumb')).folder).toBe('Attachments');
  });

  it('numbers a taken path', () => {
    const taken = new Set(['img/cat.png', 'img/cat 1.png']);
    const app = { vault: { getAbstractFileByPath: (p: string) => (taken.has(p) ? {} : null) } } as unknown as App;
    expect(freePath(app, 'img', 'cat', 'png')).toBe('img/cat 2.png');
    expect(freePath(app, '', 'dog', 'png')).toBe('dog.png');
  });
});
