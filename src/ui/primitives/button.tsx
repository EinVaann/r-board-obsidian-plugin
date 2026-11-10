import { forwardRef } from 'react';
import { Icon } from '../../react/Icon';
import { cx, slot } from '../cx';
import type { ButtonVariant, IconTone, NativeProps } from '../types';

export interface ButtonProps extends NativeProps<'button'> {
  variant?: ButtonVariant;
  /** Lucide icon before the label. */
  icon?: string;
}

/** A text button. One `primary` per dialog; `ghost` for text-only actions ("+ Condition", "Show all"). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...props }, ref) {
  // mod-cta / mod-warning keep Obsidian's meaning (and its keyboard handling) for primary / danger.
  const legacy = variant === 'primary' ? 'mod-cta' : variant === 'danger' ? 'mod-warning' : undefined;
  return (
    <button ref={ref} type={type} {...slot('button', variant, size)} className={cx(legacy, className)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends NativeProps<'button'> {
  icon: string;
  /** The accessible name (also the tooltip). */
  label: string;
  /** danger: red on hover (remove / delete). */
  tone?: IconTone;
}

/** A square button with only an icon. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, size = 'md', tone = 'default', className, type = 'button', ...props }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} {...slot('icon-button', tone, size)} className={className} {...props}>
      <Icon name={icon} />
    </button>
  );
});
