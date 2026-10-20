/**
 * Transport: each item has a transport type (set in the Data tab's Items; an
 * item without one gets no lanes and is flagged), each type has tiers with a rate per lane. A
 * connection uses its own tier if one was picked, else the plan's default for
 * the type, else the type's first tier, and needs ceil(rate / tier rate) lanes.
 */

import { itemKey, PER_SECONDS, type Amount, type Per, type TransportTier } from './parse';

export interface TransportBook {
  tiers: TransportTier[];
  /** Item key → transport type. */
  types: Map<string, string>;
}

export interface TransportChoice {
  /** Transport type key → default tier name. */
  defaults: Record<string, string>;
  /** Connection key (see `haulKey`) → tier name. */
  edges: Record<string, string>;
}

export interface Haul {
  item: string;
  qty: number;
  type: string;
  tier: TransportTier;
  lanes: number;
  /** The tier was picked for this connection. */
  custom: boolean;
}

export const EMPTY_BOOK: TransportBook = { tiers: [], types: new Map() };
export const NO_CHOICE: TransportChoice = { defaults: {}, edges: {} };

export const haulKey = (source: string, target: string, item: string): string => `${source}>${target}>${itemKey(item)}`;

/** Transport types in table order. */
export function transportTypes(book: TransportBook): string[] {
  const seen = new Map<string, string>();
  for (const t of book.tiers) if (!seen.has(itemKey(t.type))) seen.set(itemKey(t.type), t.type);
  return [...seen.values()];
}

export const tiersOf = (book: TransportBook, type: string): TransportTier[] => book.tiers.filter((t) => itemKey(t.type) === itemKey(type));

export function itemType(book: TransportBook, item: string): string | undefined {
  return book.types.get(itemKey(item));
}

/** The plan-wide tier for a type. */
export function defaultTier(book: TransportBook, choice: TransportChoice, type: string): TransportTier | undefined {
  const tiers = tiersOf(book, type);
  const picked = choice.defaults[itemKey(type)];
  return tiers.find((t) => itemKey(t.name) === itemKey(picked ?? '')) ?? tiers[0];
}

/** How one item moves along one connection, or null when it has no transport type (or its type has no tier). */
export function haul(book: TransportBook, choice: TransportChoice, per: Per, source: string, target: string, a: Amount): Haul | null {
  const type = itemType(book, a.item);
  if (!type) return null;
  const own = choice.edges[haulKey(source, target, a.item)];
  const mine = own ? tiersOf(book, type).find((t) => itemKey(t.name) === itemKey(own)) : undefined;
  const tier = mine ?? defaultTier(book, choice, type);
  if (!tier) return null;
  const perMin = (a.qty * 60) / PER_SECONDS[per];
  return { item: a.item, qty: a.qty, type, tier, lanes: Math.max(1, Math.ceil(perMin / tier.rate - 1e-9)), custom: !!mine };
}

/** Default tiers from tier names (the block's `tier:` line). */
export function defaultsFromNames(book: TransportBook, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const t = book.tiers.find((x) => itemKey(x.name) === itemKey(n));
    if (t) out[itemKey(t.type)] = t.name;
  }
  return out;
}
