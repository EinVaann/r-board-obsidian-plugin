import type { BoardItem, ScheduleConfig, SectionKind, TableRow } from '../types';
import { asArray, asDate, asNumber, parseLink } from '../render/values';
import { localDate } from './dates';
import { matchSection } from './sections';
import type { ItemState, ScheduleItem, Session, SessionType } from './types';

const SESSION_TYPES = new Set<SessionType>(['lane', 'live', 'detour', 'trial']);

const dateOf = (v: unknown): string | undefined => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = asDate(v);
  return d ? localDate(d) : undefined;
};

const STATE_OF: Record<SectionKind, ItemState> = { lanes: 'active', queue: 'pool', live: 'live', side: 'side', finished: 'ended', dropped: 'ended', hidden: 'ignored' };

/** Which part of the schedule an item belongs to: the first section it matches (`section` is -1 for none). */
export function stateOf(item: BoardItem, c: ScheduleConfig): { state: ItemState; finished: boolean; section: number } {
  const sections = c.sections ?? [];
  const section = matchSection(item.values, sections);
  const kind = sections[section]?.kind;
  // Only the first lanes / queue section counts.
  const first = kind === 'lanes' || kind === 'queue' ? sections.findIndex((s) => s.kind === kind) === section : true;
  return { state: kind && first ? STATE_OF[kind] : 'ignored', finished: kind === 'finished', section };
}

/** Board items as engine items; `id` stays the item id (the note path). */
export function toScheduleItems(items: BoardItem[], c: ScheduleConfig): ScheduleItem[] {
  return items.map((item) => {
    const { state, finished } = stateOf(item, c);
    const out: ScheduleItem = {
      id: item.id,
      title: item.title,
      state,
      duration: c.duration ? asNumber(item.values[c.duration]) : null,
      score: c.score ? asNumber(item.values[c.score]) : null,
      vary: c.vary ? asArray(item.values[c.vary]) : [],
    };
    const start = c.startDate ? dateOf(item.values[c.startDate]) : undefined;
    const end = c.endDate ? dateOf(item.values[c.endDate]) : undefined;
    if (start) out.start = start;
    if (end) out.end = end;
    if (finished) out.finished = true;
    const created = item.file?.stat?.ctime;
    if (typeof created === 'number') out.created = created;
    return out;
  });
}

export interface LogColumns {
  logItem: string;
  logHours: string;
  logDate: string;
  logType?: string;
}

/**
 * Log rows as sessions. `resolve` turns a linkpath into an item id (or null);
 * rows without hours or a date are skipped.
 */
export function toSessions(rows: TableRow[], cols: LogColumns, resolve: (linkpath: string) => string | null): Session[] {
  const out: Session[] = [];
  for (const row of rows) {
    const hours = asNumber(row.cells[cols.logHours]);
    const date = dateOf(row.cells[cols.logDate]);
    if (hours === null || hours <= 0 || !date) continue;
    const link = parseLink(asArray(row.cells[cols.logItem])[0]);
    const session: Session = { item: link && !link.url ? resolve(link.linkpath) : null, date, hours };
    const type = cols.logType ? String(asArray(row.cells[cols.logType])[0] ?? '').toLowerCase() : '';
    if (SESSION_TYPES.has(type as SessionType)) session.type = type as SessionType;
    out.push(session);
  }
  return out;
}
