import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../react/Icon';
import { cx, slot } from '../cx';
import type { NativeProps, Option, Size } from '../types';

export interface SelectProps<T extends string> extends Omit<NativeProps<'select'>, 'value' | 'onChange'> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}

/** A native dropdown (one value). */
export function Select<T extends string>({ value, options, onChange, size = 'md', className, ...props }: SelectProps<T>) {
  return (
    <select {...slot('select', undefined, size)} className={className} value={value} onChange={(e) => onChange(e.target.value as T)} {...props}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface MultiSelectProps<T extends string> {
  value: T[];
  options: Option<T>[];
  onChange: (value: T[]) => void;
  size?: Size;
  /** Keep at least one value picked (the last one can't be unticked). */
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** Accessible name of the trigger. */
  label?: string;
}

/** A dropdown box listing the picked values; opens a checklist (several values). */
export function MultiSelect<T extends string>({ value, options, onChange, size = 'md', required = false, placeholder = 'Pick values', className, label }: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const doc = root.current?.ownerDocument ?? document;
    const close = (e: Event): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    doc.addEventListener('mousedown', close, true);
    doc.addEventListener('keydown', esc, true);
    return () => {
      doc.removeEventListener('mousedown', close, true);
      doc.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const toggleOpen = (): void => {
    // Open upward when the nearest scrolling box has no room below.
    const el = root.current;
    let scroller: HTMLElement | null | undefined = el?.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY === 'visible') scroller = scroller.parentElement;
    if (el && scroller) setUp(scroller.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < options.length * 30 + 24);
    setOpen((o) => !o);
  };
  const toggle = (v: T): void => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (required && next.length === 0) return;
    onChange(next);
  };
  const text = value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') || placeholder;

  return (
    <span ref={root} {...slot('multi-select', undefined, size)} className={className}>
      <button type="button" {...slot('multi-select-trigger', undefined, size)} aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={text} onClick={toggleOpen}>
        <span {...slot('multi-select-value')}>{text}</span>
      </button>
      {open && (
        <MultiSelectContent up={up}>
          {options.map((o) => (
            <MultiSelectItem key={o.value} option={o} selected={value.includes(o.value)} locked={required && value.length === 1 && value.includes(o.value)} onToggle={() => toggle(o.value)} />
          ))}
        </MultiSelectContent>
      )}
    </span>
  );
}

function MultiSelectContent({ up, children }: { up: boolean; children: ReactNode }) {
  return (
    <span {...slot('multi-select-content')} data-side={up ? 'top' : 'bottom'} role="listbox" aria-multiselectable="true">
      {children}
    </span>
  );
}

function MultiSelectItem<T extends string>({ option, selected, locked, onToggle }: { option: Option<T>; selected: boolean; locked: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} {...slot('multi-select-item')} data-state={selected ? 'on' : 'off'} disabled={locked} onClick={onToggle}>
      <span {...slot('multi-select-check')}>{selected && <Icon name="check" />}</span>
      {option.color !== undefined && <span {...slot('color-dot')} style={{ ['--rb-dot' as string]: option.color }} />}
      <span className={cx()}>{option.label}</span>
    </button>
  );
}
