import { Notice, TFile, type App } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, ScheduleConfig } from '../types';
import type { StoredValue } from '../data/properties';
import { appendTableRow } from '../table/append';
import type { LogColumns } from './inputs';
import type { SessionType } from './types';

export type Role = keyof ScheduleConfig['statuses'];

/** The status value written for a role (its first listed value). */
export function statusFor(c: ScheduleConfig, role: Role): string | null {
  return c.statuses[role][0] ?? null;
}

/** Set an item's status to a role's value through the board, so auto-dates fire. Returns false when it couldn't. */
export async function setRole(
  config: DatabaseConfig,
  c: ScheduleConfig,
  item: BoardItem,
  role: Role,
  setValue: (item: BoardItem, prop: PropertyConfig, value: StoredValue) => Promise<void>,
): Promise<boolean> {
  const prop = config.properties.find((p) => p.name === c.status);
  const value = statusFor(c, role);
  if (!prop || !value) {
    new Notice(`R Board: choose a status value for "${role}" in the Schedule settings.`);
    return false;
  }
  await setValue(item, prop, value);
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
