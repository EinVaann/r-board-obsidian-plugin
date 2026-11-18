import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

/*
 * R Board's form controls: thin wrappers over the shadcn components in components/ui that take a
 * value + onChange (what every settings screen needs) instead of raw DOM events. No styles of their own.
 */

/** md: default · sm: dense rows (conditions, list rows). */
export type Size = 'md' | 'sm';
/** A value with a label, for selects, segmented controls and multi-selects. */
export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** Option colour (a dot / tint). */
  color?: string;
}

const sizeAttr = (size: Size): 'sm' | undefined => (size === 'sm' ? 'sm' : undefined);

/** Text field. `invalid` marks it red. */
export function TextField({ size = 'md', invalid, className, ...props }: Omit<ComponentProps<typeof Input>, 'size'> & { size?: Size; invalid?: boolean }) {
  return <Input data-size={sizeAttr(size)} aria-invalid={invalid || undefined} className={className} {...props} />;
}

/** A text field that keeps its own draft and reports every change; resyncs when `value` changes elsewhere. */
export function TextInput({ value, onChange, ...props }: Omit<ComponentProps<typeof TextField>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextField
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/** A number field with an optional unit; keeps the typed text while it isn't a valid number yet. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  size = 'md',
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'size'> & {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the box ("h", "pts", "%"). */
  unit?: string;
  size?: Size;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span data-slot="number-input" className={cn('rb:inline-flex rb:items-center rb:gap-1.5', className)}>
      <Input
        {...props}
        type="number"
        data-size={sizeAttr(size)}
        className="rb:w-24 rb:tabular-nums"
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
      {unit && <span className="rb:shrink-0 rb:text-hint rb:text-muted-foreground">{unit}</span>}
    </span>
  );
}

/** A dropdown (one value): a native <select>, so keyboard, typeahead and phones behave as in Obsidian. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'value' | 'onChange' | 'size'> & { value: T; options: Option<T>[]; onChange: (value: T) => void; size?: Size }) {
  return (
    <NativeSelect size={size === 'sm' ? 'sm' : 'default'} className={className} value={value} onChange={(e) => onChange(e.target.value as T)} {...props}>
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Pick one of a few values. Never deselects. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', label, className }: { value: T; options: Option<T>[]; onChange: (value: T) => void; size?: Size; label?: string; className?: string }) {
  return (
    <ToggleGroup
      type="single"
      variant="segment"
      size={size === 'sm' ? 'sm' : 'default'}
      aria-label={label}
      className={cn('rb-segmented', className)}
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="rb-segment">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** On/off for a setting (styles/RULES.md). */
export function Toggle({ checked, onChange, label, ...props }: Omit<ComponentProps<typeof Switch>, 'checked' | 'onCheckedChange' | 'onChange'> & { checked: boolean; onChange: (on: boolean) => void; label?: string }) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} {...props} />;
}

/** A dropdown box listing the picked values; opens a checklist (several values). */
export function MultiSelect<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  required = false,
  placeholder = 'Pick values',
  className,
  label,
}: {
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
}) {
  const toggle = (v: T): void => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (required && next.length === 0) return;
    onChange(next);
  };
  const text = value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') || placeholder;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="multi-select"
          aria-label={label}
          title={text}
          className={cn(
            'rb:box-border rb:inline-flex rb:min-w-0 rb:max-w-[260px] rb:items-center rb:justify-between rb:gap-2 rb:m-0 rb:border rb:border-solid rb:border-input rb:bg-field rb:shadow-none rb:text-foreground rb:cursor-pointer rb:outline-none',
            'rb:hover:border-input-hover rb:focus-visible:border-ring rb:data-[state=open]:border-ring',
            size === 'sm' ? 'rb:h-control-sm rb:px-control-px-sm rb:rounded-control-sm rb:text-control-sm' : 'rb:h-control rb:px-control-px rb:rounded-control rb:text-control',
            !value.length && 'rb:text-faint-foreground',
            className,
          )}
        >
          <span className="rb:min-w-0 rb:truncate">{text}</span>
          <Icon name="chevrons-up-down" className="rb:inline-flex rb:shrink-0 rb:text-muted-foreground rb:[&_svg]:size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="rb:w-auto rb:min-w-[var(--radix-popover-trigger-width)] rb:max-h-[var(--radix-popover-content-available-height)] rb:overflow-y-auto">
        <div role="listbox" aria-multiselectable="true" className="rb:flex rb:flex-col">
          {options.map((o) => {
            const on = value.includes(o.value);
            const locked = required && on && value.length === 1;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                disabled={locked}
                onClick={() => toggle(o.value)}
                className="rb:flex rb:items-center rb:gap-2 rb:h-control-sm rb:m-0 rb:px-2 rb:border-0 rb:rounded-control-sm rb:bg-transparent rb:shadow-none rb:text-control-sm rb:text-foreground rb:text-left rb:cursor-pointer rb:hover:bg-accent rb:disabled:cursor-default"
              >
                <span className="rb:inline-flex rb:w-icon-sm rb:[&_svg]:size-icon-sm">{on && <Icon name="check" />}</span>
                {o.color !== undefined && <span className="rb:size-2 rb:shrink-0 rb:rounded-full" style={{ background: o.color }} />}
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A square button with only an icon: row actions. Icon meanings: styles/RULES.md. */
export function IconButton({
  icon,
  label,
  size = 'md',
  tone = 'default',
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'size' | 'variant' | 'children'> & { icon: string; label: string; size?: Size; tone?: 'default' | 'danger' }) {
  return (
    <Button
      variant="ghost"
      size={size === 'sm' ? 'icon-sm' : 'icon'}
      aria-label={label}
      title={label}
      data-tone={tone}
      className={cn(tone === 'danger' && 'rb:hover:text-destructive', className)}
      {...props}
    >
      <Icon name={icon} className="rb:inline-flex" />
    </Button>
  );
}

/** A labelled button with an optional leading icon; `primary` = the one action that finishes a dialog. */
export function TextButton({
  icon,
  variant = 'secondary',
  size = 'md',
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & { icon?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: Size; children?: ReactNode }) {
  const v = variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : variant;
  return (
    <Button variant={v} size={size === 'sm' ? 'sm' : 'default'} {...props}>
      {icon && <Icon name={icon} className="rb:inline-flex" />}
      {children}
    </Button>
  );
}

/** A small rounded label (option values, tags, counts). `color` tints it. */
export function Pill({ children, color, className, onRemove, removeLabel }: { children: ReactNode; color?: string; className?: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <Badge variant={color ? 'tint' : 'default'} className={className} style={color ? ({ ['--rb-pill-c' as string]: color } as React.CSSProperties) : undefined}>
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
          className="rb:inline-grid rb:place-items-center rb:size-4 rb:-mr-1 rb:p-0 rb:m-0 rb:border-0 rb:rounded-full rb:bg-transparent rb:shadow-none rb:text-inherit rb:opacity-60 rb:cursor-pointer rb:hover:opacity-100 rb:[&_svg]:size-[11px]"
        >
          <Icon name="x" className="rb:inline-flex" />
        </button>
      )}
    </Badge>
  );
}
