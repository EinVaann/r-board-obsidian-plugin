import type {
  DatabaseConfig,
  FilterOp,
  FilterRule,
  LoadLimit,
  PropertyConfig,
  ViewConfig,
  ViewType,
} from './types';

const PROPERTY_TYPES = new Set(['image', 'text', 'multi', 'number']);
const VIEW_TYPES = new Set(['gallery', 'kanban', 'table']);
const LIMITS = new Set<LoadLimit>([10, 50, 100, 'none']);
const FILTER_OPS = new Set<FilterOp>([
  'eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty',
]);

/** Result of parsing a `.board` file: a config, or a human-readable error. */
export type ParseResult =
  | { ok: true; config: DatabaseConfig }
  | { ok: false; error: string };

/** Strip a leading `#` from a tag string and lower-case it. */
export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, '').trim().toLowerCase();
}

function parseProperty(raw: unknown): PropertyConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.name !== 'string') return null;
  const type = typeof f.type === 'string' && PROPERTY_TYPES.has(f.type) ? f.type : 'text';
  return {
    name: f.name,
    type: type as PropertyConfig['type'],
    render: typeof f.render === 'string' ? (f.render as PropertyConfig['render']) : undefined,
    max: typeof f.max === 'number' ? f.max : undefined,
    label: typeof f.label === 'string' ? f.label : undefined,
    searchable: typeof f.searchable === 'boolean' ? f.searchable : undefined,
  };
}

function parseFilter(raw: unknown): FilterRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.property !== 'string') return null;
  if (typeof r.op !== 'string' || !FILTER_OPS.has(r.op as FilterOp)) return null;
  return { property: r.property, op: r.op as FilterOp, value: r.value };
}

function parseView(raw: unknown, index: number): ViewConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const type = typeof v.type === 'string' && VIEW_TYPES.has(v.type) ? (v.type as ViewType) : 'gallery';
  const limit: LoadLimit = LIMITS.has(v.limit as LoadLimit) ? (v.limit as LoadLimit) : 50;
  return {
    name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name : `View ${index + 1}`,
    type,
    properties: Array.isArray(v.properties)
      ? v.properties.filter((p): p is string => typeof p === 'string')
      : undefined,
    limit,
    filter: Array.isArray(v.filter)
      ? v.filter.map(parseFilter).filter((r): r is FilterRule => r !== null)
      : undefined,
    group: typeof v.group === 'string' && v.group.trim() !== '' ? v.group : undefined,
    columns: Array.isArray(v.columns)
      ? v.columns.filter((c): c is string => typeof c === 'string')
      : undefined,
  };
}

/** Parse and validate the raw text of a `.board` file. */
export function parseDatabaseConfig(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw || '{}');
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'Database config must be a JSON object.' };
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.sourceTag !== 'string' || obj.sourceTag.trim() === '') {
    return { ok: false, error: 'Database config requires a non-empty "sourceTag".' };
  }

  const properties: PropertyConfig[] = Array.isArray(obj.properties)
    ? obj.properties.map(parseProperty).filter((p): p is PropertyConfig => p !== null)
    : [];

  let views: ViewConfig[] = Array.isArray(obj.views)
    ? obj.views.map(parseView).filter((v): v is ViewConfig => v !== null)
    : [];

  // A database with no views still gets a default gallery view.
  if (views.length === 0) {
    views = [{ name: 'Gallery', type: 'gallery', limit: 50 }];
  }

  const defaultView =
    typeof obj.defaultView === 'string' && views.some((v) => v.name === obj.defaultView)
      ? obj.defaultView
      : views[0].name;

  return {
    ok: true,
    config: {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      sourceTag: normalizeTag(obj.sourceTag),
      properties,
      views,
      defaultView,
    },
  };
}

/** The label shown for a property (explicit label, else the frontmatter key). */
export function propertyLabel(prop: PropertyConfig): string {
  return prop.label ?? prop.name;
}

/**
 * The properties a view shows, in order. If the view lists `properties`, map
 * those names to their definitions (skipping unknown names); otherwise show
 * every property in declaration order.
 */
export function visibleProperties(config: DatabaseConfig, view: ViewConfig): PropertyConfig[] {
  if (!view.properties || view.properties.length === 0) return config.properties;
  const byName = new Map(config.properties.map((p) => [p.name, p]));
  return view.properties
    .map((name) => byName.get(name))
    .filter((p): p is PropertyConfig => p !== undefined);
}
