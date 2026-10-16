import type { DatabaseConfig, FilterGroup, FilterNode, FilterOp, PropertyConfig, PropertyType, SelectOption, SortSpec, TableRow, ViewConfig } from '../types';
import { NO_SORT_KEY, parseChart, parseSchema, serializeViews } from '../config';

/** A `.table` file: the database config plus its rows. */
export interface TableFile {
  config: DatabaseConfig;
  rows: TableRow[];
}

export type TableResult = { ok: true; table: TableFile; migrated: boolean } | { ok: false; error: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Short random ids, unique among `taken`. */
export function newId(prefix: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

/** A new table: a Name and a Notes column, one table view in stored order. */
export function newTableFile(name?: string): TableFile {
  return {
    config: {
      kind: 'table',
      name,
      sourceTag: '',
      titleProperty: 'name',
      properties: [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'notes', label: 'Notes', type: 'text' },
      ],
      views: [{ name: 'Table', type: 'table', limit: 'none', sort: { property: NO_SORT_KEY, dir: 'asc' } }],
      defaultView: 'Table',
    },
    rows: [],
  };
}

/** Parse a `.table` file. Also reads R Sheet's v1 files (`migrated` is then true). */
export function parseTableFile(text: string): TableResult {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '{}') return { ok: true, table: newTableFile(), migrated: false };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const o = rec(data);
  if (Array.isArray(o.columns)) return { ok: true, table: fromSheetV1(o), migrated: true };
  if (Array.isArray(o.fields)) return { ok: true, table: fromUnify(o), migrated: true };
  if (!Array.isArray(o.properties)) return { ok: false, error: 'Not an R Board table: it has no "properties".' };

  const schema = parseSchema(o);
  const config: DatabaseConfig = { ...schema, kind: 'table', sourceTag: '', titleProperty: str(o.titleProperty) || undefined };
  return { ok: true, table: finish({ config, rows: parseRows(o.rows) }), migrated: false };
}

/** Fill defaults: at least one property, a title property and a view. */
function finish(table: TableFile): TableFile {
  const { config } = table;
  if (!config.properties.length) config.properties.push({ name: 'name', label: 'Name', type: 'text' });
  if (!config.properties.some((p) => p.name === config.titleProperty)) {
    config.titleProperty = (config.properties.find((p) => p.type === 'text') ?? config.properties[0]).name;
  }
  if (!config.views.length) config.views.push({ name: 'Table', type: 'table', limit: 'none', sort: { property: NO_SORT_KEY, dir: 'asc' } });
  if (!config.views.some((v) => v.name === config.defaultView)) config.defaultView = config.views[0].name;
  return table;
}

function parseRows(v: unknown): TableRow[] {
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const raw of arr(v)) {
    const o = rec(raw);
    let id = str(o.id);
    if (!id || seen.has(id)) id = newId('r', seen);
    seen.add(id);
    const cells: Record<string, unknown> = {};
    for (const [k, cv] of Object.entries(rec(o.cells))) {
      if (cv === null || cv === undefined || cv === '' || (Array.isArray(cv) && cv.length === 0)) continue;
      cells[k] = cv;
    }
    out.push({ id, cells });
  }
  return out;
}

/** Write a table: settings pretty-printed, one row per line (diff-friendly). */
export function serializeTableFile({ config, rows }: TableFile): string {
  const head: Record<string, unknown> = { version: 1, kind: 'table' };
  if (config.name) head.name = config.name;
  if (config.titleProperty) head.titleProperty = config.titleProperty;
  if (config.defaultView) head.defaultView = config.defaultView;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const block = (key: string, items: unknown[]): string =>
    items.length ? `  "${key}": [\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]` : `  "${key}": []`;
  lines.push(block('properties', config.properties), block('views', serializeViews(config.views)), block('rows', rows));
  return `{\n${lines.join(',\n')}\n}\n`;
}

// ---------------------------------------------------------------- R Sheet v1 → R Board

const V1_TYPES: Record<string, PropertyType> = {
  text: 'text',
  number: 'number',
  select: 'select',
  multiselect: 'multi',
  checkbox: 'checkbox',
  date: 'date',
  url: 'url',
  link: 'links',
  formula: 'formula',
};

const V1_OPS: Record<string, FilterOp> = {
  is: 'eq',
  isNot: 'ne',
  eq: 'eq',
  neq: 'ne',
  notEmpty: 'notempty',
};

/** Columns keep their ids as property keys and their names as labels, so formulas and charts still resolve. */
function fromSheetV1(o: Record<string, unknown>): TableFile {
  const properties: PropertyConfig[] = [];
  const widths: Record<string, number> = {};
  for (const raw of arr(o.columns)) {
    const c = rec(raw);
    const name = str(c.id) || str(c.name);
    if (!name || properties.some((p) => p.name === name)) continue;
    if (typeof c.width === 'number') widths[name] = Math.round(c.width);
    properties.push(toProperty(c, name));
  }
  const keys = new Set(properties.map((p) => p.name));
  const titleProperty = (properties.find((p) => p.type === 'text') ?? properties[0])?.name;

  const v = rec(o.view);
  const table: ViewConfig = { name: 'Table', type: 'table', limit: 'none' };
  const hidden = arr(v.hidden).map(str);
  if (hidden.length) table.properties = properties.map((p) => p.name).filter((n) => n !== titleProperty && !hidden.includes(n));
  const sort = arr(v.sort).map(rec).find((s) => keys.has(str(s.columnId)));
  table.sort = sort ? ({ property: str(sort.columnId), dir: sort.dir === 'desc' ? 'desc' : 'asc' } as SortSpec) : { property: NO_SORT_KEY, dir: 'asc' };
  const filter = v1Filter(v.filter);
  if (filter) table.filter = filter;
  const g = rec(v.group);
  if (keys.has(str(g.columnId))) {
    table.group = str(g.columnId);
    const bucket = str(g.dateBucket);
    if (['day', 'week', 'month', 'quarter', 'year'].includes(bucket)) table.groupBucket = bucket as ViewConfig['groupBucket'];
    const collapsed = arr(g.collapsed).map(str).filter(Boolean);
    if (collapsed.length) table.collapsed = collapsed;
  }
  if (Object.keys(widths).length) table.widths = widths;

  const views: ViewConfig[] = [table];
  for (const raw of arr(o.charts)) {
    const c = rec(raw);
    let name = str(c.name).trim() || 'Chart';
    for (let n = 2; views.some((x) => x.name === name); n++) name = `${str(c.name).trim() || 'Chart'} ${n}`;
    const view: ViewConfig = { name, type: 'chart', limit: 'none', chart: parseChart(c) };
    const cf = v1Filter(c.filter);
    if (cf) view.filter = cf;
    views.push(view);
  }

  return finish({
    config: { kind: 'table', sourceTag: '', name: str(o.name) || undefined, titleProperty, properties, views, defaultView: table.name },
    rows: parseRows(o.rows),
  });
}

// ---------------------------------------------------------------- react-unify preview → R Board

/** Field → property, shared by the R Sheet and react-unify readers (id = key, name = label). */
function toProperty(c: Record<string, unknown>, name: string): PropertyConfig {
  const prop: PropertyConfig = { name, type: V1_TYPES[str(c.type)] ?? (str(c.type) === 'image' ? 'image' : 'text') };
  if (str(c.name) && str(c.name) !== name) prop.label = str(c.name);
  const options = arr(c.options).map(rec).filter((x) => str(x.id));
  if (options.length) {
    prop.options = options.map((x) => {
      const opt: SelectOption = { value: str(x.id) };
      if (str(x.label) && str(x.label) !== str(x.id)) opt.label = str(x.label);
      if (str(x.color)) opt.color = str(x.color);
      return opt;
    });
  }
  if (str(c.display)) prop.render = str(c.display) as PropertyConfig['render'];
  if (typeof c.max === 'number') prop.max = c.max;
  if (str(c.prefix)) prop.prefix = str(c.prefix);
  if (str(c.suffix)) prop.suffix = str(c.suffix);
  if (str(c.formula)) prop.formula = str(c.formula);
  if (c.format && typeof c.format === 'object') prop.format = c.format as PropertyConfig['format'];
  if (c.includeTime === true) prop.includeTime = true;
  return prop;
}

/** The react-unify preview's empty-group key; R Board saves it as `__none__`. */
const UNIFY_EMPTY = String.fromCharCode(0xffff);

/** Tables saved by the react-unify preview build (`fields`, view ids, sort lists, group objects). */
function fromUnify(o: Record<string, unknown>): TableFile {
  const properties: PropertyConfig[] = [];
  for (const raw of arr(o.fields)) {
    const f = rec(raw);
    const name = str(f.id) || str(f.name);
    if (name && !properties.some((p) => p.name === name)) properties.push(toProperty(f, name));
  }
  const keys = new Set(properties.map((p) => p.name));
  const titleProperty = keys.has(str(o.primaryField)) ? str(o.primaryField) : (properties.find((p) => p.type === 'text') ?? properties[0])?.name;
  const rawViews = arr(o.views).map(rec);
  const nameOf = new Map(rawViews.map((v, i) => [str(v.id), str(v.name).trim() || `View ${i + 1}`]));

  const views: ViewConfig[] = rawViews.map((v, i) => {
    const type = (['table', 'gallery', 'kanban', 'recipe', 'chart'].includes(str(v.type)) ? str(v.type) : 'table') as ViewConfig['type'];
    const view: ViewConfig = { name: nameOf.get(str(v.id)) ?? `View ${i + 1}`, type, limit: [10, 50, 100, 'none'].includes(v.limit as never) ? (v.limit as ViewConfig['limit']) : 'none' };
    if (Array.isArray(v.fields)) view.properties = arr(v.fields).map(str).filter((n) => keys.has(n) && n !== titleProperty);
    const sort = arr(v.sort).map(rec).find((s) => keys.has(str(s.field)) || str(s.field) === '$title');
    view.sort = sort ? { property: str(sort.field), dir: sort.dir === 'desc' ? 'desc' : 'asc' } : { property: NO_SORT_KEY, dir: 'asc' };
    const filter = unifyFilter(v.filter);
    if (filter) view.filter = filter;
    const g = rec(v.group);
    if (keys.has(str(g.field))) {
      view.group = str(g.field);
      if (str(g.dateBucket) && str(g.dateBucket) !== 'none') view.groupBucket = str(g.dateBucket) as ViewConfig['groupBucket'];
      const collapsed = arr(g.collapsed).map(str).map((k) => (k === UNIFY_EMPTY ? '__none__' : k)).filter(Boolean);
      if (collapsed.length) view.collapsed = collapsed;
      const hidden = arr(g.hidden).map(str).filter(Boolean);
      if (hidden.length) view.groupConfig = Object.fromEntries(hidden.map((k) => [k === UNIFY_EMPTY ? '__none__' : k, { hidden: true }]));
      const order = arr(g.order).map(str).filter(Boolean);
      if (order.length) view.columns = order;
    }
    const sg = rec(v.subGroup);
    if (keys.has(str(sg.field))) {
      view.subGroup = str(sg.field);
      if (str(sg.dateBucket) && str(sg.dateBucket) !== 'none') view.subGroupBucket = str(sg.dateBucket) as ViewConfig['subGroupBucket'];
    }
    const widths = Object.fromEntries(Object.entries(rec(v.widths)).filter(([, w]) => typeof w === 'number')) as Record<string, number>;
    if (Object.keys(widths).length) view.widths = widths;
    if (['small', 'medium', 'large'].includes(str(v.cardSize))) view.cardSize = str(v.cardSize) as ViewConfig['cardSize'];
    if (v.showContent === true) view.showContent = true;
    if (v.layout === 'grid' || v.layout === 'masonry') view.layout = v.layout;
    if (type === 'chart') view.chart = parseChart(v.chart);
    const c = rec(v.companion);
    if (nameOf.has(str(c.view))) {
      view.companion = {
        view: nameOf.get(str(c.view))!,
        position: c.position === 'below' ? 'below' : 'right',
        size: typeof c.size === 'number' ? Math.round(c.size) : 40,
        followFilter: c.followFilter !== false,
      };
    }
    return view;
  });

  return finish({
    config: {
      kind: 'table',
      sourceTag: '',
      name: str(o.name) || undefined,
      titleProperty,
      properties,
      views,
      defaultView: nameOf.get(str(o.defaultView)),
    },
    rows: parseRows(o.rows),
  });
}

/** react-unify filters: `field` instead of `property`, and its own op names. */
function unifyFilter(raw: unknown): FilterGroup | undefined {
  const g = rec(raw);
  if (!Array.isArray(g.conditions)) return undefined;
  const conditions: FilterNode[] = [];
  for (const c of arr(g.conditions).map(rec)) {
    if (Array.isArray(c.conditions)) {
      const sub = unifyFilter(c);
      if (sub) conditions.push(sub);
    } else if (str(c.field) && str(c.op)) {
      conditions.push({ property: str(c.field), op: V1_OPS[str(c.op)] ?? (str(c.op) as FilterOp), value: c.value });
    }
  }
  return conditions.length ? { conjunction: g.conjunction === 'or' ? 'or' : 'and', conditions } : undefined;
}

function v1Filter(raw: unknown): FilterGroup | undefined {
  const f = rec(raw);
  const conditions: FilterNode[] = arr(f.filters)
    .map(rec)
    .filter((r) => str(r.columnId) && str(r.op))
    .map((r) => ({ property: str(r.columnId), op: V1_OPS[str(r.op)] ?? (str(r.op) as FilterOp), value: r.value }));
  return conditions.length ? { conjunction: f.match === 'any' ? 'or' : 'and', conditions } : undefined;
}
