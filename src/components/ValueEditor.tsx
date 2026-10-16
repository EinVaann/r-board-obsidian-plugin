import { useEffect, useId, useRef, useState } from 'react';
import type { PropertyConfig } from '../types';
import type { StoredValue } from '../data/properties';
import { asArray, asBoolean, optionFor } from '../render/values';
import { formulaOverride } from '../data/compute';
import { Toggle } from '../settings/controls';

/** The text a stored value is edited as (lists comma-separated). */
export function editText(prop: PropertyConfig, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return asArray(raw).join(', ');
  if (prop.type === 'date' && typeof raw === 'string') return raw.replace(' ', 'T');
  return String(raw);
}

/** HTML input type for a property's text editor. */
function inputType(prop: PropertyConfig): string {
  if (prop.type === 'number') return 'number';
  if (prop.type === 'date') return prop.includeTime ? 'datetime-local' : 'date';
  if (prop.type === 'url') return 'url';
  return 'text';
}

/**
 * An editor for one stored value. Text-like values commit on blur / Enter
 * (Escape cancels); checkboxes and selects commit on change.
 */
export function ValueEditor({
  prop,
  raw,
  onCommit,
  onDone,
  autoFocus = false,
  className,
}: {
  prop: PropertyConfig;
  /** The stored value (for formulas: the per-item override, if any). */
  raw: unknown;
  onCommit: (value: StoredValue) => void;
  /** Editing finished (committed or cancelled), e.g. to close a cell editor. */
  onDone?: () => void;
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
          onDone?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone?.();
        }}
        onBlur={() => onDone?.()}
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
  return (
    <>
      <TextEditor
        prop={prop}
        initial={editText(prop, raw)}
        list={suggestions?.length ? listId : undefined}
        placeholder={prop.type === 'formula' ? (formulaOverride(raw) === 'none' ? prop.formula ?? '' : 'Clear to use the formula') : prop.type === 'multi' || prop.type === 'links' ? 'Comma-separated' : undefined}
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
  initial,
  list,
  placeholder,
  onCommit,
  onDone,
  autoFocus,
  className,
}: {
  prop: PropertyConfig;
  initial: string;
  list?: string;
  placeholder?: string;
  onCommit: (value: StoredValue) => void;
  onDone?: () => void;
  autoFocus: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  // Enter/Escape and the blur that follows must only finish once.
  const done = useRef(false);
  useEffect(() => {
    setDraft(initial);
    done.current = false;
  }, [initial]);

  const finish = (save: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (save && draft.trim() !== initial.trim()) onCommit(draft.trim() === '' ? null : draft.trim());
    onDone?.();
  };

  return (
    <input
      className={className}
      type={inputType(prop)}
      list={list}
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={(e) => {
        done.current = false;
        if (e.currentTarget.type === 'text') e.currentTarget.select();
      }}
      onChange={(e) => {
        done.current = false;
        setDraft(e.target.value);
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
