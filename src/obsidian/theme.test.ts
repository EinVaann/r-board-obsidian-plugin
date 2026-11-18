// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import '../test/obsidian-mock';
import { applyTheme, clearTheme, parseTheme } from './theme';

describe('appearance', () => {
  it('defaults to industrial / auto and drops unknown values', () => {
    expect(parseTheme(undefined)).toEqual({ theme: 'industrial', mode: 'auto', accent: 'yellow' });
    expect(parseTheme({ theme: 'neon', mode: 'sepia', accent: 'rainbow' })).toEqual({ theme: 'industrial', mode: 'auto', accent: 'yellow' });
    expect(parseTheme({ theme: 'classic', mode: 'dark', accent: 'teal' })).toEqual({ theme: 'classic', mode: 'dark', accent: 'teal' });
    expect(parseTheme({ accent: '#123abc' }).accent).toBe('#123abc');
  });

  it('accent color (Industrial only): a preset or hex sets the variable with readable text', () => {
    applyTheme(document, { theme: 'industrial', mode: 'light', accent: 'yellow' });
    expect(document.body.style.getPropertyValue('--rb-user-accent')).toBe('#FFE41A');
    expect(document.body.style.getPropertyValue('--rb-user-accent-fg')).toBe('#1C1C1E');
    applyTheme(document, { theme: 'industrial', mode: 'light', accent: '#203040' });
    expect(document.body.style.getPropertyValue('--rb-user-accent-fg')).toBe('#FFFFFF');
    applyTheme(document, { theme: 'industrial', mode: 'light', accent: 'vault' });
    expect(document.body.style.getPropertyValue('--rb-user-accent')).toBe('var(--rb-vault-accent)');
    // Classic follows Obsidian: the setting doesn't apply.
    applyTheme(document, { theme: 'classic', mode: 'light', accent: 'teal' });
    expect(document.body.style.getPropertyValue('--rb-user-accent')).toBe('');
  });

  it('sets one theme class and one mode class on the body', () => {
    applyTheme(document, { theme: 'industrial', mode: 'dark', accent: 'vault' });
    expect([...document.body.classList].filter((c) => c.startsWith('rb-')).sort()).toEqual(['rb-mode-dark', 'rb-theme-industrial']);
    applyTheme(document, { theme: 'classic', mode: 'light', accent: 'vault' });
    expect([...document.body.classList].filter((c) => c.startsWith('rb-')).sort()).toEqual(['rb-mode-light', 'rb-theme-classic']);
  });

  it('auto follows Obsidian', () => {
    document.body.classList.add('theme-dark');
    applyTheme(document, { theme: 'industrial', mode: 'auto', accent: 'vault' });
    expect(document.body.classList.contains('rb-mode-dark')).toBe(true);
    document.body.classList.replace('theme-dark', 'theme-light');
    applyTheme(document, { theme: 'industrial', mode: 'auto', accent: 'vault' });
    expect(document.body.classList.contains('rb-mode-light')).toBe(true);
  });

  it('removes every class on unload', () => {
    applyTheme(document, { theme: 'industrial', mode: 'dark', accent: 'vault' });
    clearTheme(document);
    expect([...document.body.classList].some((c) => c.startsWith('rb-'))).toBe(false);
  });
});
