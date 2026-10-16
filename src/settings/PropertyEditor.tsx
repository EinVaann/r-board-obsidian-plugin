import { useRef, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Platform } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { NumberFormat, NumberStyle, PropertyConfig, PropertyType } from '../types';
import { Icon } from '../react/Icon';
import { formatNumber } from '../render/values';
import { FUNCTIONS } from '../formula/evaluate';
import { parseFormula } from '../formula/parse';
import { DragHandle, Segmented, Select, SortableList, TextInput, Toggle, type HandleProps } from './controls';
import { OptionsEditor } from './OptionsEditor';
import { renameRefs } from '../formula/tokenize';
import { newId as newKey } from '../table/format';

/** Render options offered per property type. */
const RENDER_OPTIONS: Record<PropertyType, string[]> = {
  text: ['plain', 'badge', 'pill'],
  number: ['text', 'stars', 'bar', 'circle'],
  select: ['pill', 'plain'],
  multi: ['pills', 'tags'],
  checkbox: ['check', 'box', 'toggle'],
  date: ['plain', 'relative'],
  url: ['plain'],
  links: ['list', 'pills'],
  image: ['fill', 'fit'],
  formula: ['text', 'stars', 'bar', 'circle'],
};

const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi: 'Multi-select',
  checkbox: 'Checkbox',
  date: 'Date',
  url: 'URL',
  links: 'Links',
  image: 'Image',
  formula: 'Formula',
};

/** Icon per property type, shared by the property lists in settings. */
export const PROPERTY_TYPE_ICON: Record<PropertyType, string> = {
  text: 'type',
  number: 'hash',
  select: 'circle-dot',
  multi: 'tags',
  checkbox: 'check-square',
  date: 'calendar',
  url: 'globe',
  links: 'link',
  image: 'image',
  formula: 'sigma',
};

/** Whether a number render needs a `max` value. */
function needsMax(prop: PropertyConfig): boolean {
  return (prop.type === 'number' || prop.type === 'formula') && ['stars', 'bar', 'circle'].includes(prop.render ?? '');
}

const NUMBER_STYLES: { value: NumberStyle; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
  { value: 'compact', label: 'Compact' },
];

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

let nextId = 0;
const newId = (): string => `p${nextId++}`;

/**
 * Stable row ids for a list of properties (which have no ids of their own), so
 * React keeps each row — and its expanded state — through edits and reorders.
 */
function useRowIds(count: number) {
  const ids = useRef<string[]>([]);
  if (ids.current.length !== count) ids.current = Array.from({ length: count }, (_, i) => ids.current[i] ?? newId());
  return ids;
}

/**
 * Editable, reorderable list of a database's properties. Each property is a
 * compact row (key + type) that expands to its display options. Controlled:
 * every edit reports a new array.
 */
export function PropertyEditor({
  properties,
  onChange,
  table = false,
}: {
  properties: PropertyConfig[];
  onChange: (next: PropertyConfig[]) => void;
  /** Tables: properties are named columns (the key is an internal id). */
  table?: boolean;
}) {
  const ids = useRowIds(properties.length);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const update = (index: number, patch: Partial<PropertyConfig>): void => {
    const before = properties[index];
    const after = { ...before, ...patch };
    // Formulas refer to properties by label (or key): follow renames.
    const oldRef = before.label ?? before.name;
    const newRef = after.label ?? after.name;
    onChange(
      properties.map((p, i) => {
        const q = i === index ? after : p;
        return oldRef && newRef && oldRef !== newRef && q.formula ? { ...q, formula: renameRefs(q.formula, oldRef, newRef) } : q;
      }),
    );
  };

  const remove = (index: number): void => {
    ids.current = ids.current.filter((_, i) => i !== index);
    onChange(properties.filter((_, i) => i !== index));
  };

  const add = (): void => {
    const id = newId();
    ids.current = [...ids.current, id];
    setOpen((s) => new Set(s).add(id));
    const name = table ? newKey('c', properties.map((p) => p.name)) : '';
    onChange([...properties, table ? { name, label: '', type: 'text', render: 'plain' } : { name, type: 'text', render: 'plain' }]);
  };

  const reorder = (from: number, to: number): void => {
    ids.current = arrayMove(ids.current, from, to);
    onChange(arrayMove(properties, from, to));
  };

  const setRowOpen = (id: string, isOpen: boolean): void =>
    setOpen((s) => {
      const next = new Set(s);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <SortableList
        ids={ids.current}
        onReorder={reorder}
        className="rb-prop-list"
        rowClassName="rb-prop-row"
        renderRow={(id, i, handle) => (
          <PropertyRow
            prop={properties[i]}
            handle={handle}
            open={open.has(id)}
            onOpenChange={(o) => setRowOpen(id, o)}
            onChange={(patch) => update(i, patch)}
            onRemove={() => remove(i)}
            autoFocus={open.has(id) && (table ? properties[i].label === '' : properties[i].name === '')}
            table={table}
          />
        )}
      />
      <button className="rb-prop-add" onClick={add}>
        <Icon name="plus" className="rb-prop-add-icon" />
        <span>Add property</span>
      </button>
    </>
  );
}

function PropertyRow({
  prop,
  handle,
  open,
  onOpenChange,
  onChange,
  onRemove,
  autoFocus,
  table,
}: {
  prop: PropertyConfig;
  handle: HandleProps;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PropertyConfig>) => void;
  onRemove: () => void;
  autoFocus: boolean;
  table: boolean;
}) {
  const render = prop.render ?? RENDER_OPTIONS[prop.type][0];
  // Phones: too narrow for type + remove in the header; they move into the body.
  const phone = Platform.isPhone;
  const typeSelect = (
    <select
      className="rb-prop-select rb-prop-type"
      value={prop.type}
      onChange={(e) => {
        const type = e.target.value as PropertyType;
        const keepOptions = (type === 'select' || type === 'multi') && (prop.type === 'select' || prop.type === 'multi');
        onChange({
          type,
          render: RENDER_OPTIONS[type][0] as PropertyConfig['render'],
          options: keepOptions ? prop.options : undefined,
          formula: type === 'formula' ? prop.formula : undefined,
          format: type === 'number' || type === 'formula' ? prop.format : undefined,
          includeTime: type === 'date' ? prop.includeTime : undefined,
        });
      }}
    >
      {(Object.keys(RENDER_OPTIONS) as PropertyType[]).map((t) => (
        <option key={t} value={t}>
          {TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
  return (
    <Collapsible.Root className={open ? 'rb-prop-card rb-open' : 'rb-prop-card'} open={open} onOpenChange={onOpenChange}>
      <div className="rb-prop-head">
        <DragHandle handle={handle} />
        <Icon name={PROPERTY_TYPE_ICON[prop.type]} className="rb-prop-type-icon" />
        {table ? (
          <input
            className={(prop.label ?? '').trim() ? 'rb-prop-name' : 'rb-prop-name rb-invalid'}
            type="text"
            placeholder="Column name"
            aria-label="Column name"
            value={prop.label ?? ''}
            autoFocus={autoFocus}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        ) : (
          <input
            className={prop.name.trim() ? 'rb-prop-name' : 'rb-prop-name rb-invalid'}
            type="text"
            placeholder="frontmatter key"
            aria-label="Frontmatter key"
            value={prop.name}
            autoFocus={autoFocus}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        )}
        {!phone && typeSelect}
        <Collapsible.Trigger className="rb-icon-btn rb-prop-expand" aria-label={open ? 'Hide options' : 'Show options'}>
          <Icon name="chevron-down" />
        </Collapsible.Trigger>
        {!phone && (
          <button className="rb-icon-btn rb-prop-remove" aria-label="Remove property" onClick={onRemove}>
            <Icon name="trash-2" />
          </button>
        )}
      </div>

      <Collapsible.Content className="rb-prop-body">
        {phone && <Field label="Type" wide>{typeSelect}</Field>}
        {prop.type === 'formula' && (
          <Field label="Formula" wide>
            <FormulaInput value={prop.formula ?? ''} onChange={(v) => onChange({ formula: v || undefined })} />
          </Field>
        )}
        {RENDER_OPTIONS[prop.type].length > 1 && (
          <Field label="Style" wide>
            <Segmented
              value={render}
              options={RENDER_OPTIONS[prop.type].map((r) => ({ value: r, label: capitalize(r) }))}
              onChange={(v) => onChange({ render: v as PropertyConfig['render'] })}
            />
          </Field>
        )}
        {(prop.type === 'select' || prop.type === 'multi') && (
          <Field label="Values" wide>
            <OptionsEditor options={prop.options ?? []} onChange={(options) => onChange({ options })} />
          </Field>
        )}
        {(prop.type === 'number' || prop.type === 'formula') && (
          <NumberFormatFields format={prop.format} onChange={(format) => onChange({ format })} />
        )}
        {prop.type === 'date' && (
          <Field label="Time" wide>
            <div className="rb-prop-toggle-row">
              <span className="rb-prop-toggle-desc">Dates include a time of day.</span>
              <Toggle checked={!!prop.includeTime} onChange={(on) => onChange({ includeTime: on || undefined })} label="Include time" />
            </div>
          </Field>
        )}
        {!table && (
          <Field label="Label">
            <TextInput
              className="rb-prop-input"
              value={prop.label ?? ''}
              placeholder={prop.name || 'Same as key'}
              onChange={(v) => onChange({ label: v.trim() || undefined })}
            />
          </Field>
        )}
        {needsMax(prop) && (
          <Field label="Max">
            <TextInput
              className="rb-prop-input"
              type="number"
              value={prop.max != null ? String(prop.max) : ''}
              placeholder="e.g. 5 or 100"
              onChange={(v) => {
                const n = Number(v);
                onChange({ max: v === '' || Number.isNaN(n) ? undefined : n });
              }}
            />
          </Field>
        )}
        {/* Prefix / suffix text shown around the value on cards (not for images). */}
        {prop.type !== 'image' && (
          <>
            <Field label="Prefix">
              <TextInput className="rb-prop-input" value={prop.prefix ?? ''} placeholder='e.g. "Score: "' onChange={(v) => onChange({ prefix: v || undefined })} />
            </Field>
            <Field label="Suffix">
              <TextInput className="rb-prop-input" value={prop.suffix ?? ''} placeholder='e.g. "%"' onChange={(v) => onChange({ suffix: v || undefined })} />
            </Field>
          </>
        )}
        <Field label="Searchable" wide>
          <div className="rb-prop-toggle-row">
            <span className="rb-prop-toggle-desc">Match this property in the search bar, even when it isn’t shown.</span>
            <Toggle checked={!!prop.searchable} onChange={(on) => onChange({ searchable: on || undefined })} label="Searchable" />
          </div>
        </Field>
        {phone && (
          <Field label="" wide>
            <button className="mod-warning rb-prop-remove-wide" onClick={onRemove}>
              <Icon name="trash-2" /> Remove property
            </button>
          </Field>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Formula source with a live syntax check and a function reference. */
function FormulaInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  let error: string | null = null;
  if (draft.trim()) {
    try {
      parseFormula(draft);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <div className="rb-formula-edit">
      <textarea
        className={error ? 'rb-formula-input rb-invalid' : 'rb-formula-input'}
        rows={2}
        spellCheck={false}
        placeholder="e.g. {Price} * {Quantity}"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
      />
      {error && <div className="rb-formula-msg">{error}</div>}
      <details className="rb-formula-help">
        <summary>Refer to properties as {'{Name}'} and the title as {'{Title}'}. Functions…</summary>
        <ul>
          {Object.values(FUNCTIONS).map((f) => (
            <li key={f.sig}>
              <code>{f.sig}</code> — {f.doc}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Number style, decimals, currency symbol and thousands separators, with a preview. */
function NumberFormatFields({ format, onChange }: { format?: NumberFormat; onChange: (format: NumberFormat | undefined) => void }) {
  const f: NumberFormat = format ?? { style: 'plain' };
  const set = (patch: Partial<NumberFormat>): void => {
    const next: NumberFormat = { ...f, ...patch };
    for (const k of Object.keys(next) as (keyof NumberFormat)[]) if (next[k] === undefined) delete next[k];
    onChange(next.style === 'plain' && next.decimals === undefined && !next.grouping ? undefined : next);
  };
  return (
    <>
      <Field label="Format">
        <Select<NumberStyle> value={f.style} options={NUMBER_STYLES} onChange={(style) => set({ style })} />
      </Field>
      <Field label="Decimals">
        <TextInput
          className="rb-prop-input"
          type="number"
          value={f.decimals != null ? String(f.decimals) : ''}
          placeholder="Auto"
          onChange={(v) => {
            const n = Number(v);
            set({ decimals: v === '' || Number.isNaN(n) ? undefined : Math.max(0, Math.min(10, Math.round(n))) });
          }}
        />
      </Field>
      {f.style === 'currency' && (
        <Field label="Symbol">
          <TextInput className="rb-prop-input" value={f.currency ?? ''} placeholder="$" onChange={(v) => set({ currency: v || undefined })} />
        </Field>
      )}
      <Field label="Separators" wide>
        <div className="rb-prop-toggle-row">
          <span className="rb-prop-toggle-desc">Thousands separators · e.g. {formatNumber(f.style === 'percent' ? 0.1234 : 1234.5, f)}</span>
          <Toggle checked={f.grouping ?? f.style !== 'plain'} onChange={(on) => set({ grouping: on })} label="Thousands separators" />
        </div>
      </Field>
    </>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'rb-prop-field rb-prop-field-wide' : 'rb-prop-field'}>
      <div className="rb-prop-field-label">{label}</div>
      {children}
    </div>
  );
}
