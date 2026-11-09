import type {
  Forecast,
  HoursByType,
  LaneEntry,
  Pace,
  Range,
  ScheduleItem,
  ScheduleSettings,
  Session,
  SessionType,
  WeekSummary,
} from './types';
import { fromDay, toDay, weekStart } from './dates';
import { byRank, isLong, penalty, rankCandidates } from './rules';

/** Hours assumed for an item without an estimate. */
const UNKNOWN_DURATION = 10;
/** A long item's share of lane time against a short one (55 / 45). */
const LONG_WEIGHT = 55 / 45;
/** Lane pace never drops below this (hours / week), so dates stay finite. */
const MIN_LANE_PACE = 0.5;
/** Overrun factor until enough items are finished to learn it. */
const DEFAULT_OVERRUN = 1.3;
const MIN_FINISHED_FOR_OVERRUN = 5;
/** Simulation stops this many days out. */
const HORIZON_DAYS = 3650;

const emptyHours = (): HoursByType => ({ lane: 0, live: 0, detour: 0, trial: 0 });
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Forecast a backlog worked through `settings.lanes` items at a time, from
 * logged sessions. Pure: same inputs, same output.
 */
export function forecast(items: ScheduleItem[], sessions: Session[], settings: ScheduleSettings, today: string): Forecast {
  const todayDay = toDay(today) ?? 0;
  const byId = new Map(items.map((i) => [i.id, i]));

  // Active items keep their assigned lane, then fill free lanes earliest started first; the rest overflow.
  const active = items.filter((i) => i.state === 'active').sort((a, b) => (toDay(a.start) ?? Infinity) - (toDay(b.start) ?? Infinity) || byRank(a, b));
  const slots: (ScheduleItem | null)[] = Array.from({ length: settings.lanes }, () => null);
  const unassigned: ScheduleItem[] = [];
  for (const i of active) {
    const n = settings.assign?.[i.id];
    if (n !== undefined && n >= 0 && n < settings.lanes && !slots[n]) slots[n] = i;
    else unassigned.push(i);
  }
  for (const i of unassigned) {
    const n = slots.indexOf(null);
    if (n >= 0) slots[n] = i;
  }
  const inLanes = slots.filter((i): i is ScheduleItem => i !== null);
  const laneIds = new Set(inLanes.map((i) => i.id));
  const overflow = active.filter((i) => !laneIds.has(i.id)).map((i) => i.id);

  const typed = sessions.map((s) => ({ ...s, type: s.type ?? inferType(s, byId, laneIds) }));
  const played = new Map<string, number>();
  const lastLane = new Map<string, number>();
  const firstSession = new Map<string, number>();
  for (const s of typed) {
    const day = toDay(s.date);
    if (!s.item || day === null) continue;
    firstSession.set(s.item, Math.min(firstSession.get(s.item) ?? Infinity, day));
    if (s.type !== 'lane') continue;
    played.set(s.item, (played.get(s.item) ?? 0) + s.hours);
    lastLane.set(s.item, Math.max(lastLane.get(s.item) ?? -Infinity, day));
  }

  const pace = computePace(typed, settings, todayDay);
  const overrun = computeOverrun(items, played);
  const factors = { low: Math.min(1, overrun), high: Math.max(1, overrun) };
  const mid = (factors.low + factors.high) / 2;

  const remainingOf = (item: ScheduleItem): { hours: number; over: boolean } => {
    const est = item.duration ?? UNKNOWN_DURATION;
    const left = est - (played.get(item.id) ?? 0);
    // Past the estimate but still going: assume a little more.
    return left > 0 ? { hours: left, over: false } : { hours: Math.max(est * 0.1, 0.5), over: true };
  };

  const lanes = simulate({ items, inLanes: slots, settings, pace, mid, remainingOf, todayDay, factors, firstSession, lastLane });
  const week = weekSummary(typed, inLanes, pace, settings, todayDay, remainingOf);
  const live = liveRates(items, typed, pace, settings, todayDay);
  const ends = lanes.flat().map((e) => e.end);
  const finish = ends.length
    ? { early: ends.map((r) => r.early).sort().at(-1)!, late: ends.map((r) => r.late).sort().at(-1)! }
    : null;

  const side = items.filter((i) => i.state === 'side').map((i) => i.id);
  return { today, pace, overrun, week, lanes, live, overflow, side, finish };
}

/** A session's type when the log doesn't say: live items → live, lane items within their run → lane, else detour. */
function inferType(s: Session, byId: Map<string, ScheduleItem>, laneIds: Set<string>): SessionType {
  const item = s.item ? byId.get(s.item) : undefined;
  if (!item) return 'detour';
  if (item.state === 'live') return 'live';
  const lane = (item.state === 'active' && laneIds.has(item.id)) || item.state === 'ended';
  if (!lane) return 'detour';
  const day = toDay(s.date);
  const start = toDay(item.start);
  const end = toDay(item.end);
  if (day !== null && start !== null && day < start) return 'detour';
  if (day !== null && end !== null && day > end) return 'detour';
  return 'lane';
}

/**
 * Average weekly hours over the last `paceWeeks` full weeks that have history,
 * blended with the estimates while history is shorter than that. The live
 * estimate is unlogged daily time: always counted, logged live time comes on top.
 */
function computePace(sessions: (Session & { type: SessionType })[], settings: ScheduleSettings, todayDay: number): Pace {
  const thisWeek = weekStart(todayDay, settings.weekStart);
  const days = sessions.map((s) => toDay(s.date)).filter((d): d is number => d !== null && d < thisWeek);
  const first = days.length ? weekStart(Math.min(...days), settings.weekStart) : thisWeek;
  const history = Math.max(0, Math.min(settings.paceWeeks, Math.round((thisWeek - first) / 7)));
  const from = thisWeek - history * 7;
  const sums = emptyHours();
  for (const s of sessions) {
    const d = toDay(s.date);
    if (d !== null && d >= from && d < thisWeek) sums[s.type] += s.hours;
  }
  const w = settings.paceWeeks > 0 ? history / settings.paceWeeks : 0;
  const avg = (h: number): number => (history ? h / history : 0);
  const base = settings.estimates.live;
  const weekly = w * (avg(sums.lane + sums.live + sums.detour + sums.trial) + base) + (1 - w) * settings.estimates.weekly;
  const live = base + w * avg(sums.live);
  const other = w * avg(sums.detour + sums.trial);
  const lane = Math.max(MIN_LANE_PACE, weekly - live - other);
  return { weekly: round1(weekly), live: round1(live), other: round1(other), lane: round1(lane), history };
}

/** Median of logged ÷ estimate over finished items; the default until there are enough. */
function computeOverrun(items: ScheduleItem[], played: Map<string, number>): number {
  const ratios = items
    .filter((i) => i.state === 'ended' && i.finished && (i.duration ?? 0) > 0 && (played.get(i.id) ?? 0) > 0)
    .map((i) => played.get(i.id)! / i.duration!)
    .sort((a, b) => a - b);
  if (ratios.length < MIN_FINISHED_FOR_OVERRUN) return DEFAULT_OVERRUN;
  const m = ratios.length >> 1;
  const median = ratios.length % 2 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2;
  return Math.round(Math.min(3, Math.max(0.5, median)) * 100) / 100;
}

interface SimInput {
  items: ScheduleItem[];
  /** The running item per lane (null = free). */
  inLanes: (ScheduleItem | null)[];
  settings: ScheduleSettings;
  pace: Pace;
  mid: number;
  remainingOf: (i: ScheduleItem) => { hours: number; over: boolean };
  todayDay: number;
  factors: { low: number; high: number };
  firstSession: Map<string, number>;
  lastLane: Map<string, number>;
}

interface LaneState {
  current: ScheduleItem | null;
  /** Estimated hours left on the current item. */
  left: number;
  /** Items started from the queue so far (the next pin position). */
  started: number;
  previous: ScheduleItem | null;
  entries: (Omit<LaneEntry, 'start' | 'end'> & { t0: number; t1: number; fixedStart?: number; notBefore?: number })[];
}

/**
 * Event-driven simulation: advance to the next lane that frees up, fill it (a
 * pin for that slot, else the best candidate), repeat. Sim time `t` is days
 * from today at the estimates as given; real days are `t × factor` — `mid` for
 * decisions (pins' not-before dates), `low` / `high` for the date ranges.
 */
function simulate(input: SimInput): LaneEntry[][] {
  const { items, inLanes, settings, pace, mid, remainingOf, todayDay, factors, firstSession, lastLane } = input;
  const byId = new Map(items.map((i) => [i.id, i]));
  const pinsByLane = new Map<number, typeof settings.pins>();
  const pinned = new Set<string>();
  /** Items the schedule places itself, but not before a day. */
  const holds = new Map<string, number>();
  for (const p of settings.pins) {
    const item = byId.get(p.item);
    if (!item || item.state !== 'pool') continue;
    if (p.lane < 0) {
      const d = toDay(p.notBefore);
      if (d !== null) holds.set(p.item, d);
      continue;
    }
    if (p.lane >= settings.lanes) continue;
    pinned.add(p.item);
    pinsByLane.set(p.lane, [...(pinsByLane.get(p.lane) ?? []), p].sort((a, b) => a.position - b.position));
  }
  const pool = items.filter((i) => i.state === 'pool' && !pinned.has(i.id));
  const used = new Set<string>();

  const lanes: LaneState[] = Array.from({ length: settings.lanes }, (_, n) => {
    const item = inLanes[n] ?? null;
    const lane: LaneState = { current: item, left: 0, started: 0, previous: null, entries: [] };
    if (item) {
      const r = remainingOf(item);
      lane.left = r.hours;
      const start = toDay(item.start) ?? firstSession.get(item.id) ?? todayDay;
      const last = lastLane.get(item.id) ?? toDay(item.start);
      lane.entries.push({
        item: item.id,
        current: true,
        remaining: round1(r.hours),
        pinned: false,
        overEstimate: r.over,
        paused: last !== undefined && last !== null && todayDay - last >= settings.pausedAfterDays,
        penalty: 0,
        reasons: [],
        t0: 0,
        t1: -1,
        fixedStart: start,
      });
    }
    return lane;
  });

  /** Lane hours per day for each lane, given which are occupied. */
  const rates = (): number[] => {
    const weights = lanes.map((l) => (l.current ? (isLong(l.current, settings) ? LONG_WEIGHT : 1) : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => (total ? (pace.lane / 7) * (w / total) : 0));
  };

  /** Start the next item in a free lane at time t; returns false if nothing can start now. */
  const fill = (n: number, t: number): boolean => {
    const lane = lanes[n];
    const day = todayDay + t * mid;
    const running = lanes.filter((l, i) => i !== n && l.current).map((l) => l.current!);
    const pins = (pinsByLane.get(n) ?? []).filter((p) => !used.has(p.item));
    const due = pins.find((p) => p.position <= lane.started && (toDay(p.notBefore) ?? -Infinity) <= day);
    const remainingPool = pool.filter((i) => !used.has(i.id) && (holds.get(i.id) ?? -Infinity) <= day);
    let next: ScheduleItem | null = null;
    let fit = { total: 0, reasons: [] as string[] };
    let pin: (typeof pins)[number] | undefined;
    if (due) {
      pin = due;
    } else if (remainingPool.length) {
      const best = rankCandidates(remainingPool, running, lane.previous, settings)[0];
      next = byId.get(best.item)!;
      fit = { total: best.penalty, reasons: best.reasons };
    } else {
      // Only pins left: take the next one that may start now.
      pin = pins.find((p) => (toDay(p.notBefore) ?? -Infinity) <= day);
    }
    if (pin) {
      next = byId.get(pin.item)!;
      fit = penalty(next, running, lane.previous, settings);
    }
    if (!next) return false;
    used.add(next.id);
    lane.current = next;
    lane.started++;
    const r = remainingOf(next);
    lane.left = r.hours;
    lane.entries.push({
      item: next.id,
      current: false,
      remaining: round1(r.hours),
      pinned: !!pin,
      overEstimate: false,
      paused: false,
      penalty: fit.total,
      reasons: fit.reasons,
      t0: t,
      t1: -1,
      notBefore: toDay(pin?.notBefore) ?? holds.get(next.id),
    });
    return true;
  };

  /** The earliest pending notBefore after `t` (in sim time), if any lane waits on one. */
  const nextWake = (t: number): number | null => {
    let best: number | null = null;
    for (const [, pins] of pinsByLane) {
      for (const p of pins) {
        if (used.has(p.item)) continue;
        const d = toDay(p.notBefore);
        if (d === null) continue;
        const at = (d - todayDay) / mid;
        if (at > t && (best === null || at < best)) best = at;
      }
    }
    for (const [id, d] of holds) {
      if (used.has(id)) continue;
      const at = (d - todayDay) / mid;
      if (at > t && (best === null || at < best)) best = at;
    }
    return best;
  };

  let t = 0;
  for (let n = 0; n < lanes.length; n++) if (!lanes[n].current) fill(n, t);
  for (let guard = 0; guard < items.length * 3 + settings.pins.length + 10; guard++) {
    const r = rates();
    let step = Infinity;
    let which = -1;
    lanes.forEach((l, n) => {
      if (!l.current || r[n] <= 0) return;
      const dt = l.left / r[n];
      if (dt < step) (step = dt), (which = n);
    });
    const wake = nextWake(t);
    if (which < 0 && wake === null) break;
    if (wake !== null && wake - t < step) {
      for (const [n, l] of lanes.entries()) l.left -= l.current ? r[n] * (wake - t) : 0;
      t = wake;
      for (let n = 0; n < lanes.length; n++) if (!lanes[n].current) fill(n, t);
      continue;
    }
    for (const [n, l] of lanes.entries()) if (l.current) l.left -= r[n] * step;
    t += step;
    if (t * mid > HORIZON_DAYS) break;
    const done = lanes[which];
    done.entries[done.entries.length - 1].t1 = t;
    done.previous = done.current;
    done.current = null;
    done.left = 0;
    fill(which, t);
  }

  /** Start and end day at a factor; a not-before date shifts the whole span later. */
  const span = (t0: number, t1: number, f: number, notBefore?: number): [number, number] => {
    const a = todayDay + Math.round(t0 * f);
    const b = todayDay + Math.round(t1 * f);
    const shift = notBefore !== undefined && a < notBefore ? notBefore - a : 0;
    return [a + shift, b + shift];
  };
  // Entries still running at the horizon have no end and are left out.
  return lanes.map((l) =>
    l.entries
      .filter((e) => e.t1 >= 0)
      .map(({ t0, t1, fixedStart, notBefore, ...e }) => {
        const [sEarly, eEarly] = span(t0, t1, factors.low, notBefore);
        const [sLate, eLate] = span(t0, t1, factors.high, notBefore);
        const start: Range = fixedStart !== undefined
          ? { early: fromDay(fixedStart), late: fromDay(fixedStart) }
          : { early: fromDay(sEarly), late: fromDay(sLate) };
        return { ...e, start, end: { early: fromDay(eEarly), late: fromDay(Math.max(eLate, eEarly)) } };
      }),
  );
}

/** This week's logged hours, and how the lane hours left could split. */
function weekSummary(
  sessions: (Session & { type: SessionType })[],
  inLanes: ScheduleItem[],
  pace: Pace,
  settings: ScheduleSettings,
  todayDay: number,
  remainingOf: (i: ScheduleItem) => { hours: number },
): WeekSummary {
  const start = weekStart(todayDay, settings.weekStart);
  const logged = emptyHours();
  for (const s of sessions) {
    const d = toDay(s.date);
    if (d !== null && d >= start && d <= todayDay) logged[s.type] += s.hours;
  }
  let left = Math.max(0, pace.lane - logged.lane);
  const need = inLanes.map((i) => ({ item: i.id, cap: remainingOf(i).hours, w: isLong(i, settings) ? LONG_WEIGHT : 1, hours: 0 }));
  // Fill by weight; an item needing less than its share gives the rest to the others.
  for (let pass = 0; pass < need.length && left > 0.01; pass++) {
    const open = need.filter((n) => n.hours < n.cap);
    const total = open.reduce((a, n) => a + n.w, 0);
    if (!total) break;
    let spent = 0;
    for (const n of open) {
      const give = Math.min(n.cap - n.hours, (left * n.w) / total);
      n.hours += give;
      spent += give;
    }
    left -= spent;
  }
  for (const k of Object.keys(logged) as SessionType[]) logged[k] = round1(logged[k]);
  return { start: fromDay(start), logged, budget: pace.weekly, suggested: need.map((n) => ({ item: n.item, hours: round1(n.hours) })) };
}

/** Weekly hours per live item: an even share of the unlogged baseline, plus its logged average (weighted by history). */
function liveRates(
  items: ScheduleItem[],
  sessions: (Session & { type: SessionType })[],
  pace: Pace,
  settings: ScheduleSettings,
  todayDay: number,
): { item: string; weekly: number }[] {
  const live = items.filter((i) => i.state === 'live');
  if (!live.length) return [];
  const thisWeek = weekStart(todayDay, settings.weekStart);
  const from = thisWeek - pace.history * 7;
  const sums = new Map<string, number>();
  for (const s of sessions) {
    const d = toDay(s.date);
    if (s.item && s.type === 'live' && d !== null && d >= from && d < thisWeek) sums.set(s.item, (sums.get(s.item) ?? 0) + s.hours);
  }
  const w = settings.paceWeeks > 0 ? pace.history / settings.paceWeeks : 0;
  const share = settings.estimates.live / live.length;
  return live
    .map((i) => ({ item: i.id, weekly: round1(share + w * (pace.history ? (sums.get(i.id) ?? 0) / pace.history : 0)) }))
    .sort((a, b) => b.weekly - a.weekly);
}
