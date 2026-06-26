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

/**
 * Coerce a frontmatter value to a boolean. Accepts real booleans and the
 * common stringy forms (`true`/`false`, `yes`/`no`, `1`/`0`). Returns null
 * when the value is absent or unrecognized.
 */
export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on', '✓'].includes(s)) return true;
    if (['false', 'no', 'n', '0', 'off', ''].includes(s)) return false;
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

/** A single parsed link entry from a `links` property. */
export interface ParsedLink {
  /** Display text (alias if given, else the link target / URL). */
  text: string;
  /** External URL (http/https), or null for an internal note link. */
  url: string | null;
  /** Linkpath to resolve against the vault, for internal links. */
  linkpath: string;
}

/**
 * Parse one entry of a `links` property. Accepts an Obsidian wikilink
 * (`[[Note|alias]]`), a bare note name/path, or an http(s) URL.
 */
export function parseLink(value: unknown): ParsedLink | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();

  if (/^https?:\/\//i.test(raw)) {
    return { text: raw.replace(/^https?:\/\//i, ''), url: raw, linkpath: raw };
  }

  // Strip wikilink wrapping: [[path|alias]] → path + optional alias.
  const inner = raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
  const [target, alias] = inner.split('|');
  const linkpath = target.split('#')[0].trim();
  return { text: (alias ?? linkpath).trim(), url: null, linkpath };
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
