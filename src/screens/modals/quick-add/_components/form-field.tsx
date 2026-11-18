import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { App } from 'obsidian';
import type { PropertyConfig } from '../../../../types/database';
import { propertyLabel } from '../../../../lib/config';
import { PROPERTY_TYPE_ICON } from '../../settings/_components/property-editor';
import type { StoredValue } from '../../../../lib/data/properties';
import { asArray, optionFor } from '../../../../lib/render/values';
import { optionStyle } from '../../../../components/fields';
import { ValueEditor } from '../../../../components/value-editor';
import { LinksEditor } from '../../../../components/links-editor';
import { ImageField } from '../../../../components/image-field';
import type { ImageDraft } from '../../../../lib/data/image-import';
import { Toggle } from '@/components/form-controls';
import { Icon } from '@/components/icon';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

/**
 * One quick-add field, edited the way its type is picked: a dropdown for
 * select / multi, a file picker for links, a switch for checkboxes, a numeric
 * box for numbers, and the shared editor for the rest. `onEnter` moves on.
 */
export function FormField({
  app,
  prop,
  value,
  known,
  sourcePath,
  autoFocus,
  draft,
  imageFolder,
  onChange,
  onDraft,
  onEnter,
}: {
  app: App;
  prop: PropertyConfig;
  value: StoredValue | undefined;
  /** Values already used in the database (select / multi), offered beside the options. */
  known: string[];
  /** The database file, for shortest link text. */
  sourcePath: string;
  autoFocus: boolean;
  /** Image fields: a dropped / pasted image not saved yet; it replaces `value` on submit. */
  draft?: ImageDraft | null;
  /** Image fields: where new images are saved (quick add settings). */
  imageFolder?: string;
  onChange: (value: StoredValue) => void;
  onDraft?: (draft: ImageDraft | null) => void;
  onEnter: () => void;
}) {
  switch (prop.type) {
    case 'checkbox':
      return <Toggle checked={value === true} onChange={onChange} label={prop.label ?? prop.name} />;
    case 'select':
    case 'multi':
      return <Dropdown prop={prop} value={value} known={known} autoFocus={autoFocus} onChange={onChange} onEnter={onEnter} />;
    case 'image':
      return (
        <ImageField
          app={app}
          sourcePath={sourcePath}
          value={value}
          onChange={onChange}
          draft={draft ?? null}
          onDraft={(d) => onDraft?.(d)}
          defaultFolder={imageFolder}
          folderKey={`${sourcePath}#${prop.name}`}
          autoFocus={autoFocus}
          onEnter={onEnter}
          className="rb-qa-image"
        />
      );
    case 'links':
      return (
        <LinksEditor
          app={app}
          value={value}
          single={!!prop.single}
          sourcePath={sourcePath}
          autoFocus={autoFocus}
          browse
          className="rb-qa-choices"
          onChange={onChange}
          // Quick add stays open: only an Enter on the empty box moves to the next field.
          onDone={(move) => move === 'down' && onEnter()}
        />
      );
    case 'number':
      return <NumberInput value={value} autoFocus={autoFocus} onChange={onChange} onEnter={onEnter} />;
    default:
      return (
        <ValueEditor
          prop={prop}
          raw={value}
          autoFocus={autoFocus}
          onCommit={onChange}
          onDone={(move) => {
            if (move === 'down') onEnter();
          }}
        />
      );
  }
}

/** Short values share a row; lists, links, images and free text take the full width. */
function fieldWidth(prop: PropertyConfig): 'half' | 'full' {
  return prop.type === 'select' || prop.type === 'number' || prop.type === 'date' || prop.type === 'checkbox' ? 'half' : 'full';
}

/**
 * A field's place in the form (quick add, row editor): icon + label above the control, half or full width.
 * A switch sits beside its label instead. `title`: the record's name, first and full width.
 */
export function FieldBox({ prop, title = false, extra, children }: { prop: PropertyConfig; title?: boolean; extra?: ReactNode; children: ReactNode }) {
  const label = (
    <span className="rb-qa-label">
      <Icon name={PROPERTY_TYPE_ICON[prop.type]} />
      {propertyLabel(prop)}
    </span>
  );
  if (prop.type === 'checkbox') {
    return (
      <div className="rb-qa-field rb-qa-field-check" data-width="half">
        <label className="rb-qa-check-row">
          {label}
          {children}
        </label>
      </div>
    );
  }
  return (
    <div className={title ? 'rb-qa-field rb-qa-field-title' : 'rb-qa-field'} data-width={title ? 'full' : fieldWidth(prop)}>
      {/* Not a <label>: a click on it would re-open dropdowns and pickers. */}
      <div className="rb-qa-label-row">
        {label}
        {extra}
      </div>
      {children}
    </div>
  );
}

/** Digits, sign, decimal point / comma and spaces only. */
const NUMERIC = /^[-+]?[\d\s.,]*$/;

function NumberInput({
  value,
  autoFocus,
  onChange,
  onEnter,
}: {
  value: StoredValue | undefined;
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      autoFocus={autoFocus}
      onChange={(e) => {
        if (NUMERIC.test(e.target.value)) setDraft(e.target.value);
      }}
      onBlur={() => onChange(draft.trim() || null)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(draft.trim() || null);
        onEnter();
      }}
    />
  );
}

/** A choice in the open list: a value, or "Create" for the typed text. */
type Item = { value: string; create?: boolean };

/**
 * A dropdown: the chosen value(s) as pills; open it to search the options and
 * values in use, or create a new one. Single select closes on pick; multi stays open.
 */
function Dropdown({
  prop,
  value,
  known,
  autoFocus,
  onChange,
  onEnter,
}: {
  prop: PropertyConfig;
  value: StoredValue | undefined;
  known: string[];
  autoFocus: boolean;
  onChange: (value: StoredValue) => void;
  onEnter: () => void;
}) {
  const multi = prop.type === 'multi';
  const chosen = asArray(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLDivElement>(null);

  const choices = [...new Set([...(prop.options?.map((o) => o.value) ?? []), ...known, ...chosen])];
  const q = query.trim().toLowerCase();
  const matches = (v: string): boolean => v.toLowerCase().includes(q) || optionFor(prop, v).label.toLowerCase().includes(q);
  const exact = choices.some((v) => v.toLowerCase() === q || optionFor(prop, v).label.toLowerCase() === q);
  const items: Item[] = [...choices.filter(matches).map((v) => ({ value: v })), ...(q && !exact ? [{ value: query.trim(), create: true }] : [])];

  useEffect(() => {
    if (autoFocus) trigger.current?.focus();
  }, [autoFocus]);

  const show = (seed = ''): void => {
    setQuery(seed);
    setActive(0);
    setOpen(true);
  };
  const close = (refocus = true): void => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  const pick = (item: Item, viaKey: boolean): void => {
    if (multi) {
      onChange(chosen.includes(item.value) ? chosen.filter((c) => c !== item.value) : [...chosen, item.value]);
      setQuery('');
      return;
    }
    onChange(chosen[0] === item.value ? null : item.value);
    close();
    if (viaKey) onEnter();
  };

  const remove = (v: string): void => onChange(multi ? chosen.filter((c) => c !== v) : null);

  // shadcn Popover (Radix): floats above the modal, closes on outside click and Escape, keeps focus right.
  return (
    <Popover open={open} onOpenChange={(o) => (o ? show() : close())}>
      <PopoverAnchor asChild>
      <div
        ref={trigger}
        className={open ? 'rb-qa-select is-open' : 'rb-qa-select'}
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onEnter();
          } else if (e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault();
            show();
          } else if (e.key === 'Backspace' && chosen.length) {
            e.preventDefault();
            remove(chosen[chosen.length - 1]);
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            show(e.key);
          }
        }}
      >
        {chosen.length === 0 && <span className="rb-qa-placeholder">{multi ? 'Select values…' : 'Select…'}</span>}
        {chosen.map((v) => {
          const opt = optionFor(prop, v);
          return (
            <span key={v} className="rb-pill rb-opt rb-qa-chip" style={optionStyle(opt.color)}>
              {opt.label}
              <button
                type="button"
                className="rb-qa-remove"
                aria-label={`Remove ${opt.label}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(v);
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          );
        })}
        <Icon name="chevrons-up-down" className="rb-qa-caret" />
      </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="rb-qa-menu rb:w-[var(--radix-popover-trigger-width)] rb:min-w-[200px] rb:p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
          <input
            type="text"
            className="rb-qa-search"
            autoFocus
            value={query}
            placeholder={multi ? 'Search or create… (Esc to close)' : 'Search or create…'}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = items.length;
                if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const item = items[active];
                if (item && (q || !multi)) pick(item, true);
                else {
                  close();
                  onEnter();
                }
              } else if (e.key === 'Escape' || e.key === 'Tab') {
                // Escape closes the list only, not the quick add modal behind it.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                }
                close(e.key === 'Escape');
              }
            }}
          />
          <div className="rb-qa-options" role="listbox" aria-multiselectable={multi}>
            {items.length === 0 && <div className="rb-qa-empty">Type to create a value</div>}
            {items.map((item, i) => {
              const opt = optionFor(prop, item.value);
              const on = !item.create && chosen.includes(item.value);
              return (
                <div
                  key={item.create ? '\0create' : item.value}
                  role="option"
                  aria-selected={on}
                  className={i === active ? 'rb-qa-option is-active' : 'rb-qa-option'}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item, false)}
                >
                  <span className="rb-qa-check">{on && <Icon name="check" />}</span>
                  {item.create && <span className="rb-qa-create">Create</span>}
                  <span className="rb-pill rb-opt" style={optionStyle(opt.color)}>
                    {opt.label}
                  </span>
                </div>
              );
            })}
          </div>
      </PopoverContent>
    </Popover>
  );
}


