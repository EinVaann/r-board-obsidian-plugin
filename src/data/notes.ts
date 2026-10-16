import { Notice, TFolder, normalizePath, type App, type TFile } from 'obsidian';
import type { DatabaseConfig } from '../types';

/**
 * Create a note carrying the database's source tag (and optional starting
 * values) in its "New note location", and open it in a new tab. Returns null,
 * with a notice, when no location is set or creation fails.
 */
export async function createNoteFor(app: App, config: DatabaseConfig, values?: Record<string, unknown>): Promise<TFile | null> {
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
    let path = normalizePath(`${dir}/Untitled.md`);
    let i = 1;
    while (app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}/Untitled ${i++}.md`);
    }
    const file = await app.vault.create(path, `---\ntags:\n  - ${config.sourceTag}\n---\n`);
    // Starting values (e.g. the group it was added in) go through Obsidian's YAML writer.
    if (values && Object.keys(values).length) {
      await app.fileManager.processFrontMatter(file, (fm) => void Object.assign(fm, values));
    }
    // Open in a new tab so the board stays put.
    await app.workspace.getLeaf('tab').openFile(file);
    return file;
  } catch (e) {
    new Notice(`R Board: could not create note — ${(e as Error).message}`);
    return null;
  }
}
