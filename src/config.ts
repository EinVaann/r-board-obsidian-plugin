import type {
  Aggregate,
  Calculation,
  CardSize,
  ChartConfig,
  ChartType,
  Companion,
  DatabaseConfig,
  DateBucket,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterRule,
  GalleryLayout,
  GroupColumnConfig,
  LoadLimit,
  NumberFormat,
  PropertyConfig,
  SelectOption,
  SortSpec,
  ViewConfig,
  ViewType,
} from './types';

const PROPERTY_TYPES = new Set(['image', 'text', 'multi', 'number', 'checkbox', 'links', 'select', 'date', 'url', 'formula']);
const NUMBER_STYLES = new Set(['plain', 'currency', 'percent', 'compact']);
const VIEW_TYPES = new Set(['gallery', 'kanban', 'table', 'recipe', 'chart']);
const CARD_SIZES = new Set<CardSize>(['small', 'medium', 'large']);
const LIMITS = new Set<LoadLimit>([10, 50, 100, 'none']);
const FILTER_OPS = new Set<FilterOp>([
  'eq', 'ne', 'contains', 'notContains', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte',
  'before', 'after', 'onOrBefore', 'onOrAfter', 'anyOf', 'noneOf', 'checked', 'unchecked', 'empty', 'notempty',
]);
const DATE_BUCKETS = new Set<DateBucket>(['none', 'relative', 'day', 'week', 'month', 'quarter', 'year']);
const CHART_TYPES = new Set<ChartType>(['bar', 'line', 'area', 'pie', 'donut', 'scatter']);
const AGGREGATES = new Set<Aggregate>(['sum', 'count', 'avg', 'min', 'max']);

/** Chart settings with every field filled in. */
export function defaultChartConfig(): ChartConfig {
  return {
    type: 'bar',
    x: null,
    dateBucket: 'none',
    splitBy: null,
    values: [],
    aggregate: 'sum',
    stacked: false,
    horizontal: false,
    sort: 'x',
    showLegend: true,
    showLabels: false,
    colors: {},
  };
}

export function parseChart(raw: unknown): ChartConfig {
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = defaultChartConfig();
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const colors: Record<string, string> = {};
  if (typeof c.colors === 'object' && c.colors !== null) {
    for (const [k, v] of Object.entries(c.colors)) if (typeof v === 'string' && v) colors[k] = v;
  }
  return {
    type: CHART_TYPES.has(c.type as ChartType) ? (c.type as ChartType) : d.type,
    x: strOrNull(c.x),
    dateBucket: DATE_BUCKETS.has(c.dateBucket as DateBucket) ? (c.dateBucket as DateBucket) : d.dateBucket,
    splitBy: strOrNull(c.splitBy),
    values: Array.isArray(c.values) ? c.values.filter((v): v is string => typeof v === 'string') : [],
    aggregate: AGGREGATES.has(c.aggregate as Aggregate) ? (c.aggregate as Aggregate) : d.aggregate,
    stacked: c.stacked === true,
    horizontal: c.horizontal === true,
    sort: c.sort === 'value-asc' || c.sort === 'value-desc' ? c.sort : 'x',
    showLegend: c.showLegend !== false,
    showLabels: c.showLabels === true,
    colors,
  };
}

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
    options: parseOptions(f.options),
    formula: typeof f.formula === 'string' ? f.formula : undefined,
    format: parseFormat(f.format),
    includeTime: f.includeTime === true ? true : undefined,
  };
}

function parseOptions(raw: unknown): SelectOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of raw) {
    const r = (typeof o === 'string' ? { value: o } : o) as Record<string, unknown> | null;
    if (!r || typeof r.value !== 'string' || r.value === '' || seen.has(r.value)) continue;
    seen.add(r.value);
    const opt: SelectOption = { value: r.value };
    if (typeof r.label === 'string' && r.label.trim() !== '') opt.label = r.label;
    if (typeof r.color === 'string' && r.color.trim() !== '') opt.color = r.color;
    out.push(opt);
  }
  return out.length ? out : undefined;
}

function parseFormat(raw: unknown): NumberFormat | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const f = raw as Record<string, unknown>;
  if (typeof f.style !== 'string' || !NUMBER_STYLES.has(f.style)) return undefined;
  const out: NumberFormat = { style: f.style as NumberFormat['style'] };
  if (typeof f.decimals === 'number' && f.decimals >= 0 && f.decimals <= 10) out.decimals = Math.round(f.decimals);
  if (typeof f.currency === 'string' && f.currency !== '') out.currency = f.currency;
  if (typeof f.grouping === 'boolean') out.grouping = f.grouping;
  return out;
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
    paging: v.paging === 'pages' ? 'pages' : undefined,
    groupBucket: DATE_BUCKETS.has(v.groupBucket as DateBucket) && v.groupBucket !== 'none' ? (v.groupBucket as DateBucket) : undefined,
    subGroup: typeof v.subGroup === 'string' && v.subGroup.trim() !== '' ? v.subGroup : undefined,
    subGroupBucket: DATE_BUCKETS.has(v.subGroupBucket as DateBucket) && v.subGroupBucket !== 'none' ? (v.subGroupBucket as DateBucket) : undefined,
    collapsed: Array.isArray(v.collapsed) && v.collapsed.length
      ? [...new Set(v.collapsed.filter((c): c is string => typeof c === 'string'))]
      : undefined,
    widths: parseWidths(v.widths),
    summary: v.summary === true ? true : undefined,
    calculations: parseCalculations(v.calculations),
    chart: type === 'chart' ? parseChart(v.chart) : undefined,
    companion: parseCompanion(v.companion),
  };
}

function parseCompanion(raw: unknown): Companion | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.view !== 'string' || c.view === '') return undefined;
  const size = typeof c.size === 'number' ? Math.min(80, Math.max(20, Math.round(c.size))) : 40;
  return { view: c.view, position: c.position === 'below' ? 'below' : 'right', size, followFilter: c.followFilter === true };
}

const CALCULATIONS = new Set<Calculation>(['sum', 'avg', 'min', 'max', 'filled', 'empty', 'checked', 'unchecked']);

function parseCalculations(raw: unknown): Record<string, Calculation> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, Calculation> = {};
  for (const [k, c] of Object.entries(raw)) if (CALCULATIONS.has(c as Calculation)) out[k] = c as Calculation;
  return Object.keys(out).length ? out : undefined;
}

function parseWidths(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(raw)) if (typeof w === 'number' && w > 0) out[k] = Math.round(w);
  return Object.keys(out).length ? out : undefined;
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

  return {
    ok: true,
    config: {
      ...parseSchema(obj),
      sourceTag: normalizeTag(obj.sourceTag),
      newNoteFolder:
        typeof obj.newNoteFolder === 'string' && obj.newNoteFolder.trim() !== ''
          ? obj.newNoteFolder.trim()
          : undefined,
    },
  };
}

/** The parts shared by `.board` and `.table` files: name, properties, views. */
export function parseSchema(obj: Record<string, unknown>): Pick<DatabaseConfig, 'name' | 'properties' | 'views' | 'defaultView'> {
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

  return { name: typeof obj.name === 'string' ? obj.name : undefined, properties, views, defaultView };
}

/** The label shown for a property (explicit label, else the frontmatter key). */
export function propertyLabel(prop: PropertyConfig): string {
  return prop.label ?? prop.name;
}

/** Sort key meaning "the note title". */
export const TITLE_SORT_KEY = '$title';
/** Sort key meaning "don't sort": notes keep the vault's own order. */
export const NO_SORT_KEY = '$none';

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
  out.views = serializeViews(config.views);
  if (config.defaultView) out.defaultView = config.defaultView;
  if (config.newNoteFolder) out.newNoteFolder = config.newNoteFolder;
  return JSON.stringify(out, null, 2);
}

/** Views as written to the file: defaults and empty settings left out. */
export function serializeViews(views: ViewConfig[]): Record<string, unknown>[] {
  return views.map((v) => {
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
    if (v.paging === 'pages') view.paging = v.paging;
    if (v.groupBucket && v.groupBucket !== 'none') view.groupBucket = v.groupBucket;
    if (v.subGroup) view.subGroup = v.subGroup;
    if (v.subGroup && v.subGroupBucket && v.subGroupBucket !== 'none') view.subGroupBucket = v.subGroupBucket;
    if (v.collapsed && v.collapsed.length) view.collapsed = v.collapsed;
    if (v.widths && Object.keys(v.widths).length) view.widths = v.widths;
    if (v.summary) view.summary = true;
    if (v.calculations && Object.keys(v.calculations).length) view.calculations = v.calculations;
    if (v.type === 'chart' && v.chart) view.chart = v.chart;
    if (v.companion) view.companion = v.companion;
    return view;
  });
}

/** A fresh view of the given type, with a name unique among `existing`. */
export function makeDefaultView(type: ViewType, existing: ViewConfig[]): ViewConfig {
  const baseName =
    type === 'gallery' ? 'Gallery' : type === 'kanban' ? 'Board' : type === 'recipe' ? 'Recipes' : type === 'chart' ? 'Chart' : 'Table';
  let name = baseName;
  let n = 2;
  while (existing.some((v) => v.name === name)) name = `${baseName} ${n++}`;

  const view: ViewConfig = { name, type, limit: 50 };
  if (type === 'gallery') {
    view.layout = 'masonry';
    view.cardSize = 'medium';
  } else if (type === 'kanban') {
    view.cardSize = 'medium';
  } else if (type === 'chart') {
    view.chart = defaultChartConfig();
  }
  return view;
}

/**
 * The properties a view shows, in order. If the view lists `properties`, map
 * those names to their definitions (skipping unknown names); otherwise show
 * every property in declaration order.
 */
export function visibleProperties(config: DatabaseConfig, view: ViewConfig): PropertyConfig[] {
  // A table's title property is drawn as the title, never as a field.
  const all = config.titleProperty ? config.properties.filter((p) => p.name !== config.titleProperty) : config.properties;
  if (!view.properties || view.properties.length === 0) return all;
  const byName = new Map(all.map((p) => [p.name, p]));
  return view.properties
    .map((name) => byName.get(name))
    .filter((p): p is PropertyConfig => p !== undefined);
}

/** A table's title property, if any. */
export function titlePropertyOf(config: DatabaseConfig): PropertyConfig | undefined {
  return config.titleProperty ? config.properties.find((p) => p.name === config.titleProperty) : undefined;
}

/** Label of the title column: "Title" for boards, the title property's label for tables. */
export function titleLabel(config: DatabaseConfig): string {
  const p = titlePropertyOf(config);
  return p ? propertyLabel(p) : 'Title';
}
