import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '@/utils/cn';

/** On/off for a setting (styles/RULES.md). Size, shape and colours come from the --rb-switch-* tokens. */
export function Switch({
  checked,
  onChange,
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'onCheckedChange' | 'onChange'> & {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** The accessible name. */
  label?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className={cn(
        'rb:peer rb:relative rb:inline-flex rb:shrink-0 rb:cursor-pointer rb:items-center rb:p-0 rb:m-0 rb:border-0 rb:shadow-none',
        'rb:h-switch-h rb:w-switch-w rb:rounded-switch rb:bg-switch-off rb:transition-colors rb:outline-none',
        'rb:data-[state=checked]:bg-switch-on',
        'rb:focus-visible:ring-2 rb:focus-visible:ring-ring',
        'rb:disabled:cursor-not-allowed rb:disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'rb:pointer-events-none rb:block rb:w-switch-thumb rb:h-[calc(var(--rb-switch-h)-2*var(--rb-switch-pad))] rb:rounded-switch-thumb',
          'rb:bg-switch-thumb rb:shadow-sm rb:transition-transform',
          'rb:translate-x-switch-pad rb:data-[state=checked]:translate-x-[calc(var(--rb-switch-w)-var(--rb-switch-thumb-w)-var(--rb-switch-pad))]',
          'rb:data-[state=checked]:bg-switch-thumb-on',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
