import { type App, type TFile } from 'obsidian';
import type { BoardItem, NumberFormat, PropertyConfig, SelectOption } from '../types';
import { formatDate, parseDateString } from '../formula/evaluate';

/** Stored (or computed, for formulas) value of a property. */
export function fieldValue(item: BoardItem, prop: PropertyConfig): unknown {
  return item.values[prop.name];
}

/** Curated, evenly-spaced hues so each value gets a distinct, pleasant color. */
const PILL_HUES = [0, 25, 45, 95, 150, 190, 215, 260, 290, 330];

/** A stable color for a value without an explicit one (same value → same color). */
export function autoColor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + value.charCodeAt(i)) >>> 0;
  return `hsl(${PILL_HUES[h % PILL_HUES.length]}, 60%, 55%)`;
}

/** The option for a stored value, with its effective label and color (unlisted values are synthesized). */
export function optionFor(prop: PropertyConfig, value: string): Required<SelectOption> {
  const hit = prop.options?.find((o) => o.value === value);
  return { value, label: hit?.label ?? value, color: hit?.color ?? autoColor(value) };
}

/** Write a number with a property's format. */
export function formatNumber(n: number, f?: NumberFormat): string {
  if (!Number.isFinite(n)) return String(n);
  const style = f?.style ?? 'plain';
  const decimals = f?.decimals;
  const opts: Intl.NumberFormatOptions = {
    useGrouping: f?.grouping ?? style !== 'plain',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals ?? 10,
  };
  switch (style) {
    case 'percent':
      return new Intl.NumberFormat(undefined, { ...opts, style: 'percent', maximumFractionDigits: decimals ?? 2 }).format(n);
    case 'compact':
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: decimals ?? 1 }).format(n);
    case 'currency': {
      const body = new Intl.NumberFormat(undefined, { ...opts, maximumFractionDigits: decimals ?? 2 }).format(Math.abs(n));
      return `${n < 0 ? '-' : ''}${f?.currency ?? '$'}${body}`;
    }
    default:
      return new Intl.NumberFormat(undefined, opts).format(n);
  }
}

/** A stored date value (`YYYY-MM-DD[THH:mm]`, or a Date from a formula) as a local Date. */
export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') return parseDateString(value);
  return null;
}

/** A date as `YYYY-MM-DD`, with ` HH:mm` when `withTime`. */
export function formatDateValue(d: Date, withTime: boolean): string {
  return formatDate(d, withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
}

/** "Today", "Tomorrow", "in 3 days", "2 weeks ago"… */
export function relativeDate(d: Date, now = new Date()): string {
  const day = (x: Date): number => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5;
  const diff = day(d) - day(now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const abs = Math.abs(diff);
  const [n, unit] = abs < 14 ? [abs, 'day'] : abs < 60 ? [Math.round(abs / 7), 'week'] : abs < 730 ? [Math.round(abs / 30), 'month'] : [Math.round(abs / 365), 'year'];
  const text = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
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
  if (prop.type === 'select' || prop.type === 'multi') {
    return asArray(v).map((x) => `${x} ${optionFor(prop, x).label}`).join(' ').toLowerCase();
  }
  if (Array.isArray(v)) return v.join(' ').toLowerCase();
  return String(v).toLowerCase();
}
