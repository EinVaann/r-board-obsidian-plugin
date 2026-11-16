import { Notice, type App, type TFile } from 'obsidian';
import type { DatabaseConfig } from '../types';
import { selectCurrentView, type BoardStore } from './store';

/** What a link into a board points at: `#View`, `#^rowId`, or both (`#View#^rowId`). */
export interface BoardLink {
  view?: string;
  row?: string;
}

/** Read the part of a link after the file name (Obsidian's `subpath`, starting with `#`). */
export function parseBoardLink(subpath: string): BoardLink {
  const link: BoardLink = {};
  for (const raw of subpath.split('#')) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith('^')) link.row = part.slice(1).trim() || undefined;
    else link.view = part;
  }
  return link;
}

/** The subpath that links to a view and/or a row. */
export function boardSubpath(link: BoardLink): string {
  return (link.view ? `#${link.view}` : '') + (link.row ? `#^${link.row}` : '');
}

/** Characters that would break a `[[file#view]]` link. */
const UNLINKABLE = /[#^|[\]]/;

/** Whether a view name can go in a link. */
export const linkableView = (name: string): boolean => !UNLINKABLE.test(name);

/**
 * The view a link should show, or undefined to stay on `activeView`.
 * Names match exactly, then ignoring case. Rows show only in table views:
 * a row link goes to the named view if it's a table, else the current one
 * if it's a table, else the first table view.
 */
export function viewForLink(config: DatabaseConfig, activeView: string, link: BoardLink): string | undefined {
  const named = link.view ? (config.views.find((v) => v.name === link.view) ?? config.views.find((v) => v.name.toLowerCase() === link.view!.toLowerCase())) : undefined;
  if (!link.row) return named?.name;
  if (named?.type === 'table') return named.name;
  if (config.views.find((v) => v.name === activeView)?.type === 'table') return undefined;
  return config.views.find((v) => v.type === 'table')?.name;
}

/** Show what a link points at: switch view, then (tables) ask the table view to show the row. */
export function followLink(store: BoardStore, link: BoardLink, file: { basename: string; extension: string } | null): void {
  const { config, activeView, setActiveView, setSearch, showRow } = store.getState();
  if (!config) return;
  const name = file?.basename ?? 'this board';
  const view = viewForLink(config, activeView, link);
  if (link.view && !view && !link.row) new Notice(`R Board: no view named "${link.view}" in ${name}.`);
  if (view) setActiveView(view);
  if (!link.row) return;
  if (file?.extension !== 'table') {
    new Notice('R Board: row links work in .table files. Board items are notes; link the note instead.');
    return;
  }
  if (selectCurrentView(store.getState())?.type !== 'table') {
    new Notice(`R Board: ${name} has no table view to show the row in.`);
    return;
  }
  setSearch('');
  showRow(link.row);
}

/** Copy a link to `file` (plus a subpath) in the user's link format. */
export function copyBoardLink(app: App, file: TFile, link: BoardLink, what: string): void {
  const text = app.fileManager.generateMarkdownLink(file, '', boardSubpath(link));
  void navigator.clipboard.writeText(text).then(
    () => new Notice(`R Board: link to ${what} copied — paste it into a note.`),
    () => new Notice('R Board: could not copy the link.'),
  );
}
