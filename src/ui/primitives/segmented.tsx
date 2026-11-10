import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { slot } from '../cx';
import type { Option, Size } from '../types';

/** Pick one of a few values (Radix single-select ToggleGroup). Never deselects. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: { value: T; options: Option<T>[]; onChange: (value: T) => void; size?: Size; label?: string }) {
  return (
    <ToggleGroup.Root
      type="single"
      {...slot('segmented', undefined, size)}
      className="rb-segmented"
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} {...slot('segmented-item', undefined, size)} className="rb-segment">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
