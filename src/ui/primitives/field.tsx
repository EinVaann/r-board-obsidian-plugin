import type { ReactNode } from 'react';
import { slot } from '../cx';
import type { Orientation } from '../types';

/**
 * A labelled control. vertical: label above (field grids); horizontal: label
 * and description left, control right (settings rows).
 */
export function Field({ orientation = 'vertical', className, children, toggle }: { orientation?: Orientation; className?: string; children: ReactNode; toggle?: boolean }) {
  const Tag = orientation === 'vertical' ? 'label' : 'div';
  return (
    <Tag {...slot('field', orientation)} data-toggle={toggle || undefined} className={className}>
      {children}
    </Tag>
  );
}
export function FieldInfo({ children }: { children: ReactNode }) {
  return <span {...slot('field-info')}>{children}</span>;
}
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span {...slot('field-label')}>{children}</span>;
}
/** A short note after the label ("optional", "e.g. genre"). */
export function FieldHint({ children }: { children: ReactNode }) {
  return <span {...slot('field-hint')}>{children}</span>;
}
/** A sentence under the label (settings rows). */
export function FieldDescription({ children }: { children: ReactNode }) {
  return <span {...slot('field-description')}>{children}</span>;
}
export function FieldControl({ children }: { children: ReactNode }) {
  return <span {...slot('field-control')}>{children}</span>;
}
export function FieldError({ children }: { children?: ReactNode }) {
  return children ? (
    <span {...slot('field-error')} role="alert">
      {children}
    </span>
  ) : null;
}

/** Label above its control, with an optional hint: the field grids inside cards. */
export function LabeledField({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <Field className={className}>
      <FieldLabel>
        {label}
        {hint && <FieldHint>{hint}</FieldHint>}
      </FieldLabel>
      <FieldControl>{children}</FieldControl>
    </Field>
  );
}
