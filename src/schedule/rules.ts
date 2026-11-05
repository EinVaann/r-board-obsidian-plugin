import type { ScheduleItem, ScheduleSettings, Suggestion } from './types';

const norm = (v: string): string => v.trim().toLowerCase();

/** How two items overlap: an exact shared value, a similar-group match, or nothing. */
export function clash(a: ScheduleItem, b: ScheduleItem, similar: string[][]): { kind: 'same' | 'similar'; label: string } | null {
  const theirs = new Set(b.vary.map(norm));
  for (const v of a.vary) if (theirs.has(norm(v))) return { kind: 'same', label: v };
  for (const v of a.vary) {
    const key = norm(v);
    for (const group of similar) {
      if (!group.some((g) => norm(g) === key)) continue;
      const hit = b.vary.find((x) => group.some((g) => norm(g) === norm(x)));
      if (hit) return { kind: 'similar', label: `${v} ≈ ${hit}` };
    }
  }
  return null;
}

export const isLong = (item: ScheduleItem, settings: ScheduleSettings): boolean => (item.duration ?? 0) > settings.longOver;

export interface Penalty {
  total: number;
  reasons: string[];
}

/**
 * How much less `candidate` fits a lane right now. `running`: items in the
 * other lanes at that time; `previous`: the item that just ended in this lane.
 * Nothing is forbidden — penalties only lower the rank.
 */
export function penalty(candidate: ScheduleItem, running: ScheduleItem[], previous: ScheduleItem | null, settings: ScheduleSettings): Penalty {
  const p = settings.penalties;
  const out: Penalty = { total: 0, reasons: [] };
  const add = (amount: number, reason: string): void => {
    if (amount <= 0) return;
    out.total += amount;
    out.reasons.push(reason);
  };
  const weigh = (c: { kind: 'same' | 'similar' }, base: number): number => (c.kind === 'same' ? base : base * p.similarFactor);
  for (const other of running) {
    const c = clash(candidate, other, settings.similar);
    if (c) add(weigh(c, p.running), `${c.label}, like ${other.title} (running)`);
  }
  if (previous) {
    const c = clash(candidate, previous, settings.similar);
    if (c) add(weigh(c, p.previous), `${c.label}, like ${previous.title} (just before)`);
  }
  if (isLong(candidate, settings)) {
    const long = running.find((o) => isLong(o, settings));
    if (long) add(p.long, `second long game next to ${long.title}`);
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}

/** Highest score first, then earliest created, then title. */
export function byRank(a: ScheduleItem, b: ScheduleItem): number {
  return (b.score ?? -Infinity) - (a.score ?? -Infinity) || (a.created ?? Infinity) - (b.created ?? Infinity) || a.title.localeCompare(b.title);
}

/** Candidates for a lane, best first by score minus penalty (ties: plain rank). */
export function rankCandidates(pool: ScheduleItem[], running: ScheduleItem[], previous: ScheduleItem | null, settings: ScheduleSettings): Suggestion[] {
  return pool
    .map((item) => ({ item, p: penalty(item, running, previous, settings) }))
    .sort((a, b) => (b.item.score ?? 0) - b.p.total - ((a.item.score ?? 0) - a.p.total) || byRank(a.item, b.item))
    .map(({ item, p }) => ({ item: item.id, penalty: p.total, reasons: p.reasons }));
}

/** A random candidate among the least penalised ones. */
export function randomCandidate(ranked: Suggestion[], random: () => number = Math.random): Suggestion | null {
  if (!ranked.length) return null;
  const least = Math.min(...ranked.map((s) => s.penalty));
  const from = ranked.filter((s) => s.penalty === least);
  return from[Math.floor(random() * from.length)];
}
