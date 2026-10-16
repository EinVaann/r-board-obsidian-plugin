import type { TFile } from 'obsidian';

/** The layouts a view can be displayed as. */
export type ViewType = 'gallery' | 'kanban' | 'table' | 'recipe' | 'chart';

/** Where records come from: tagged notes (`.board`) or rows stored in the file (`.table`). */
export type DatabaseKind = 'board' | 'table';

/** A property's data type. */
export type PropertyType =
  | 'image'
  | 'text'
  | 'multi'
  | 'number'
  | 'checkbox'
  | 'links'
  | 'select'
  | 'date'
  | 'url'
  | 'formula';

/** How an image property fills its card area. */
export type ImageRender = 'fill' | 'fit';
/** How a text property is presented. */
export type TextRender = 'plain' | 'badge' | 'pill';
/** How a multi (array) property is presented. */
export type MultiRender = 'pills' | 'tags';
/** How a numeric property is presented. */
export type NumberRender = 'text' | 'stars' | 'bar' | 'circle';
/** How a boolean (checkbox) property is presented. */
export type CheckboxRender = 'check' | 'box' | 'toggle';
/** How a links (list of links) property is presented. */
export type LinksRender = 'list' | 'pills';
/** How a select property is presented. */
export type SelectRender = 'pill' | 'plain';
/** How a date property is presented: as written, or relative ("in 3 days"). */
export type DateRender = 'plain' | 'relative';

export type PropertyRender =
  | ImageRender
  | TextRender
  | MultiRender
  | NumberRender
  | CheckboxRender
  | LinksRender
  | SelectRender
  | DateRender;

/** A known value of a select / multi property. Values not listed still work. */
export interface SelectOption {
  /** The stored value (frontmatter value or table cell). */
  value: string;
  /** Shown instead of the raw value. */
  label?: string;
  /** CSS color for pills, group headers and chart series; absent = automatic. */
  color?: string;
}

export type NumberStyle = 'plain' | 'currency' | 'percent' | 'compact';

/** Display format for numbers (number properties and numeric formulas). */
export interface NumberFormat {
  style: NumberStyle;
  /** Fixed decimals; absent = as many as needed. */
  decimals?: number;
  /** Currency symbol for style `currency`. */
  currency?: string;
  /** Thousands separators. */
  grouping?: boolean;
}

/**
 * A property of the database, read from note frontmatter. Defined once at the
 * database level; each view chooses which properties to show.
 */
export interface PropertyConfig {
  /** Frontmatter key this property reads. */
  name: string;
  type: PropertyType;
  /** Render style; meaning depends on `type`. */
  render?: PropertyRender;
  /** Upper bound for stars / bar / circle number renders. */
  max?: number;
  /** Human label shown in headers / cards (defaults to `name`). */
  label?: string;
  /** Include this property's value in search matching. */
  searchable?: boolean;
  /** Text shown before the value on cards (e.g. "Score: "). */
  prefix?: string;
  /** Text shown after the value on cards (e.g. "%"). */
  suffix?: string;
  /** select / multi: known values, in order, with labels and colors. */
  options?: SelectOption[];
  /** formula: expression over other properties, e.g. `{Price} * {Qty}`. */
  formula?: string;
  /** number / formula: how numbers are written. */
  format?: NumberFormat;
  /** date: values carry a time of day. */
  includeTime?: boolean;
}

/** How many items a view loads per page. `'none'` shows them all. */
export type LoadLimit = 10 | 50 | 100 | 'none';

/** Comparison used by a filter rule. */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'anyOf'
  | 'noneOf'
  | 'checked'
  | 'unchecked'
  | 'empty'
  | 'notempty';

/** A single filter condition on a property. */
export interface FilterRule {
  property: string;
  op: FilterOp;
  /** Compared value; unused for `empty` / `notempty`. */
  value?: unknown;
}

/** How the conditions in a group combine. */
export type FilterConjunction = 'and' | 'or';

/** A node in a filter tree: either a leaf rule or a nested group. */
export type FilterNode = FilterRule | FilterGroup;

/** A group of conditions combined with a single conjunction (and/or). */
export interface FilterGroup {
  conjunction: FilterConjunction;
  conditions: FilterNode[];
}

/** Type guard: is this filter node a nested group? */
export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).conditions !== undefined;
}

export type SortDir = 'asc' | 'desc';

/** Sort key for a view. `property` is `'$title'` to sort by the note title. */
export interface SortSpec {
  property: string;
  dir: SortDir;
}

/** Card sizing for gallery / kanban views. */
export type CardSize = 'small' | 'medium' | 'large';

/** Gallery tiling layout. */
export type GalleryLayout = 'masonry' | 'grid';

/** How a long list is split: a growing "View more" list, or numbered pages. */
export type PagingMode = 'more' | 'pages';

/**
 * A saved view over the database: a layout plus its own visibility, limit,
 * filter, and grouping.
 */
export interface ViewConfig {
  name: string;
  type: ViewType;
  /** Visible property names, in display order. Omitted/empty = show all. */
  properties?: string[];
  /** Page size; defaults to 50. */
  limit?: LoadLimit;
  /** Root filter group (nested AND/OR conditions). */
  filter?: FilterGroup;
  /**
   * Property name to group by. Creates section headers in gallery/table; for
   * kanban this property is required and defines the columns.
   */
  group?: string;
  /** Optional explicit order of group/column values; others follow, sorted. */
  columns?: string[];
  /** Per-column display overrides (label, color, visibility). */
  groupConfig?: Record<string, GroupColumnConfig>;
  /** Sort key; defaults to title ascending. */
  sort?: SortSpec;
  /** Card size for gallery / kanban (defaults to `medium`). */
  cardSize?: CardSize;
  /** Render an excerpt of each note's body on the card (gallery / kanban). */
  showContent?: boolean;
  /** Gallery tiling (defaults to `masonry`). */
  layout?: GalleryLayout;
  /** Table paging (defaults to `more`). `limit` is the page size. */
  paging?: PagingMode;
  /** How a date group property is bucketed (defaults to one group per value). */
  groupBucket?: DateBucket;
  /** Kanban: split the board into rows (swimlanes) by another property. */
  subGroup?: string;
  /** How a date sub-group property is bucketed. */
  subGroupBucket?: DateBucket;
  /** Group labels currently collapsed (saved with the view). */
  collapsed?: string[];
  /** Table column widths by property name. */
  widths?: Record<string, number>;
  /** Table: show a summary row (per group, plus a grand total). */
  summary?: boolean;
  /** Table summary row: the calculation per property name. */
  calculations?: Record<string, Calculation>;
  /** Chart settings (chart views). */
  chart?: ChartConfig;
  /** Show another view beside or below this one (split view). */
  companion?: Companion;
}

/** A second view shown next to a view. */
export interface Companion {
  /** Name of the other view. */
  view: string;
  position: 'right' | 'below';
  /** The companion's share of the space, in percent. */
  size: number;
  /** The companion only shows items that pass this view's filter and search. */
  followFilter: boolean;
}

/** What a summary-row cell shows for its column. */
export type Calculation = 'sum' | 'avg' | 'min' | 'max' | 'filled' | 'empty' | 'checked' | 'unchecked';

/** `relative` = Today / Tomorrow / Next 7 days / … measured from today. */
export type DateBucket = 'none' | 'relative' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
export type Aggregate = 'sum' | 'count' | 'avg' | 'min' | 'max';

/** A chart view's settings. Property references are property names. */
export interface ChartConfig {
  type: ChartType;
  /** Category axis / slice names; null = one bucket per record. */
  x: string | null;
  dateBucket: DateBucket;
  /** Split into one series per value of this property. */
  splitBy: string | null;
  /** Numeric properties to plot; empty = count records. */
  values: string[];
  aggregate: Aggregate;
  stacked: boolean;
  horizontal: boolean;
  sort: 'x' | 'value-asc' | 'value-desc';
  showLegend: boolean;
  showLabels: boolean;
  /** Series name → color override. */
  colors: Record<string, string>;
}

/** Per-column display overrides for a kanban view. */
export interface GroupColumnConfig {
  /** Custom label shown in the column header instead of the raw value. */
  label?: string;
  /** CSS color applied to the column header text. */
  color?: string;
  /** Hide this column entirely (its cards are not shown). */
  hidden?: boolean;
}

/** The full schema stored in a `.board` file: a database with views. */
export interface DatabaseConfig {
  name?: string;
  /** Base tag every source note must carry (without the leading #). */
  sourceTag: string;
  properties: PropertyConfig[];
  views: ViewConfig[];
  /** Name of the view shown first; defaults to the first view. */
  defaultView?: string;
  /** Vault folder where the "New note" button creates notes. */
  newNoteFolder?: string;
  /** `board` (default) reads notes by tag; `table` stores rows in the file. */
  kind?: DatabaseKind;
  /** Tables: the property shown as each row's title. */
  titleProperty?: string;
}

/** A row stored in a `.table` file. Cells are keyed by property name. */
export interface TableRow {
  id: string;
  cells: Record<string, unknown>;
}

/** A record shown by the views: a tagged note (`.board`) or a stored row (`.table`). */
export interface BoardItem {
  /** Note path, or the row id. */
  id: string;
  /** The note; absent for table rows. */
  file?: TFile;
  /** Display title (frontmatter `title` or basename; a table's title column). */
  title: string;
  /** Frontmatter or row cells, plus computed formula results. */
  values: Record<string, unknown>;
  /** All tags on the note (without leading #), lower-cased. */
  tags: string[];
  /** Formula property name → error message, for formulas that failed. */
  errors?: Record<string, string>;
  /** The values as stored, before formulas were computed (set only when there are formulas). */
  stored?: Record<string, unknown>;
}
