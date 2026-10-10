import { useRef, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Platform } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { PropertyConfig, PropertyType } from '../types';
import { Icon } from '../react/Icon';
import { DragHandle, Segmented, SortableList, TextInput, Toggle, type HandleProps } from './controls';

/** Render options offered per property type. */
const RENDER_OPTIONS: Record<PropertyType, string[]> = {
  image: ['fill', 'fit'],
  text: ['plain', 'badge', 'pill'],
  multi: ['pills', 'tags'],
  number: ['text', 'stars', 'bar', 'circle'],
  checkbox: ['check', 'box', 'toggle'],
  links: ['list', 'pills'],
};

const TYPE_LABELS: Record<PropertyType, string> = {
  image: 'Image',
  text: 'Text',
  multi: 'List',
  number: 'Number',
  checkbox: 'Checkbox',
  links: 'Links',
};

/** Icon per property type, shared by the property lists in settings. */
export const PROPERTY_TYPE_ICON: Record<PropertyType, string> = {
  image: 'image',
  text: 'type',
  multi: 'tags',
  number: 'hash',
  checkbox: 'check-square',
  links: 'link',
};

/** Whether a number render needs a `max` value. */
function needsMax(prop: PropertyConfig): boolean {
  return prop.type === 'number' && ['stars', 'bar', 'circle'].includes(prop.render ?? '');
}

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
export function PropertyEditor({ properties, onChange }: { properties: PropertyConfig[]; onChange: (next: PropertyConfig[]) => void }) {
  const ids = useRowIds(properties.length);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const update = (index: number, patch: Partial<PropertyConfig>): void =>
    onChange(properties.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const remove = (index: number): void => {
    ids.current = ids.current.filter((_, i) => i !== index);
    onChange(properties.filter((_, i) => i !== index));
  };

  const add = (): void => {
    const id = newId();
    ids.current = [...ids.current, id];
    setOpen((s) => new Set(s).add(id));
    onChange([...properties, { name: '', type: 'text', render: 'plain' }]);
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
            autoFocus={open.has(id) && properties[i].name === ''}
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
}: {
  prop: PropertyConfig;
  handle: HandleProps;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PropertyConfig>) => void;
  onRemove: () => void;
  autoFocus: boolean;
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
        onChange({ type, render: RENDER_OPTIONS[type][0] as PropertyConfig['render'] });
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
        <input
          className={prop.name.trim() ? 'rb-prop-name' : 'rb-prop-name rb-invalid'}
          type="text"
          placeholder="frontmatter key"
          aria-label="Frontmatter key"
          value={prop.name}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ name: e.target.value })}
        />
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
        <Field label="Style" wide>
          <Segmented
            value={render}
            options={RENDER_OPTIONS[prop.type].map((r) => ({ value: r, label: capitalize(r) }))}
            onChange={(v) => onChange({ render: v as PropertyConfig['render'] })}
          />
        </Field>
        <Field label="Label">
          <TextInput
            className="rb-prop-input"
            value={prop.label ?? ''}
            placeholder={prop.name || 'Same as key'}
            onChange={(v) => onChange({ label: v.trim() || undefined })}
          />
        </Field>
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

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'rb-prop-field rb-prop-field-wide' : 'rb-prop-field'}>
      <div className="rb-prop-field-label">{label}</div>
      {children}
    </div>
  );
}
