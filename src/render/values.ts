import { type App, type TFile } from 'obsidian';
import type { BoardItem, PropertyConfig } from '../types';

/** Raw frontmatter value for a property. */
export function fieldValue(item: BoardItem, prop: PropertyConfig): unknown {
  return item.frontmatter[prop.name];
}

/** Coerce a frontmatter value to a number, or null if not numeric. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/** Coerce a frontmatter value to a string array, dropping empty/null entries. */
export function asArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return raw
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((v) => String(v));
}

/**
 * Resolve an image field value (an Obsidian wikilink like `[[cover.png]]`,
 * a bare path, or an http(s) URL) to a usable <img> src, or null.
 */
export function resolveImageSrc(
  app: App,
  sourceFile: TFile,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();

  if (/^https?:\/\//i.test(raw)) return raw;

  // Strip wikilink wrapping and any alias/heading: [[path|alias]] → path
  const inner = raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
  const linkPath = inner.split('|')[0].split('#')[0].trim();

  const dest = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
  if (dest) return app.vault.getResourcePath(dest);
  return null;
}

/** A lower-cased string blob of a property's value, for search matching. */
export function fieldSearchText(item: BoardItem, prop: PropertyConfig): string {
  const v = fieldValue(item, prop);
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(' ').toLowerCase();
  return String(v).toLowerCase();
}
