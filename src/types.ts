import type { TFile } from 'obsidian';

/** The three board layouts a board can be displayed as. */
export type ViewMode = 'gallery' | 'kanban' | 'table';

/** A frontmatter field's data type. */
export type FieldType = 'image' | 'text' | 'multi' | 'number';

/** How an image field fills its card area. */
export type ImageRender = 'fill' | 'fit';
/** How a text field is presented. */
export type TextRender = 'plain' | 'badge' | 'pill';
/** How a multi (array) field is presented. */
export type MultiRender = 'pills' | 'tags';
/** How a numeric field is presented. */
export type NumberRender = 'text' | 'stars' | 'bar' | 'circle';

/** A single field drawn from note frontmatter, as declared in the board config. */
export interface FieldConfig {
  /** Frontmatter key this field reads. */
  name: string;
  type: FieldType;
  /** Render style; meaning depends on `type`. */
  render?: ImageRender | TextRender | MultiRender | NumberRender;
  /** Upper bound for stars / bar / circle number renders. */
  max?: number;
  /** Optional human label shown in the table header / card (defaults to `name`). */
  label?: string;
  /** Include this field's value in search matching. */
  searchable?: boolean;
}

/** Kanban-specific configuration. */
export interface KanbanConfig {
  /** Ordered group sub-tags; each maps to a column (e.g. "playing" → #playing). */
  groups: string[];
}

/** The full schema stored in a `.board` file. */
export interface BoardConfig {
  name?: string;
  /** Base tag every source note must carry (without the leading #). */
  sourceTag: string;
  fields: FieldConfig[];
  kanban?: KanbanConfig;
  defaultView?: ViewMode;
}

/** A note matched into a board, with its parsed frontmatter. */
export interface BoardItem {
  file: TFile;
  /** Display title (frontmatter `title` field if present, else basename). */
  title: string;
  frontmatter: Record<string, unknown>;
  /** All tags on the note (without leading #), lower-cased. */
  tags: string[];
}
