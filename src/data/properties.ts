import type { App, TFile } from 'obsidian';
import type { PropertyConfig } from '../types';
import { asBoolean } from '../render/values';

/** A value as written to frontmatter or a table cell. */
export type StoredValue = string | number | boolean | string[] | null;

/**
 * Coerce an edited value to what a property stores: numbers for `number`,
 * booleans for `checkbox`, lists for `multi` / `links`, text otherwise.
 * Returns null for an empty value (the key is removed).
 */
export function toStored(prop: PropertyConfig, value: StoredValue): StoredValue {
  if (value === null || value === '') return null;
  if (Array.isArray(value)) {
    const list = value.map((v) => v.trim()).filter((v) => v !== '');
    if (prop.type === 'multi' || prop.type === 'links') return list.length ? list : null;
    return list.length ? list.join(', ') : null;
  }
  switch (prop.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      const t = String(value).trim();
      // A lone decimal comma ("6,5") reads as a decimal point; "1,234" stays a thousands separator.
      const n = Number(/^-?\d+,\d{1,2}$|^-?\d+,\d{4,}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, ''));
      return Number.isNaN(n) || t === '' ? t : n;
    }
    case 'checkbox':
      return typeof value === 'boolean' ? value : asBoolean(value) ?? false;
    case 'multi':
    case 'links':
      return typeof value === 'string'
        ? toStored(prop, value.split(',').map((s) => s.trim()))
        : [String(value)];
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** Set (or clear, with `null`) a single frontmatter property on a note. */
export async function setProperty(app: App, file: TFile, prop: PropertyConfig, value: StoredValue): Promise<void> {
  const stored = toStored(prop, value);
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (stored === null) delete fm[prop.name];
    else fm[prop.name] = stored;
  });
}
