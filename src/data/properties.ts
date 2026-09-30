import type { App, TFile } from 'obsidian';
import type { PropertyConfig } from '../types';

/**
 * Set (or clear) a single frontmatter property on a note. Used by kanban drag
 * and table cell edits. `null` removes the key; an array is written as a list.
 *
 * Numeric properties are stored as numbers when the value parses cleanly.
 */
export async function setProperty(
  app: App,
  file: TFile,
  prop: PropertyConfig,
  value: string | string[] | null,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (value === null) {
      delete fm[prop.name];
      return;
    }
    if (Array.isArray(value)) {
      fm[prop.name] = value;
    } else if (prop.type === 'number') {
      const n = Number(value);
      fm[prop.name] = Number.isNaN(n) ? value : n;
    } else if (prop.type === 'checkbox') {
      const s = value.trim().toLowerCase();
      fm[prop.name] = ['true', 'yes', 'y', '1', 'on'].includes(s);
    } else {
      fm[prop.name] = value;
    }
  });
}
