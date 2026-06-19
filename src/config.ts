import type { BoardConfig, FieldConfig, ViewMode } from './types';

const FIELD_TYPES = new Set(['image', 'text', 'multi', 'number']);
const VIEW_MODES = new Set(['gallery', 'kanban', 'table']);

/** Result of parsing a `.board` file: a config, or a human-readable error. */
export type ParseResult =
  | { ok: true; config: BoardConfig }
  | { ok: false; error: string };

/** Strip a leading `#` from a tag string and lower-case it. */
export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, '').trim().toLowerCase();
}

/** Parse and validate the raw text of a `.board` file. */
export function parseBoardConfig(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw || '{}');
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'Board config must be a JSON object.' };
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.sourceTag !== 'string' || obj.sourceTag.trim() === '') {
    return { ok: false, error: 'Board config requires a non-empty "sourceTag".' };
  }

  const fields: FieldConfig[] = [];
  if (Array.isArray(obj.fields)) {
    for (const raw of obj.fields) {
      if (typeof raw !== 'object' || raw === null) continue;
      const f = raw as Record<string, unknown>;
      if (typeof f.name !== 'string') continue;
      const type = typeof f.type === 'string' && FIELD_TYPES.has(f.type) ? f.type : 'text';
      fields.push({
        name: f.name,
        type: type as FieldConfig['type'],
        render: typeof f.render === 'string' ? (f.render as FieldConfig['render']) : undefined,
        max: typeof f.max === 'number' ? f.max : undefined,
        label: typeof f.label === 'string' ? f.label : undefined,
        searchable: typeof f.searchable === 'boolean' ? f.searchable : undefined,
      });
    }
  }

  const defaultView =
    typeof obj.defaultView === 'string' && VIEW_MODES.has(obj.defaultView)
      ? (obj.defaultView as ViewMode)
      : 'gallery';

  let kanban: BoardConfig['kanban'];
  if (obj.kanban && typeof obj.kanban === 'object') {
    const k = obj.kanban as Record<string, unknown>;
    if (Array.isArray(k.groups)) {
      kanban = { groups: k.groups.filter((g): g is string => typeof g === 'string') };
    }
  }

  return {
    ok: true,
    config: {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      sourceTag: normalizeTag(obj.sourceTag),
      fields,
      kanban,
      defaultView,
    },
  };
}

/** The label shown for a field (explicit label, else the frontmatter key). */
export function fieldLabel(field: FieldConfig): string {
  return field.label ?? field.name;
}
