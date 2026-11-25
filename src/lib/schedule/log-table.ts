import { TFile, type App } from 'obsidian';
import type { DatabaseConfig, PropertyConfig } from '../../types/database';
import { openBoardView } from '../table/append';
import { newId, parseTableFile, serializeTableFile } from '../table/format';
import { guessLogColumns, SESSION_TYPES } from './config';

export interface LogShape {
  logItem: string;
  logHours: string;
  logDate: string;
  logType: string;
}

const TYPE_LABELS: Record<string, string> = { lane: 'Lane', live: 'Live', detour: 'Detour', trial: 'Trial' };

/** What `shapeLogConfig` would add: missing columns and missing type values. */
export function logShapeMissing(properties: PropertyConfig[]): string[] {
  const cols = guessLogColumns(properties);
  const missing: string[] = [];
  if (!cols.logItem) missing.push('Game');
  if (!cols.logHours) missing.push('Hours');
  if (!cols.logDate) missing.push('Date');
  const type = properties.find((p) => p.name === cols.logType);
  if (!type) missing.push('Type');
  else if (type.type === 'select' && SESSION_TYPES.some((v) => !type.options?.some((o) => o.value === v))) missing.push('Type values');
  return missing;
}

/**
 * Give a log table the columns the schedule reads, reusing matching ones:
 * Game (links), Hours (number), Date (date), Type (select of session types).
 */
export function shapeLogConfig(config: DatabaseConfig): LogShape {
  const props = config.properties;
  const cols = guessLogColumns(props);
  const add = (p: Omit<PropertyConfig, 'name'>): string => {
    const name = newId('c', props.map((x) => x.name));
    props.push({ name, ...p });
    return name;
  };
  const logItem = cols.logItem || add({ type: 'links', label: 'Game', render: 'list', single: true });
  const logHours = cols.logHours || add({ type: 'number', label: 'Hours', render: 'text', suffix: 'h' });
  const logDate = cols.logDate || add({ type: 'date', label: 'Date', render: 'plain' });
  const logType = cols.logType || add({ type: 'select', label: 'Type', render: 'pill', options: [] });
  const type = props.find((p) => p.name === logType)!;
  if (type.type === 'select') {
    const have = type.options ?? [];
    const fresh = SESSION_TYPES.filter((v) => !have.some((o) => o.value === v)).map((value) => ({ value, label: TYPE_LABELS[value] }));
    if (fresh.length) type.options = [...have, ...fresh];
  }
  return { logItem, logHours, logDate, logType };
}

/** Shape the log table at `path` in place (through its pane when open). Returns its columns, or an error. */
export async function shapeLogTable(app: App, path: string): Promise<{ ok: true; columns: LogShape } | { ok: false; error: string }> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { ok: false, error: `Log table not found: ${path}` };
  const view = openBoardView(app, file);
  const current = view?.currentConfig();
  if (view && current) {
    let columns: LogShape | null = null;
    view.updateConfig((c) => void (columns = shapeLogConfig(c)));
    return { ok: true, columns: columns! };
  }
  let result: { ok: true; columns: LogShape } | { ok: false; error: string } = { ok: false, error: 'Could not read the log table.' };
  await app.vault.process(file, (text) => {
    const r = parseTableFile(text);
    if (!r.ok) {
      result = { ok: false, error: r.error };
      return text;
    }
    const before = JSON.stringify(r.table.config.properties);
    const columns = shapeLogConfig(r.table.config);
    result = { ok: true, columns };
    return JSON.stringify(r.table.config.properties) === before ? text : serializeTableFile(r.table);
  });
  return result;
}
