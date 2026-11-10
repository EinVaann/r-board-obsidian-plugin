import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../react/Icon';
import { slot } from '../cx';

const tint = (color?: string): CSSProperties | undefined => (color ? ({ ['--rb-pill-c' as string]: color } as CSSProperties) : undefined);

/** A small rounded label (option values, tags, counts). `color` tints it. */
export function Pill({ children, color, className, onRemove, removeLabel }: { children: ReactNode; color?: string; className?: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span {...slot('pill')} className={className} style={tint(color)}>
      {children}
      {onRemove && (
        <button type="button" {...slot('pill-remove')} aria-label={removeLabel ?? 'Remove'} onClick={onRemove}>
          <Icon name="x" />
        </button>
      )}
    </span>
  );
}

/** A toggleable pill (pick one or several values). */
export function Chip({ on, onClick, children, className, color, label }: { on: boolean; onClick: () => void; children: ReactNode; className?: string; color?: string; label?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} {...slot('chip')} data-state={on ? 'on' : 'off'} className={className} style={tint(color)} onClick={onClick}>
      {children}
    </button>
  );
}
