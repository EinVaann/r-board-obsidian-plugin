/** Types shared by every UI primitive. Components never hard-code these unions. */
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

/** md: default · sm: dense lists (conditions, rules, rows). */
export type Size = 'md' | 'sm';
/** primary: the one main action · secondary: other actions · ghost: text-only · danger: delete. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type IconTone = 'default' | 'danger';
export type SurfaceVariant = 'raised' | 'sunken';
export type Orientation = 'horizontal' | 'vertical';

/** A value with a label, for selects, segmented controls and multi-selects. */
export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** Optional color dot (option colors). */
  color?: string;
}

/** Props of a native element, plus `size` (the native `size` attribute is never used). */
export type NativeProps<T extends ElementType> = Omit<ComponentPropsWithoutRef<T>, 'size'> & { size?: Size };

export interface WithChildren {
  children?: ReactNode;
}
