import type { TFile } from 'obsidian';

/** The three layouts a view can be displayed as. */
export type ViewType = 'gallery' | 'kanban' | 'table';

/** A property's data type. */
export type PropertyType = 'image' | 'text' | 'multi' | 'number';

/** How an image property fills its card area. */
export type ImageRender = 'fill' | 'fit';
/** How a text property is presented. */
export type TextRender = 'plain' | 'badge' | 'pill';
/** How a multi (array) property is presented. */
export type MultiRender = 'pills' | 'tags';
/** How a numeric property is presented. */
export type NumberRender = 'text' | 'stars' | 'bar' | 'circle';

/**
 * A property of the database, read from note frontmatter. Defined once at the
 * database level; each view chooses which properties to show.
 */
export interface PropertyConfig {
  /** Frontmatter key this property reads. */
  name: string;
  type: PropertyType;
  /** Render style; meaning depends on `type`. */
  render?: ImageRender | TextRender | MultiRender | NumberRender;
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
}

/** How many items a view loads per page. `'none'` shows them all. */
export type LoadLimit = 10 | 50 | 100 | 'none';

/** Comparison used by a filter rule. */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
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
}

/** A note matched into the database, with its parsed frontmatter. */
export interface BoardItem {
  file: TFile;
  /** Display title (frontmatter `title` if present, else basename). */
  title: string;
  frontmatter: Record<string, unknown>;
  /** All tags on the note (without leading #), lower-cased. */
  tags: string[];
}
