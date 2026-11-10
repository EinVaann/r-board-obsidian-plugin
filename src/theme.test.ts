// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import './test/obsidian-mock';
import { applyTheme, clearTheme, parseTheme } from './theme';

describe('appearance', () => {
  it('defaults to industrial / auto and drops unknown values', () => {
    expect(parseTheme(undefined)).toEqual({ theme: 'industrial', mode: 'auto' });
    expect(parseTheme({ theme: 'neon', mode: 'sepia' })).toEqual({ theme: 'industrial', mode: 'auto' });
    expect(parseTheme({ theme: 'classic', mode: 'dark' })).toEqual({ theme: 'classic', mode: 'dark' });
  });

  it('sets one theme class and one mode class on the body', () => {
    applyTheme(document, { theme: 'industrial', mode: 'dark' });
    expect([...document.body.classList].filter((c) => c.startsWith('rb-')).sort()).toEqual(['rb-mode-dark', 'rb-theme-industrial']);
    applyTheme(document, { theme: 'classic', mode: 'light' });
    expect([...document.body.classList].filter((c) => c.startsWith('rb-')).sort()).toEqual(['rb-mode-light', 'rb-theme-classic']);
  });

  it('auto follows Obsidian', () => {
    document.body.classList.add('theme-dark');
    applyTheme(document, { theme: 'industrial', mode: 'auto' });
    expect(document.body.classList.contains('rb-mode-dark')).toBe(true);
    document.body.classList.replace('theme-dark', 'theme-light');
    applyTheme(document, { theme: 'industrial', mode: 'auto' });
    expect(document.body.classList.contains('rb-mode-light')).toBe(true);
  });

  it('removes every class on unload', () => {
    applyTheme(document, { theme: 'industrial', mode: 'dark' });
    clearTheme(document);
    expect([...document.body.classList].some((c) => c.startsWith('rb-'))).toBe(false);
  });
});
