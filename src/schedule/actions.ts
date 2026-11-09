import { Notice, TFile, type App } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, ScheduleSection } from '../types';
import type { StoredValue } from '../data/properties';
import { appendTableRow } from '../table/append';
import type { LogColumns } from './inputs';
import { moveWrites } from './sections';
import type { SessionType } from './types';

/**
 * Write what puts `item` in section `target`, through the board so auto-dates
 * fire. Returns false when nothing could be written.
 */
export async function moveToSection(
  config: DatabaseConfig,
  sections: ScheduleSection[],
  item: BoardItem,
  target: number,
  setValue: (item: BoardItem, prop: PropertyConfig, value: StoredValue) => Promise<void>,
): Promise<boolean> {
  const writes = moveWrites(item.values, sections, target);
  if (!writes) {
    new Notice(`R Board: can't move ${item.title} into "${sections[target]?.name ?? '?'}"; check the sections in the Schedule settings.`);
    return false;
  }
  for (const [name, value] of Object.entries(writes)) {
    const prop = config.properties.find((p) => p.name === name);
    if (prop) await setValue(item, prop, value);
  }
  return true;
}

/** Append a session to the log table: a link to the note, hours, date and (when there is a column) type. */
export async function logSession(
  app: App,
  logPath: string,
  cols: LogColumns,
  file: TFile,
  session: { hours: number; date: string; type?: SessionType },
): Promise<boolean> {
  const log = app.vault.getAbstractFileByPath(logPath);
  if (!(log instanceof TFile)) {
    new Notice(`R Board: log table not found: ${logPath}`);
    return false;
  }
  const link = `[[${app.metadataCache.fileToLinktext(file, log.path, true)}|${file.basename}]]`;
  const cells: Record<string, unknown> = { [cols.logItem]: [link], [cols.logHours]: session.hours, [cols.logDate]: session.date };
  if (cols.logType && session.type) cells[cols.logType] = session.type;
  const error = await appendTableRow(app, log, cells);
  if (error) new Notice(`R Board: could not log the session — ${error}`);
  return !error;
}
