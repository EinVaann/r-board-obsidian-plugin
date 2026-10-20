import { Notice, TFolder, normalizePath, type App, type TFile } from 'obsidian';
import type { DatabaseConfig } from '../types';

/**
 * Create a note carrying the database's source tag (and optional starting
 * values) in its "New note location", named `title` (default "Untitled"), and
 * open it in a new tab unless `open` is false. Returns null, with a notice,
 * when no location is set or creation fails.
 */
export async function createNoteFor(
  app: App,
  config: DatabaseConfig,
  values?: Record<string, unknown>,
  opts: { title?: string; open?: boolean } = {},
): Promise<TFile | null> {
  const folder = config.newNoteFolder?.trim();
  if (!folder) {
    new Notice('R Board: set a "New note location" in board settings to use this.');
    return null;
  }
  try {
    const dir = normalizePath(folder);
    if (!(app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
      await app.vault.createFolder(dir).catch(() => undefined);
    }
    const base = opts.title?.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'Untitled';
    let path = normalizePath(`${dir}/${base}.md`);
    let i = 1;
    while (app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}/${base} ${i++}.md`);
    }
    const file = await app.vault.create(path, `---\ntags:\n  - ${config.sourceTag}\n---\n`);
    // Starting values (e.g. the group it was added in) go through Obsidian's YAML writer.
    if (values && Object.keys(values).length) {
      await app.fileManager.processFrontMatter(file, (fm) => void Object.assign(fm, values));
    }
    // Open in a new tab so the board stays put.
    if (opts.open !== false) await app.workspace.getLeaf('tab').openFile(file);
    return file;
  } catch (e) {
    new Notice(`R Board: could not create note — ${(e as Error).message}`);
    return null;
  }
}
