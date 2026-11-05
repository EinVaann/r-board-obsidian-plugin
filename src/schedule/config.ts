import type { DatabaseConfig, PropertyConfig, ScheduleConfig } from '../types';
import { DEFAULT_PENALTIES, DEFAULT_SETTINGS, type Penalties, type Pin, type ScheduleSettings } from './types';

/** Schedule settings with every field filled in; properties are chosen later. */
export function defaultScheduleConfig(): ScheduleConfig {
  return {
    similar: [],
    statuses: { pool: ['planned'], active: ['playing'], finished: ['completed'], dropped: ['dropped'] },
    lanes: DEFAULT_SETTINGS.lanes,
    longOver: DEFAULT_SETTINGS.longOver,
    weekStart: DEFAULT_SETTINGS.weekStart,
    estimates: { ...DEFAULT_SETTINGS.estimates },
    paceWeeks: DEFAULT_SETTINGS.paceWeeks,
    pausedAfterDays: DEFAULT_SETTINGS.pausedAfterDays,
    penalties: { ...DEFAULT_PENALTIES },
    pins: [],
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
const num = (v: unknown, fallback: number, min = 0, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

export function parseSchedule(raw: unknown): ScheduleConfig {
  const c = obj(raw);
  const d = defaultScheduleConfig();
  const st = obj(c.statuses);
  const est = obj(c.estimates);
  const pen = obj(c.penalties);
  const statusList = (k: keyof ScheduleConfig['statuses']): string[] => (Array.isArray(st[k]) ? strs(st[k]) : d.statuses[k]);
  const penalty = (k: keyof Penalties, max = 100): number => num(pen[k], d.penalties[k], 0, max);
  const pins: Pin[] = [];
  for (const p of Array.isArray(c.pins) ? c.pins : []) {
    const o = obj(p);
    if (!str(o.item)) continue;
    const pin: Pin = { item: o.item as string, lane: Math.round(num(o.lane, 0)), position: Math.round(num(o.position, 0)) };
    if (str(o.notBefore)) pin.notBefore = o.notBefore as string;
    pins.push(pin);
  }
  return {
    log: str(c.log),
    logItem: str(c.logItem),
    logHours: str(c.logHours),
    logDate: str(c.logDate),
    logType: str(c.logType),
    duration: str(c.duration),
    score: str(c.score),
    vary: str(c.vary),
    similar: Array.isArray(c.similar) ? c.similar.map(strs).filter((g) => g.length > 1) : [],
    status: str(c.status),
    statuses: { pool: statusList('pool'), active: statusList('active'), finished: statusList('finished'), dropped: statusList('dropped') },
    live: str(c.live),
    startDate: str(c.startDate),
    endDate: str(c.endDate),
    lanes: Math.round(num(c.lanes, d.lanes, 1, 6)),
    longOver: num(c.longOver, d.longOver),
    weekStart: c.weekStart === 'sun' ? 'sun' : 'mon',
    estimates: { weekly: num(est.weekly, d.estimates.weekly), live: num(est.live, d.estimates.live) },
    paceWeeks: Math.round(num(c.paceWeeks, d.paceWeeks, 1, 52)),
    pausedAfterDays: Math.round(num(c.pausedAfterDays, d.pausedAfterDays, 1)),
    penalties: { running: penalty('running'), previous: penalty('previous'), long: penalty('long'), similarFactor: penalty('similarFactor', 1) },
    pins,
  };
}

/** The engine settings a schedule view's config stands for. */
export function engineSettings(c: ScheduleConfig): ScheduleSettings {
  return {
    lanes: c.lanes,
    longOver: c.longOver,
    weekStart: c.weekStart,
    estimates: c.estimates,
    paceWeeks: c.paceWeeks,
    similar: c.similar,
    penalties: c.penalties,
    pins: c.pins,
    pausedAfterDays: c.pausedAfterDays,
  };
}

/** Fill unset item properties with likely ones from the database (by name, then type). */
export function guessSchedule(config: DatabaseConfig, c: ScheduleConfig): ScheduleConfig {
  const props = config.properties;
  const pick = (types: PropertyConfig['type'][], names: RegExp): string | undefined => {
    const typed = props.filter((p) => types.includes(p.type));
    return (typed.find((p) => names.test(p.name) || names.test(p.label ?? '')) ?? undefined)?.name;
  };
  const out = { ...c };
  out.status ??= pick(['select', 'text'], /status/i) ?? props.find((p) => p.type === 'select')?.name;
  out.duration ??= pick(['number', 'formula'], /hour|duration|length|hltb|time/i);
  out.score ??= pick(['number', 'formula'], /score|rating|priority/i);
  out.vary ??= pick(['multi', 'select'], /genre|category|type|tag/i);
  out.live ??= pick(['checkbox'], /live/i);
  out.startDate ??= pick(['date'], /start/i);
  out.endDate ??= pick(['date'], /end|finish|complete/i);
  return out;
}

/** Log columns not chosen yet, guessed from the log table's properties. */
export function guessLogColumns(log: PropertyConfig[], c: ScheduleConfig): Required<Pick<ScheduleConfig, 'logItem' | 'logHours' | 'logDate'>> & { logType?: string } {
  const has = (name: string | undefined): string | undefined => (name && log.some((p) => p.name === name) ? name : undefined);
  return {
    logItem: has(c.logItem) ?? log.find((p) => p.type === 'links')?.name ?? '',
    logHours: has(c.logHours) ?? log.find((p) => p.type === 'number')?.name ?? '',
    logDate: has(c.logDate) ?? log.find((p) => p.type === 'date')?.name ?? '',
    logType: has(c.logType),
  };
}
