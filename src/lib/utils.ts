import { createCn } from 'cn/config';

// shadcn's class joiner, told about the `rb:` prefix and the theme names in styles/tailwind.css
// (otherwise it can't see that e.g. `rb:h-control` and `rb:h-8` conflict).
export const cn = createCn({
  prefix: 'rb',
  extend: {
    theme: {
      color: [
        'faint-foreground', 'divider', 'input-hover', 'field', 'switch-on', 'switch-off', 'switch-thumb', 'switch-thumb-on',
        'segment-on', 'segment-on-foreground', 'track', 'track-border', 'danger-surface', 'danger-border', 'danger-hover',
        'secondary-border', 'secondary-hover', 'ghost-foreground', 'icon-foreground',
      ],
      radius: ['control', 'control-sm', 'surface', 'button', 'button-sm', 'switch', 'switch-thumb', 'pill'],
      spacing: [
        'control', 'control-sm', 'control-px', 'control-px-sm', 'btn-px', 'btn-px-sm', 'icon', 'icon-sm', 'icon-btn-sm',
        'row', 'row-indent', 'switch-w', 'switch-h', 'switch-thumb', 'switch-pad', 'pill-h',
      ],
      text: ['control', 'control-sm', 'hint', 'label', 'title'],
      shadow: ['button-primary', 'button-secondary', 'surface', 'popover', 'segment-on'],
    },
  },
});
