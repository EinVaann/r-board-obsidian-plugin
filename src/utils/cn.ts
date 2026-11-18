import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge must know the `rb:` prefix and our theme names, or it can't tell conflicting classes apart.
const twMerge = extendTailwindMerge({
  prefix: 'rb',
  extend: {
    theme: {
      color: ['background', 'foreground', 'muted', 'muted-foreground', 'faint-foreground', 'accent', 'accent-foreground', 'border', 'divider', 'input', 'input-hover', 'field', 'ring', 'popover', 'popover-foreground', 'primary', 'destructive', 'switch-on', 'switch-off', 'switch-thumb', 'switch-thumb-on'],
      radius: ['control', 'control-sm', 'surface', 'button', 'switch', 'switch-thumb'],
      spacing: ['control', 'control-sm', 'icon-btn-sm', 'row', 'row-indent', 'switch-w', 'switch-h', 'switch-thumb', 'switch-pad'],
      text: ['control', 'control-sm', 'hint', 'label'],
    },
  },
});

/** shadcn's class joiner: later classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
