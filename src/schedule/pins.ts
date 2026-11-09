import type { Pin } from './types';

/** Pins without `item`. */
export function unpin(pins: Pin[], item: string): Pin[] {
  return pins.filter((p) => p.item !== item);
}

/**
 * Place `item` at `position` among `lane`'s queued items. Other pins in that
 * lane at or after the position move one down; a not-before date is kept.
 */
export function placePin(pins: Pin[], item: string, lane: number, position: number): Pin[] {
  const old = pins.find((p) => p.item === item);
  const rest = unpin(pins, item).map((p) => (p.lane === lane && p.position >= position ? { ...p, position: p.position + 1 } : p));
  const pin: Pin = { item, lane, position };
  if (old?.notBefore) pin.notBefore = old.notBefore;
  return [...rest, pin];
}

/** Set or clear (`null`) a pin's not-before date; an unpinned item is pinned where it is. */
export function setNotBefore(pins: Pin[], item: string, lane: number, position: number, date: string | null): Pin[] {
  const old = pins.find((p) => p.item === item) ?? { item, lane, position };
  const next: Pin = { item, lane: old.lane, position: old.position };
  if (date) next.notBefore = date;
  return [...unpin(pins, item), next];
}

/**
 * Where a queued item goes, as chosen in the Move modal: a lane and position
 * pins it there; no lane leaves it to the schedule (with a not-before date,
 * as a hold). Other pins in the target lane shift like `placePin`.
 */
export function placeQueued(pins: Pin[], item: string, lane: number | null, position: number | null, notBefore: string | null): Pin[] {
  if (lane === null || position === null) {
    const rest = unpin(pins, item);
    return notBefore ? [...rest, { item, lane: -1, position: -1, notBefore }] : rest;
  }
  const placed = placePin(pins, item, lane, position);
  return placed.map((p) => {
    if (p.item !== item) return p;
    const { notBefore: _, ...bare } = p;
    return notBefore ? { ...bare, notBefore } : bare;
  });
}

/** Toggle a queued item's pin at the place it's shown (double-click); a not-before date stays. */
export function togglePin(pins: Pin[], item: string, lane: number, position: number): Pin[] {
  const old = pins.find((p) => p.item === item);
  if (old && old.lane >= 0) return old.notBefore ? [...unpin(pins, item), { item, lane: -1, position: -1, notBefore: old.notBefore }] : unpin(pins, item);
  const pin: Pin = { item, lane, position };
  if (old?.notBefore) pin.notBefore = old.notBefore;
  return [...unpin(pins, item), pin];
}

/**
 * Undo manual ordering in `lane` (or every lane when undefined): pins there
 * are dropped, except not-before holds, which are kept at their place.
 */
export function replan(pins: Pin[], lane?: number): Pin[] {
  return pins.filter((p) => p.lane < 0 || (lane !== undefined && p.lane !== lane) || !!p.notBefore);
}

/** Pins that `replan` would drop. */
export function movedPins(pins: Pin[], lane?: number): number {
  return pins.length - replan(pins, lane).length;
}

/** Pins of items that are still waiting (others no longer mean anything). */
export function livePins(pins: Pin[], waiting: Set<string>): Pin[] {
  return pins.filter((p) => waiting.has(p.item));
}
