import type { Forecast, ScheduleItem, ScheduleSettings, Suggestion } from './types';
import { rankCandidates } from './rules';

/**
 * What could start in `lane` now: waiting items ranked against what runs in
 * the other lanes and what just ended here (`previous`).
 */
export function nextCandidates(
  items: ScheduleItem[],
  result: Forecast,
  lane: number,
  previous: string | null,
  settings: ScheduleSettings,
): Suggestion[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const running = result.lanes
    .map((l, n) => (n === lane ? null : l.find((e) => e.current)?.item))
    .filter((id): id is string => !!id && id !== previous)
    .map((id) => byId.get(id)!)
    .filter(Boolean);
  const pool = items.filter((i) => i.state === 'pool');
  return rankCandidates(pool, running, previous ? byId.get(previous) ?? null : null, settings);
}

/** The lane a running item is in, or -1. */
export function laneOf(result: Forecast, item: string): number {
  return result.lanes.findIndex((l) => l.some((e) => e.item === item));
}
