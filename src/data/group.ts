import type { BoardItem, DateBucket, GroupColumnConfig, PropertyConfig } from '../types';
import { asArray, asBoolean, asDate, optionFor } from '../render/values';
import { formatDate, toText, type FValue } from '../formula/evaluate';
import { formulaOverride } from './compute';
import { referencedNames } from '../formula/tokenize';

/** Label for the bucket of items missing the group property. */
export const UNCATEGORIZED_LABEL = 'Uncategorized';
/** How the Uncategorized bucket (key null) is saved in `collapsed` lists. */
export const NONE_KEY = '__none__';

/** A bucket of items sharing one value of the group property. */
export interface ItemGroup {
  /** The group value (null = missing/empty). */
  key: string | null;
  label: string;
  /** Header color: the view's override, else the option's color. */
  color?: string;
  items: BoardItem[];
}

interface Category {
  key: string;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Relative date groups in time order (keys sort as strings); `days` = the date used when adding into one. */
const RELATIVE = [
  { key: 'r0', label: 'Older', days: -31 },
  { key: 'r1', label: 'Last 30 days', days: -8 },
  { key: 'r2', label: 'Last 7 days', days: -2 },
  { key: 'r3', label: 'Yesterday', days: -1 },
  { key: 'r4', label: 'Today', days: 0 },
  { key: 'r5', label: 'Tomorrow', days: 1 },
  { key: 'r6', label: 'Next 7 days', days: 2 },
  { key: 'r7', label: 'Next 30 days', days: 8 },
  { key: 'r8', label: 'Later', days: 31 },
];

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The group of a date in a bucket. Keys sort chronologically as strings. */
export function bucketDate(d: Date, bucket: DateBucket, today = new Date()): Category {
  switch (bucket) {
    case 'relative': {
      const diff = Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / 864e5);
      const i = diff < -30 ? 0 : diff < -7 ? 1 : diff < -1 ? 2 : diff === -1 ? 3 : diff === 0 ? 4 : diff === 1 ? 5 : diff <= 7 ? 6 : diff <= 30 ? 7 : 8;
      return { key: RELATIVE[i].key, label: RELATIVE[i].label };
    }
    case 'year':
      return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return { key: `${d.getFullYear()}-Q${q}`, label: `${d.getFullYear()} Q${q}` };
    }
    case 'month':
      return { key: formatDate(d, 'YYYY-MM'), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
    case 'week': {
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return { key: formatDate(monday, 'YYYY-MM-DD'), label: `Week of ${MONTHS[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}` };
    }
    default:
      return { key: formatDate(d, 'YYYY-MM-DD'), label: formatDate(d, 'YYYY-MM-DD') };
  }
}

/** The group an item falls in for a property, or null (Uncategorized). A list groups by its first value. */
function categoryOf(item: BoardItem, prop: PropertyConfig, bucket: DateBucket, today: Date): Category | null {
  const raw = item.values[prop.name];
  if (raw === undefined || raw === null || raw === '') return null;
  switch (prop.type) {
    case 'checkbox':
      return asBoolean(raw) ? { key: 'true', label: 'Checked' } : { key: 'false', label: 'Unchecked' };
    case 'select':
    case 'multi': {
      const first = asArray(raw)[0];
      return first === undefined ? null : { key: first, label: optionFor(prop, first).label };
    }
    case 'date': {
      const d = asDate(raw);
      if (d && bucket !== 'none') return bucketDate(d, bucket, today);
      break;
    }
    case 'formula':
      if (raw instanceof Date) return bucketDate(raw, bucket === 'none' ? 'day' : bucket, today);
      if (Array.isArray(raw) && raw.length === 0) return null;
      if (Array.isArray(raw) || typeof raw === 'boolean' || typeof raw === 'number') {
        const text = toText(raw as FValue);
        return { key: text, label: text };
      }
      break;
  }
  const first = asArray(raw)[0];
  return first === undefined ? null : { key: first, label: first };
}

/** The group value of an item for a property: a single key, or null. */
export function groupValueOf(item: BoardItem, prop: PropertyConfig, bucket: DateBucket = 'none'): string | null {
  return categoryOf(item, prop, bucket, new Date())?.key ?? null;
}

export interface GroupOptions {
  /** Values that lead, in this order (always present, even when empty). */
  order?: string[];
  /** Per-group label / color / hidden overrides. */
  groupConfig?: Record<string, GroupColumnConfig>;
  /** Date bucketing for date properties. */
  bucket?: DateBucket;
  today?: Date;
}

/**
 * Partition items into groups by a property. Pinned `order` values lead, then
 * the property's listed options (always shown), then the rest — dates
 * chronologically, numbers numerically, text A→Z; Uncategorized is last
 * (omitted when empty). Hidden groups are dropped with their items.
 */
export function groupItems(items: BoardItem[], prop: PropertyConfig, opts: GroupOptions = {}): ItemGroup[] {
  const { order, groupConfig, bucket = 'none', today = new Date() } = opts;
  const buckets = new Map<string, { label: string; items: BoardItem[] }>();
  const uncategorized: BoardItem[] = [];

  for (const item of items) {
    const cat = categoryOf(item, prop, bucket, today);
    if (!cat) {
      uncategorized.push(item);
      continue;
    }
    const b = buckets.get(cat.key);
    if (b) b.items.push(item);
    else buckets.set(cat.key, { label: cat.label, items: [item] });
  }

  const hasOptions = prop.type === 'select' || prop.type === 'multi';
  const listed = new Set(prop.options?.map((o) => o.value));
  const make = (key: string): ItemGroup => {
    const cfg = groupConfig?.[key];
    const opt = hasOptions ? optionFor(prop, key) : undefined;
    // Free values only get a color once they are listed as options (or given one per view).
    const color = cfg?.color ?? (opt && (listed.has(key) || prop.type === 'select') ? opt.color : undefined);
    const label = cfg?.label ?? opt?.label ?? buckets.get(key)?.label ?? relativeLabel(key, bucket) ?? key;
    return { key, label, color, items: buckets.get(key)?.items ?? [] };
  };
  const isHidden = (key: string): boolean => groupConfig?.[key]?.hidden === true;

  const groups: ItemGroup[] = [];
  const seen = new Set<string>();
  for (const value of order ?? (hasOptions ? [...listed] : [])) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (!isHidden(value)) groups.push(make(value));
  }

  const rest = [...buckets.keys()].filter((k) => !seen.has(k));
  const numeric = prop.type === 'number' || (prop.type === 'formula' && rest.every((k) => !Number.isNaN(Number(k))));
  rest.sort((a, b) => (numeric ? Number(a) - Number(b) : prop.type === 'checkbox' ? b.localeCompare(a) : a.localeCompare(b, undefined, { numeric: true })));
  for (const value of rest) if (!isHidden(value)) groups.push(make(value));

  if (uncategorized.length > 0 && !isHidden(NONE_KEY)) {
    groups.push({ key: null, label: groupConfig?.[NONE_KEY]?.label ?? UNCATEGORIZED_LABEL, items: uncategorized });
  }
  return groups;
}

function relativeLabel(key: string, bucket: DateBucket): string | undefined {
  return bucket === 'relative' ? RELATIVE.find((r) => r.key === key)?.label : undefined;
}

/** The collapsed-list key of a group. */
export const collapseKey = (key: string | null): string => key ?? NONE_KEY;

/**
 * The stored value that puts a new item into group `key`, or undefined when it
 * can't be stored directly (formulas: see `cellsForGroup`). Uncategorized → null.
 */
export function cellForGroup(prop: PropertyConfig, bucket: DateBucket, key: string | null, today = new Date()): unknown {
  if (prop.type === 'formula') return undefined;
  if (key === null) return null;
  switch (prop.type) {
    case 'multi':
    case 'links':
      return [key];
    case 'checkbox':
      return key === 'true';
    case 'number': {
      const n = Number(key);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': {
      if (bucket === 'relative') {
        const r = RELATIVE.find((x) => x.key === key);
        return r ? formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + r.days), 'YYYY-MM-DD') : null;
      }
      if (bucket === 'none') return key;
      // Prefer today when it falls in the group, else the period's first day.
      if (bucketDate(today, bucket).key === key) return formatDate(today, 'YYYY-MM-DD');
      return firstDayOf(key, bucket);
    }
    default:
      return key;
  }
}

function firstDayOf(key: string, bucket: DateBucket): string | null {
  if (bucket === 'year') return `${key}-01-01`;
  if (bucket === 'month') return `${key}-01`;
  if (bucket === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    return m ? `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01` : null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/**
 * Starting values for an item added inside a group. A stored property gets the
 * group's value; for a formula, the stored inputs it reads (directly or through
 * other formulas) are copied from `template`, an item already in the group.
 */
export function cellsForGroup(
  prop: PropertyConfig,
  properties: PropertyConfig[],
  bucket: DateBucket,
  group: ItemGroup,
  template?: BoardItem,
): Record<string, unknown> {
  if (prop.type !== 'formula') {
    const v = cellForGroup(prop, bucket, group.key);
    return v === undefined || v === null ? {} : { [prop.name]: v };
  }
  if (!template) return {};
  const stored = template.stored ?? template.values;
  const byRef = new Map<string, PropertyConfig>();
  for (const p of properties) for (const n of [p.label, p.name]) if (n && !byRef.has(n.toLowerCase())) byRef.set(n.toLowerCase(), p);
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  const visit = (src: string): void => {
    for (const name of referencedNames(src)) {
      const ref = byRef.get(name.toLowerCase());
      if (!ref || seen.has(ref.name)) continue;
      seen.add(ref.name);
      const raw = stored[ref.name];
      if (ref.type === 'formula') {
        // A per-item override is itself an input; otherwise follow the formula.
        if (formulaOverride(raw) !== 'none') out[ref.name] = raw;
        else visit(ref.formula ?? '');
      } else if (raw !== undefined && raw !== null && raw !== '') {
        out[ref.name] = Array.isArray(raw) ? [...raw] : raw;
      }
    }
  };
  const own = stored[prop.name];
  visit(formulaOverride(own) === 'formula' ? String(own).slice(1) : prop.formula ?? '');
  return out;
}
