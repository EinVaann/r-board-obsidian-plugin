import type {
  CardSize,
  DatabaseConfig,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  GalleryLayout,
  GroupColumnConfig,
  LoadLimit,
  PropertyConfig,
  SortSpec,
  ViewConfig,
  ViewType,
} from './types';

const PROPERTY_TYPES = new Set(['image', 'text', 'multi', 'number', 'checkbox', 'links']);
const VIEW_TYPES = new Set(['gallery', 'kanban', 'table']);
const CARD_SIZES = new Set<CardSize>(['small', 'medium', 'large']);
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
    prefix: typeof f.prefix === 'string' && f.prefix !== '' ? f.prefix : undefined,
    suffix: typeof f.suffix === 'string' && f.suffix !== '' ? f.suffix : undefined,
  };
}

function parseFilterRule(raw: unknown): FilterRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.property !== 'string') return null;
  if (typeof r.op !== 'string' || !FILTER_OPS.has(r.op as FilterOp)) return null;
  return { property: r.property, op: r.op as FilterOp, value: r.value };
}

/** Parse one filter node: a nested group (has `conditions`) or a leaf rule. */
function parseFilterNode(raw: unknown): FilterNode | null {
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).conditions)) {
    return parseFilterGroup(raw) ?? null;
  }
  return parseFilterRule(raw);
}

/** Parse a filter group; also accepts the legacy `FilterRule[]` (AND) form. */
function parseFilterGroup(raw: unknown): FilterGroup | undefined {
  if (Array.isArray(raw)) {
    const conditions = raw.map(parseFilterNode).filter((n): n is FilterNode => n !== null);
    return conditions.length ? { conjunction: 'and', conditions } : undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const g = raw as Record<string, unknown>;
  if (!Array.isArray(g.conditions)) return undefined;
  const conjunction = g.conjunction === 'or' ? 'or' : 'and';
  const conditions = g.conditions.map(parseFilterNode).filter((n): n is FilterNode => n !== null);
  return { conjunction, conditions };
}

function parseSort(raw: unknown): SortSpec | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const s = raw as Record<string, unknown>;
  if (typeof s.property !== 'string') return undefined;
  return { property: s.property, dir: s.dir === 'desc' ? 'desc' : 'asc' };
}

/** Parse per-column overrides (label / color / hidden), dropping empty ones. */
function parseGroupConfig(raw: unknown): Record<string, GroupColumnConfig> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, GroupColumnConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const c = value as Record<string, unknown>;
    const entry: GroupColumnConfig = {};
    if (typeof c.label === 'string' && c.label.trim() !== '') entry.label = c.label;
    if (typeof c.color === 'string' && c.color.trim() !== '') entry.color = c.color;
    if (c.hidden === true) entry.hidden = true;
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
    filter: parseFilterGroup(v.filter),
    group: typeof v.group === 'string' && v.group.trim() !== '' ? v.group : undefined,
    columns: Array.isArray(v.columns)
      ? v.columns.filter((c): c is string => typeof c === 'string')
      : undefined,
    groupConfig: parseGroupConfig(v.groupConfig),
    sort: parseSort(v.sort),
    cardSize: CARD_SIZES.has(v.cardSize as CardSize) ? (v.cardSize as CardSize) : undefined,
    showContent: typeof v.showContent === 'boolean' ? v.showContent : undefined,
    layout: v.layout === 'grid' ? 'grid' : v.layout === 'masonry' ? 'masonry' : undefined,
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

  // Views are created explicitly by the user; an empty database has none yet.
  const views: ViewConfig[] = Array.isArray(obj.views)
    ? obj.views.map(parseView).filter((v): v is ViewConfig => v !== null)
    : [];

  const defaultView =
    typeof obj.defaultView === 'string' && views.some((v) => v.name === obj.defaultView)
      ? obj.defaultView
      : views[0]?.name;

  return {
    ok: true,
    config: {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      sourceTag: normalizeTag(obj.sourceTag),
      properties,
      views,
      defaultView,
      newNoteFolder:
        typeof obj.newNoteFolder === 'string' && obj.newNoteFolder.trim() !== ''
          ? obj.newNoteFolder.trim()
          : undefined,
    },
  };
}

/** The label shown for a property (explicit label, else the frontmatter key). */
export function propertyLabel(prop: PropertyConfig): string {
  return prop.label ?? prop.name;
}

/** Sort key meaning "the note title". */
export const TITLE_SORT_KEY = '$title';

/** A view's effective sort (its own, else title ascending). */
export function effectiveSort(view: ViewConfig): SortSpec {
  return view.sort ?? { property: TITLE_SORT_KEY, dir: 'asc' };
}

/** Serialize a database config back to pretty JSON for the `.board` file. */
export function serializeDatabase(config: DatabaseConfig): string {
  const out: Record<string, unknown> = {};
  if (config.name) out.name = config.name;
  out.sourceTag = config.sourceTag;
  out.properties = config.properties;
  out.views = config.views.map((v) => {
    const view: Record<string, unknown> = { name: v.name, type: v.type };
    if (v.properties && v.properties.length) view.properties = v.properties;
    if (v.limit !== undefined) view.limit = v.limit;
    if (v.filter && v.filter.conditions.length) view.filter = v.filter;
    if (v.group) view.group = v.group;
    if (v.columns && v.columns.length) view.columns = v.columns;
    if (v.groupConfig && Object.keys(v.groupConfig).length) view.groupConfig = v.groupConfig;
    if (v.sort) view.sort = v.sort;
    if (v.cardSize) view.cardSize = v.cardSize;
    if (v.showContent) view.showContent = v.showContent;
    if (v.layout) view.layout = v.layout;
    return view;
  });
  if (config.defaultView) out.defaultView = config.defaultView;
  if (config.newNoteFolder) out.newNoteFolder = config.newNoteFolder;
  return JSON.stringify(out, null, 2);
}

/** A fresh view of the given type, with a name unique among `existing`. */
export function makeDefaultView(type: ViewType, existing: ViewConfig[]): ViewConfig {
  const baseName = type === 'gallery' ? 'Gallery' : type === 'kanban' ? 'Board' : 'Table';
  let name = baseName;
  let n = 2;
  while (existing.some((v) => v.name === name)) name = `${baseName} ${n++}`;

  const view: ViewConfig = { name, type, limit: 50 };
  if (type === 'gallery') {
    view.layout = 'masonry';
    view.cardSize = 'medium';
  } else if (type === 'kanban') {
    view.cardSize = 'medium';
  }
  return view;
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
