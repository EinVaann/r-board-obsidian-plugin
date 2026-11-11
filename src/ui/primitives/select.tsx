import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
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

const GAP = 4;
const EDGE = 8;

/** A dropdown box listing the picked values; opens a checklist (several values). */
export function MultiSelect<T extends string>({ value, options, onChange, size = 'md', required = false, placeholder = 'Pick values', className, label }: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
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

  const toggle = (v: T): void => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (required && next.length === 0) return;
    onChange(next);
  };
  const text = value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') || placeholder;

  return (
    <span ref={root} {...slot('multi-select', undefined, size)} className={className}>
      <button type="button" {...slot('multi-select-trigger', undefined, size)} aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={text} onClick={() => setOpen((o) => !o)}>
        <span {...slot('multi-select-value')}>{text}</span>
      </button>
      {open && (
        <MultiSelectContent anchor={root}>
          {options.map((o) => (
            <MultiSelectItem key={o.value} option={o} selected={value.includes(o.value)} locked={required && value.length === 1 && value.includes(o.value)} onToggle={() => toggle(o.value)} />
          ))}
        </MultiSelectContent>
      )}
    </span>
  );
}

/** The checklist: fixed to the viewport so dialogs and scroll boxes can't clip it; opens on the side with more room. */
function MultiSelectContent({ anchor, children }: { anchor: RefObject<HTMLSpanElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: 0, top: 0 });
  const [side, setSide] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    const el = ref.current;
    const trigger = anchor.current;
    if (!el || !trigger) return;
    const doc = trigger.ownerDocument;
    const win = doc.defaultView ?? window;
    const place = (): void => {
      const r = trigger.getBoundingClientRect();
      const below = win.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = el.scrollHeight > below && above > below;
      const width = Math.max(el.offsetWidth, r.width);
      const left = Math.max(EDGE, Math.min(r.right - width, win.innerWidth - width - EDGE));
      const top = up ? r.top - GAP - Math.min(el.scrollHeight, above) : r.bottom + GAP;
      // A transformed ancestor moves the fixed box's origin; measure it and compensate.
      const now = el.getBoundingClientRect();
      const originX = now.left - (parseFloat(el.style.left) || 0);
      const originY = now.top - (parseFloat(el.style.top) || 0);
      setSide(up ? 'top' : 'bottom');
      setStyle({ left: left - originX, top: top - originY, minWidth: r.width, maxHeight: up ? above : below });
    };
    place();
    // Fixed boxes don't follow scrolling, so re-place when anything behind it scrolls.
    const onScroll = (e: Event): void => {
      if (e.target !== el) place();
    };
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', place);
    return () => {
      doc.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', place);
    };
  }, [anchor]);

  return (
    <span ref={ref} {...slot('multi-select-content')} data-side={side} role="listbox" aria-multiselectable="true" style={style}>
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
