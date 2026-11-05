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
 * Undo manual ordering in `lane` (or every lane when undefined): pins there
 * are dropped, except not-before holds, which are kept at their place.
 */
export function replan(pins: Pin[], lane?: number): Pin[] {
  return pins.filter((p) => (lane !== undefined && p.lane !== lane) || !!p.notBefore);
}

/** Pins that `replan` would drop. */
export function movedPins(pins: Pin[], lane?: number): number {
  return pins.length - replan(pins, lane).length;
}

/** Pins of items that are still waiting (others no longer mean anything). */
export function livePins(pins: Pin[], waiting: Set<string>): Pin[] {
  return pins.filter((p) => waiting.has(p.item));
}
