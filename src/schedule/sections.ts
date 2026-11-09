import type { DatabaseConfig, PropertyConfig, ScheduleConfig, ScheduleSection, SectionCondition, SectionKind } from '../types';
import { asArray } from '../render/values';

/** Kinds shown in the view (the Move modal's Plan tab); the rest end or hide an item. */
export const SHOWN_KINDS: SectionKind[] = ['lanes', 'queue', 'live', 'side'];
export const isShown = (kind: SectionKind): boolean => SHOWN_KINDS.includes(kind);

/** A property value as the schedule compares it: the first value of a select, `true` only for a ticked checkbox. */
const valueOf = (values: Record<string, unknown>, property: string): string => String(asArray(values[property])[0] ?? '');

export function conditionHolds(values: Record<string, unknown>, c: SectionCondition): boolean {
  switch (c.op) {
    case 'is':
      return valueOf(values, c.property) === c.value;
    case 'anyOf':
      return c.value.includes(valueOf(values, c.property));
    case 'checked':
      return values[c.property] === true;
    case 'unchecked':
      return values[c.property] !== true;
  }
}

export const sectionMatches = (values: Record<string, unknown>, s: ScheduleSection): boolean => s.conditions.every((c) => conditionHolds(values, c));

/** The first section an item matches, or -1. */
export function matchSection(values: Record<string, unknown>, sections: ScheduleSection[]): number {
  return sections.findIndex((s) => sectionMatches(values, s));
}

export type Writes = Record<string, string | boolean>;

/**
 * What to write so an item with `values` lands in section `target`: the
 * target's conditions, plus a flipped checkbox for each section above that
 * would still catch it. Null when a section above can't be escaped that way.
 */
export function moveWrites(values: Record<string, unknown>, sections: ScheduleSection[], target: number): Writes | null {
  const t = sections[target];
  if (!t) return null;
  const writes: Writes = {};
  for (const c of t.conditions) {
    if (conditionHolds(values, c)) continue;
    writes[c.property] = c.op === 'is' ? c.value : c.op === 'anyOf' ? c.value[0] : c.op === 'checked';
  }
  const fixed = new Set(t.conditions.map((c) => c.property));
  const next = { ...values, ...writes };
  for (let i = 0; i < target; i++) {
    if (!sectionMatches(next, sections[i])) continue;
    const flip = sections[i].conditions.find((c) => (c.op === 'checked' || c.op === 'unchecked') && !fixed.has(c.property));
    if (!flip) return null;
    writes[flip.property] = flip.op === 'unchecked';
    next[flip.property] = writes[flip.property];
  }
  return matchSection(next, sections) === target ? writes : null;
}

/** Only properties with fixed options can be in a condition. */
export const conditionProperties = (config: DatabaseConfig): PropertyConfig[] => config.properties.filter((p) => p.type === 'select' || p.type === 'checkbox');

const KIND_NAMES: Record<SectionKind, string> = {
  lanes: 'Lanes',
  queue: 'Queue',
  live: 'Live',
  side: 'Also playing',
  finished: 'Completed',
  dropped: 'Dropped',
  hidden: 'On hold',
};
export const kindName = (kind: SectionKind): string => KIND_NAMES[kind];

const LEGACY_STATUSES = { pool: ['planned'], active: ['playing'], finished: ['completed'], dropped: ['dropped'], paused: ['on-hold'] };

/**
 * Sections for a view that has none yet, from its older settings (status
 * property, status roles, live checkbox) and a checkbox named like "casual".
 */
export function defaultSections(config: DatabaseConfig, c: Pick<ScheduleConfig, 'status' | 'statuses' | 'live'>): ScheduleSection[] {
  const props = config.properties;
  const status = c.status ?? props.find((p) => p.type === 'select' && /status/i.test(p.name))?.name ?? props.find((p) => p.type === 'select')?.name;
  if (!status) return [];
  const known = new Set(props.find((p) => p.name === status)?.options?.map((o) => o.value) ?? []);
  // Keep listed values; without a list, trust the roles as written.
  const roles = c.statuses ?? LEGACY_STATUSES;
  const values = (list: string[]): string[] => (known.size ? list.filter((v) => known.has(v)) : list);
  const of = (list: string[]): SectionCondition | null => {
    const v = values(list);
    return v.length === 0 ? null : v.length === 1 ? { property: status, op: 'is', value: v[0] } : { property: status, op: 'anyOf', value: v };
  };
  const checkbox = (name: string | undefined, re: RegExp): string | undefined =>
    props.find((p) => p.type === 'checkbox' && (name ? p.name === name : re.test(p.name) || re.test(p.label ?? '')))?.name;
  const live = checkbox(c.live, /live/i);
  const casual = checkbox(undefined, /casual|side/i);

  const out: ScheduleSection[] = [];
  const add = (kind: SectionKind, cond: SectionCondition | null, extra?: SectionCondition): void => {
    if (cond) out.push({ name: kindName(kind), kind, conditions: extra ? [cond, extra] : [cond] });
  };
  const active = of(roles.active);
  if (live) add('live', active, { property: live, op: 'checked' });
  if (casual && casual !== live) add('side', active, { property: casual, op: 'checked' });
  add('lanes', active);
  add('queue', of(roles.pool));
  add('hidden', of(roles.paused));
  add('finished', of(roles.finished));
  add('dropped', of(roles.dropped));
  return out;
}

/**
 * A side section to add when there is none: the lanes conditions plus a ticked
 * "casual" checkbox (made when missing), placed just above the lanes section.
 */
export function addSideSection(config: DatabaseConfig, sections: ScheduleSection[]): { sections: ScheduleSection[]; index: number; property: PropertyConfig | null } | null {
  const lanes = sections.findIndex((s) => s.kind === 'lanes');
  if (lanes < 0 || sections.some((s) => s.kind === 'side')) return null;
  const used = new Set(sections.flatMap((s) => s.conditions.map((c) => c.property)));
  const existing = config.properties.find((p) => p.type === 'checkbox' && !used.has(p.name) && /casual|side/i.test(`${p.name} ${p.label ?? ''}`));
  const taken = new Set(config.properties.map((p) => p.name));
  const name = existing?.name ?? (taken.has('casual') ? 'casual-play' : 'casual');
  const side: ScheduleSection = { name: kindName('side'), kind: 'side', conditions: [...sections[lanes].conditions, { property: name, op: 'checked' }] };
  return {
    sections: [...sections.slice(0, lanes), side, ...sections.slice(lanes)],
    index: lanes,
    property: existing ? null : { name, label: 'Casual', type: 'checkbox' },
  };
}

/** Problems with a section list, in words; empty when it's usable. */
export function sectionProblems(config: DatabaseConfig, sections: ScheduleSection[]): string[] {
  const out: string[] = [];
  for (const kind of ['lanes', 'queue'] as SectionKind[]) {
    const n = sections.filter((s) => s.kind === kind).length;
    if (n === 0) out.push(`Add a ${kindName(kind)} section: the schedule needs one.`);
    if (n > 1) out.push(`Only one ${kindName(kind)} section is used; the others are ignored.`);
  }
  sections.forEach((s, i) => {
    if (s.conditions.length === 0) out.push(`"${s.name}" has no conditions, so it takes every item and nothing below it shows.`);
    for (const c of s.conditions) {
      const p = config.properties.find((q) => q.name === c.property);
      if (!p) out.push(`"${s.name}": the property "${c.property}" doesn't exist.`);
      else if ((c.op === 'checked' || c.op === 'unchecked') !== (p.type === 'checkbox')) out.push(`"${s.name}": "${c.property}" can't be used that way.`);
      else if (p.type !== 'checkbox' && p.type !== 'select') out.push(`"${s.name}": only select and checkbox properties can be used.`);
    }
    const blocker = sections.slice(0, i).find((above) => mayCatch(above, s) && !escapable(above, s));
    if (blocker) out.push(`Moving into "${s.name}" can be blocked by "${blocker.name}" above it: give "${blocker.name}" a checkbox condition, or move it lower.`);
  });
  return out;
}

/** Could an item meeting `target`'s conditions also meet `above`'s? */
function mayCatch(above: ScheduleSection, target: ScheduleSection): boolean {
  return above.conditions.every((a) =>
    target.conditions.every((t) => {
      if (a.property !== t.property) return true;
      const allowed = (c: SectionCondition): string[] | null => (c.op === 'is' ? [c.value] : c.op === 'anyOf' ? c.value : null);
      const [x, y] = [allowed(a), allowed(t)];
      if (x && y) return x.some((v) => y.includes(v));
      if (!x && !y) return a.op === t.op;
      return true;
    }),
  );
}

const escapable = (above: ScheduleSection, target: ScheduleSection): boolean => {
  const fixed = new Set(target.conditions.map((c) => c.property));
  return above.conditions.some((c) => (c.op === 'checked' || c.op === 'unchecked') && !fixed.has(c.property));
};

/** Read sections from a saved view; bad entries are dropped. */
export function parseSections(raw: unknown): ScheduleSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kinds = new Set<SectionKind>(['lanes', 'queue', 'live', 'side', 'finished', 'dropped', 'hidden']);
  const out: ScheduleSection[] = [];
  for (const r of raw) {
    const o = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
    if (typeof o.name !== 'string' || !kinds.has(o.kind as SectionKind)) continue;
    const conditions: SectionCondition[] = [];
    for (const x of Array.isArray(o.conditions) ? o.conditions : []) {
      const c = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      if (typeof c.property !== 'string' || !c.property) continue;
      if (c.op === 'is' && typeof c.value === 'string') conditions.push({ property: c.property, op: 'is', value: c.value });
      else if (c.op === 'anyOf' && Array.isArray(c.value)) {
        const value = c.value.filter((v): v is string => typeof v === 'string');
        if (value.length) conditions.push({ property: c.property, op: 'anyOf', value });
      } else if (c.op === 'checked' || c.op === 'unchecked') conditions.push({ property: c.property, op: c.op });
    }
    out.push({ name: o.name, kind: o.kind as SectionKind, conditions });
  }
  return out;
}
