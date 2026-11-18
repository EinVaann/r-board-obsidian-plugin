import { useRef, useState } from 'react';
import { Platform } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { NumberFormat, NumberStyle, PropertyConfig, PropertyType } from '../../../../types/database';
import { formatNumber } from '../../../../lib/render/values';
import { FUNCTIONS } from '../../../../lib/formula/evaluate';
import { parseFormula } from '../../../../lib/formula/parse';
import { AddRow, Button, Field as LabeledField, IconButton, Input, Segmented, Select, SettingRow, SettingsRow, SortableSettingsList, TextInput, Toggle, type HandleProps } from './controls';
import { OptionsEditor } from './options-editor';
import { renameRefs } from '../../../../lib/formula/tokenize';
import { newId as newKey } from '../../../../lib/table/format';

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
      <SortableSettingsList
        ids={ids.current}
        onReorder={reorder}
        className="rb-prop-list"
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
      <AddRow className="rb-prop-add" label={table ? 'Add column' : 'Add property'} onClick={add} />
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
    <Select<PropertyType>
      size="sm"
      className="rb-prop-type"
      aria-label="Type"
      value={prop.type}
      options={(Object.keys(RENDER_OPTIONS) as PropertyType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
      onChange={(type) => {
        const keepOptions = (type === 'select' || type === 'multi') && (prop.type === 'select' || prop.type === 'multi');
        onChange({
          type,
          render: RENDER_OPTIONS[type][0] as PropertyConfig['render'],
          options: keepOptions ? prop.options : undefined,
          formula: type === 'formula' ? prop.formula : undefined,
          format: type === 'number' || type === 'formula' ? prop.format : undefined,
          includeTime: type === 'date' ? prop.includeTime : undefined,
          // A new links property holds one link until "Allow multiple" is turned on.
          single: type === 'links' ? true : undefined,
        });
      }}
    />
  );
  const nameValue = table ? (prop.label ?? '') : prop.name;
  return (
    <SettingsRow
      className="rb-prop-card"
      handle={handle}
      icon={PROPERTY_TYPE_ICON[prop.type]}
      open={open}
      onOpenChange={onOpenChange}
      name={
        <Input
          size="sm"
          className="rb-prop-name"
          invalid={!nameValue.trim()}
          placeholder={table ? 'Column name' : 'frontmatter key'}
          aria-label={table ? 'Column name' : 'Frontmatter key'}
          value={nameValue}
          autoFocus={autoFocus}
          onChange={(e) => onChange(table ? { label: e.target.value } : { name: e.target.value })}
        />
      }
      meta={phone ? undefined : typeSelect}
      actions={phone ? undefined : <IconButton icon="trash-2" size="sm" tone="danger" className="rb-prop-remove" label={table ? 'Remove column' : 'Remove property'} onClick={onRemove} />}
    >
      <div className="rb-prop-body">
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
        {prop.type === 'links' && (
          <ToggleField
            name="Allow multiple links"
            desc="Several links in one cell. Off: picking a note replaces the current one."
            checked={!prop.single}
            onChange={(on) => onChange({ single: on ? undefined : true })}
          />
        )}
        {prop.type === 'date' && (
          <ToggleField name="Include time" desc="Dates include a time of day." checked={!!prop.includeTime} onChange={(on) => onChange({ includeTime: on || undefined })} />
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
        <ToggleField
          name="Searchable"
          desc="Match this property in the search bar, even when it isn’t shown."
          checked={!!prop.searchable}
          onChange={(on) => onChange({ searchable: on || undefined })}
        />
        {phone && (
          <Button variant="danger" icon="trash-2" className="rb-prop-field-wide rb-prop-remove-wide" onClick={onRemove}>
            {table ? 'Remove column' : 'Remove property'}
          </Button>
        )}
      </div>
    </SettingsRow>
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
      <ToggleField
        name="Thousands separators"
        desc={`e.g. ${formatNumber(f.style === 'percent' ? 0.1234 : 1234.5, f)}`}
        checked={f.grouping ?? f.style !== 'plain'}
        onChange={(on) => set({ grouping: on })}
      />
    </>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <LabeledField label={label} className={wide ? 'rb-prop-field-wide' : undefined}>
      {children}
    </LabeledField>
  );
}

/** An on/off option inside the property body: name and description left, switch right. */
function ToggleField({ name, desc, checked, onChange }: { name: string; desc: React.ReactNode; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <SettingRow name={name} desc={desc} className="rb-prop-field-wide rb:px-0 rb:py-1">
      <Toggle checked={checked} onChange={onChange} label={name} />
    </SettingRow>
  );
}
