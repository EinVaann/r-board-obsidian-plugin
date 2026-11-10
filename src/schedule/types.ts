/** Inputs and outputs of the schedule engine. Dates are local `YYYY-MM-DD` strings. */

/**
 * pool = waiting to be scheduled; active = running in a lane; live = running
 * outside the lanes (live service); side = running outside the lanes (casual);
 * ended = completed or dropped; ignored = everything else (incl. on hold).
 */
export type ItemState = 'pool' | 'active' | 'live' | 'side' | 'ended' | 'ignored';

/** One record, already read from its note. */
export interface ScheduleItem {
  id: string;
  title: string;
  state: ItemState;
  /** Estimated hours (e.g. HowLongToBeat main story). */
  duration: number | null;
  score: number | null;
  /** Values of the "must vary" property (e.g. genres). */
  vary: string[];
  /** When the item started, if known (note date or first logged session). */
  start?: string;
  /** When it ended, for ended items. */
  end?: string;
  /** Ended by finishing (not dropping): used to learn how estimates overrun. */
  finished?: boolean;
  /** Tie-break for equal scores: earlier first (e.g. note creation). */
  created?: number;
}

export type SessionType = 'lane' | 'live' | 'detour' | 'trial';

/** One logged session. `item` is the item id, or null when the link didn't resolve. */
export interface Session {
  item: string | null;
  date: string;
  hours: number;
  /** As written in the log; inferred when absent. */
  type?: SessionType;
}

/** A hand-placed queue item; `lane` -1 is a hold only: placed by the schedule, not before `notBefore`. */
export interface Pin {
  item: string;
  lane: number;
  /** Position among the lane's queued items (0 = next); -1 for a hold. */
  position: number;
  /** Don't start before this date. */
  notBefore?: string;
}

export interface ScheduleSettings {
  lanes: number;
  /** Items longer than this (hours) count as long; one long item at a time. */
  longOver: number;
  weekStart: 'mon' | 'sun';
  /** `weekly`: all play time assumed until there is log history; `live`: unlogged live time, always counted. */
  estimates: { weekly: number; live: number };
  /** How many full past weeks pace is averaged over. */
  paceWeeks: number;
  /** Groups of vary-values that count as alike (e.g. ["JRPG", "Visual novel"]). */
  similar: string[][];
  /** Subtracted from a candidate's score; nothing is forbidden. */
  penalties: Penalties;
  pins: Pin[];
  /** Active item id → the lane it runs in (kept when another lane frees up). */
  assign?: Record<string, number>;
  /** Days without lane time before an active item is flagged paused. */
  pausedAfterDays: number;
}

export interface Penalties {
  /** Shares a value with an item running in another lane. */
  running: number;
  /** Shares a value with the item that just ended in this lane. */
  previous: number;
  /** A long item while another long one runs. */
  long: number;
  /** A similar-group match costs this fraction of an exact match. */
  similarFactor: number;
}

export const DEFAULT_PENALTIES: Penalties = { running: 3, previous: 2, long: 4, similarFactor: 0.5 };

export const DEFAULT_SETTINGS: ScheduleSettings = {
  lanes: 2,
  longOver: 40,
  weekStart: 'mon',
  estimates: { weekly: 19, live: 4 },
  paceWeeks: 4,
  similar: [],
  penalties: DEFAULT_PENALTIES,
  pins: [],
  pausedAfterDays: 21,
};

/** Hours by session type. */
export type HoursByType = Record<SessionType, number>;

export interface WeekSummary {
  /** First day of the current week. */
  start: string;
  logged: HoursByType;
  /** Hours budgeted for the week (weekly pace). */
  budget: number;
  /** Suggested remaining lane hours per active item. */
  suggested: { item: string; hours: number }[];
  /** Logged hours on each day of the week, first day first (7 entries). */
  days: number[];
}

export interface Pace {
  weekly: number;
  live: number;
  /** Detour + trial. */
  other: number;
  lane: number;
  /** Full weeks of history the averages use (0 = estimates only). */
  history: number;
}

/** A date range: early = at current pace, late = with the overrun factor applied. */
export interface Range {
  early: string;
  late: string;
}

export interface LaneEntry {
  item: string;
  /** Running now (vs. queued). */
  current: boolean;
  start: Range;
  end: Range;
  /** Hours left at forecast time. */
  remaining: number;
  pinned: boolean;
  /** Played past its estimate. */
  overEstimate: boolean;
  /** No lane time for `pausedAfterDays`. */
  paused: boolean;
  /** How much its fit was penalised when it was placed (0 = a clean fit). */
  penalty: number;
  /** Why, in words. */
  reasons: string[];
}

export interface Forecast {
  today: string;
  pace: Pace;
  overrun: number;
  week: WeekSummary;
  lanes: LaneEntry[][];
  live: { item: string; weekly: number }[];
  /** Active items that are not in a lane (more active items than lanes). */
  overflow: string[];
  /** Side items (casual games), running outside the lanes. */
  side: string[];
  /** When the last lane empties; null when nothing is planned. */
  finish: Range | null;
}

export interface Suggestion {
  item: string;
  penalty: number;
  reasons: string[];
}
