import { forwardRef, useEffect, useState } from 'react';
import { cx, slot } from '../cx';
import type { NativeProps } from '../types';

export interface InputProps extends NativeProps<'input'> {
  invalid?: boolean;
}

/** A plain text / number / date field. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', invalid, className, type = 'text', ...props }, ref) {
  return <input ref={ref} type={type} {...slot('input', undefined, size)} aria-invalid={invalid || undefined} className={cx(invalid && 'rb-invalid', className)} {...props} />;
});

/** A text field that keeps its own draft and reports every change; resyncs when `value` changes elsewhere. */
export function TextInput({ value, onChange, ...props }: Omit<InputProps, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export interface NumberInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'> {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the box ("h", "pts", "%"). */
  unit?: string;
}

/** A number field with an optional unit; keeps the typed text while it isn't a valid number yet. */
export function NumberInput({ value, onChange, min, max, step, unit, className, ...props }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span {...slot('number-input')} className={className}>
      <Input
        {...props}
        type="number"
        value={draft ?? String(value)}
        min={min}
        max={max}
        step={step ?? 'any'}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && <span {...slot('number-input-unit')}>{unit}</span>}
    </span>
  );
}
