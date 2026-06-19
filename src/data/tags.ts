import type { App, TFile } from 'obsidian';
import { normalizeTag } from '../config';

/**
 * Move a note between kanban groups by editing its frontmatter `tags` array:
 * remove any of the board's group tags, add the destination group tag, and
 * always preserve the base source tag. Moving to the Uncategorized column
 * (`toGroup === null`) just removes the group tags.
 *
 * Tags are written without a leading `#` (frontmatter array convention).
 */
export async function moveToGroup(
  app: App,
  file: TFile,
  allGroups: string[],
  toGroup: string | null,
): Promise<void> {
  const groupSet = new Set(allGroups.map(normalizeTag));
  const dest = toGroup ? normalizeTag(toGroup) : null;

  await app.fileManager.processFrontMatter(file, (fm) => {
    const raw = fm.tags;
    let tags: string[];
    if (Array.isArray(raw)) tags = raw.map((t) => String(t));
    else if (typeof raw === 'string' && raw.trim() !== '') tags = [raw];
    else tags = [];

    // Drop every group tag (matching case-insensitively on the normalized form).
    tags = tags.filter((t) => !groupSet.has(normalizeTag(t)));

    // Add the destination group if it isn't already present.
    if (dest && !tags.some((t) => normalizeTag(t) === dest)) {
      tags.push(dest);
    }

    fm.tags = tags;
  });
}
