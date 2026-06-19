import { type App, type TFile, getAllTags } from 'obsidian';
import type { BoardItem, DatabaseConfig } from '../types';
import { normalizeTag } from '../config';

/** Template notes (filename `_template`) are excluded from all queries. */
const TEMPLATE_BASENAME = '_template';

/** Lower-cased, `#`-stripped tags for a file, via the metadata cache. */
export function tagsForFile(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const all = getAllTags(cache) ?? [];
  return all.map(normalizeTag);
}

/** The display title for a note: frontmatter `title`, else the file basename. */
function titleForFile(file: TFile, frontmatter: Record<string, unknown>): string {
  const t = frontmatter.title;
  return typeof t === 'string' && t.trim() !== '' ? t : file.basename;
}

/**
 * All markdown notes carrying the database's `sourceTag`, excluding template
 * notes. Driven entirely by Obsidian's metadata cache.
 */
export function queryItems(app: App, config: DatabaseConfig): BoardItem[] {
  const source = normalizeTag(config.sourceTag);
  const items: BoardItem[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (file.basename === TEMPLATE_BASENAME) continue;
    const tags = tagsForFile(app, file);
    if (!tags.includes(source)) continue;

    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    items.push({
      file,
      title: titleForFile(file, frontmatter),
      frontmatter,
      tags,
    });
  }

  return items;
}
