import { type App, type TFile, getAllTags } from 'obsidian';
import type { BoardConfig, BoardItem } from '../types';
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
 * All markdown notes carrying the board's `sourceTag` in their tags,
 * excluding template notes. Driven entirely by Obsidian's metadata cache.
 */
export function queryItems(app: App, config: BoardConfig): BoardItem[] {
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

/**
 * Partition items into kanban columns. Each group maps to a sub-tag; a note
 * lands in the first group it carries. Notes with the source tag but no group
 * tag fall into the synthetic "Uncategorized" column.
 */
export interface KanbanColumn {
  /** Group sub-tag (without #), or null for the Uncategorized column. */
  group: string | null;
  label: string;
  items: BoardItem[];
}

export const UNCATEGORIZED_LABEL = 'Uncategorized';

export function partitionKanban(items: BoardItem[], groups: string[]): KanbanColumn[] {
  const normGroups = groups.map(normalizeTag);
  const columns: KanbanColumn[] = normGroups.map((g, i) => ({
    group: g,
    label: groups[i],
    items: [],
  }));
  const uncategorized: KanbanColumn = { group: null, label: UNCATEGORIZED_LABEL, items: [] };

  for (const item of items) {
    const idx = normGroups.findIndex((g) => item.tags.includes(g));
    if (idx === -1) uncategorized.items.push(item);
    else columns[idx].items.push(item);
  }

  return [...columns, uncategorized];
}
