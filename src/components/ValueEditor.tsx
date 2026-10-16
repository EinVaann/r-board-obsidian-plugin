import { useEffect, useId, useRef, useState } from 'react';
import type { PropertyConfig } from '../types';
import type { StoredValue } from '../data/properties';
import { asArray, asBoolean, optionFor } from '../render/values';
import { formulaOverride } from '../data/compute';
import { Toggle } from '../settings/controls';

/** Where the selection goes after an edit finishes (grid): Enter → down, Tab → right / left. */
export type EditMove = 'down' | 'right' | 'left' | null;

/** The text a stored value is edited as (lists comma-separated). */
export function editText(prop: PropertyConfig, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return asArray(raw).join(', ');
  if (prop.type === 'date' && typeof raw === 'string') return raw.replace(' ', 'T');
  return String(raw);
}

/**
 * Typed or pasted text as a stored value: select / multi labels map to their
 * option values; everything else is coerced when written (see `toStored`).
 */
export function fromText(prop: PropertyConfig, text: string): StoredValue {
  const t = text.trim();
  if (t === '') return null;
  const byLabel = (s: string): string => {
    const l = s.toLowerCase();
    return prop.options?.find((o) => o.value.toLowerCase() === l || o.label?.toLowerCase() === l)?.value ?? s;
  };
  if (prop.type === 'select') return byLabel(t);
  if (prop.type === 'multi') return t.split(',').map((s) => s.trim()).filter(Boolean).map(byLabel);
  return t;
}

/** HTML input type for a property's text editor. Numbers use a text input: number inputs reformat by locale. */
function inputType(prop: PropertyConfig): string {
  if (prop.type === 'date') return prop.includeTime ? 'datetime-local' : 'date';
  if (prop.type === 'url') return 'url';
  return 'text';
}

/**
 * An editor for one stored value. Text-like values commit on blur / Enter /
 * Tab (Escape cancels); checkboxes and selects commit on change.
 */
export function ValueEditor({
  prop,
  raw,
  onCommit,
  onDone,
  seed,
  autoFocus = false,
  className,
}: {
  prop: PropertyConfig;
  /** The stored value (for formulas: the per-item override, if any). */
  raw: unknown;
  onCommit: (value: StoredValue) => void;
  /** Editing finished (committed or cancelled), e.g. to close a cell editor. */
  onDone?: (move: EditMove) => void;
  /** Start from this text instead of the stored value (a key typed on a grid cell). */
  seed?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const listId = useId();
  if (prop.type === 'checkbox') {
    return <Toggle checked={asBoolean(raw) ?? false} onChange={(on) => onCommit(on)} label={prop.label ?? prop.name} />;
  }
  if (prop.type === 'select') {
    const current = raw == null ? '' : String(raw);
    const values = [...(prop.options?.map((o) => o.value) ?? [])];
    if (current && !values.includes(current)) values.push(current);
    return (
      <select
        className={['dropdown', className].filter(Boolean).join(' ')}
        value={current}
        autoFocus={autoFocus}
        onChange={(e) => {
          onCommit(e.target.value || null);
          onDone?.(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone?.(null);
          }
        }}
        onBlur={() => onDone?.(null)}
      >
        <option value="">—</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {optionFor(prop, v).label}
          </option>
        ))}
      </select>
    );
  }
  const suggestions = prop.type === 'multi' ? prop.options?.map((o) => o.value) : undefined;
  const placeholder =
    prop.type === 'formula'
      ? formulaOverride(raw) === 'none'
        ? prop.formula ?? ''
        : 'Clear to use the formula'
      : prop.type === 'multi' || prop.type === 'links'
        ? 'Comma-separated'
        : undefined;
  return (
    <>
      <TextEditor
        prop={prop}
        original={editText(prop, raw)}
        seed={seed}
        list={suggestions?.length ? listId : undefined}
        placeholder={placeholder}
        onCommit={onCommit}
        onDone={onDone}
        autoFocus={autoFocus}
        className={className}
      />
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((v) => (
            <option key={v} value={v}>
              {optionFor(prop, v).label}
            </option>
          ))}
        </datalist>
      ) : null}
    </>
  );
}

function TextEditor({
  prop,
  original,
  seed,
  list,
  placeholder,
  onCommit,
  onDone,
  autoFocus,
  className,
}: {
  prop: PropertyConfig;
  original: string;
  seed?: string;
  list?: string;
  placeholder?: string;
  onCommit: (value: StoredValue) => void;
  onDone?: (move: EditMove) => void;
  autoFocus: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(seed ?? original);
  // Enter/Escape and the blur that follows must only finish once.
  const done = useRef(false);
  useEffect(() => {
    if (seed === undefined) setDraft(original);
    done.current = false;
  }, [original, seed]);

  const finish = (save: boolean, move: EditMove): void => {
    if (done.current) return;
    done.current = true;
    if (save && draft.trim() !== original.trim()) onCommit(fromText(prop, draft));
    onDone?.(move);
  };

  return (
    <input
      className={className}
      type={inputType(prop)}
      inputMode={prop.type === 'number' ? 'decimal' : undefined}
      list={list}
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={(e) => {
        done.current = false;
        const el = e.currentTarget;
        // A typed first key continues after the caret; otherwise select the value.
        if (el.type === 'text') {
          if (seed !== undefined) el.setSelectionRange(el.value.length, el.value.length);
          else el.select();
        }
      }}
      onChange={(e) => {
        done.current = false;
        setDraft(e.target.value);
      }}
      onBlur={() => finish(true, null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish(true, 'down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          finish(true, e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false, null);
        }
      }}
    />
  );
}
