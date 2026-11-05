import type { App, TFile } from 'obsidian';
import { BOARD_VIEW_TYPE, BoardView } from '../BoardView';
import { parseTableFile, serializeTableFile } from './format';
import { addRow } from './rows';
import { relinkRows, type Relink } from './relink';
import { addOptions } from '../quickadd/options';

/** The pane showing `file`, if one is open. */
export function openBoardView(app: App, file: TFile): BoardView | null {
  for (const leaf of app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)) {
    if (leaf.view instanceof BoardView && leaf.view.file?.path === file.path) return leaf.view;
  }
  return null;
}

/**
 * Append a row to a `.table` file. When the table is open, the row goes
 * through its pane, so the pane's next save keeps it; otherwise the file is
 * rewritten in place. `created` adds new select / multi values as options.
 * Returns an error message, or null on success.
 */
export async function appendTableRow(
  app: App,
  file: TFile,
  cells: Record<string, unknown>,
  created: Record<string, string[]> = {},
): Promise<string | null> {
  const view = openBoardView(app, file);
  if (view) {
    if (Object.keys(created).length) view.updateConfig((c) => addOptions(c, created));
    view.appendRow(cells);
    return null;
  }
  let error: string | null = null;
  await app.vault.process(file, (text) => {
    const r = parseTableFile(text);
    if (!r.ok) {
      error = r.error;
      return text;
    }
    addOptions(r.table.config, created);
    addRow(r.table.rows, cells);
    return serializeTableFile(r.table);
  });
  return error;
}

/**
 * A note was renamed: rewrite link cells in `.table` files that pointed at its
 * old path. Obsidian does this for Markdown files only. Open tables are edited
 * through their pane; closed ones are rewritten only when a cell changed.
 */
export async function relinkTables(app: App, tables: TFile[], oldPath: string, file: TFile): Promise<void> {
  for (const table of tables) {
    const relink: Relink = {
      oldPath,
      linkText: app.metadataCache.fileToLinktext(file, table.path, true),
      resolves: (target) => app.metadataCache.getFirstLinkpathDest(target, table.path) !== null,
    };
    const view = openBoardView(app, table);
    if (view) {
      view.updateRows((rows) => void relinkRows(rows, relink));
      continue;
    }
    await app.vault.process(table, (text) => {
      const r = parseTableFile(text);
      if (!r.ok || r.migrated) return text;
      return relinkRows(r.table.rows, relink) ? serializeTableFile(r.table) : text;
    });
  }
}
