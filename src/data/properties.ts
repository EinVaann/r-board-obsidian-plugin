import type { App, TFile } from 'obsidian';
import type { PropertyConfig } from '../types';

/**
 * Set (or clear) a single frontmatter property on a note. Used by kanban drag:
 * dropping a card into a column writes the column's value to the group property.
 * Dropping into Uncategorized (`value === null`) removes the key.
 *
 * Numeric properties are stored as numbers when the value parses cleanly.
 */
export async function setProperty(
  app: App,
  file: TFile,
  prop: PropertyConfig,
  value: string | null,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (value === null) {
      delete fm[prop.name];
      return;
    }
    if (prop.type === 'number') {
      const n = Number(value);
      fm[prop.name] = Number.isNaN(n) ? value : n;
    } else {
      fm[prop.name] = value;
    }
  });
}
