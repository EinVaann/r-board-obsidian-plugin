import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../../react/Icon';
import { cx, slot } from '../cx';
import type { Size, SurfaceVariant } from '../types';

type DivProps = HTMLAttributes<HTMLDivElement>;

/** A raised surface holding a header and content (settings cards, panels). */
export function Card({ variant = 'raised', size = 'md', className, ...props }: DivProps & { variant?: SurfaceVariant; size?: Size }) {
  return <section {...slot('card', variant, size)} className={className} {...props} />;
}
export function CardHeader({ className, ...props }: DivProps) {
  return <header {...slot('card-header')} className={className} {...props} />;
}
/** The round icon at the start of a card header. */
export function CardIcon({ icon }: { icon: string }) {
  return (
    <span {...slot('card-icon')}>
      <Icon name={icon} />
    </span>
  );
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h4 {...slot('card-title')} className={className} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...slot('card-description')} className={className} {...props} />;
}
export function CardActions({ className, ...props }: DivProps) {
  return <div {...slot('card-actions')} className={className} {...props} />;
}
export function CardContent({ className, ...props }: DivProps) {
  return <div {...slot('card-content')} className={className} {...props} />;
}
export function CardFooter({ className, ...props }: DivProps) {
  return <div {...slot('card-footer')} className={className} {...props} />;
}

/** The usual card: icon, title, description, optional actions, then content. */
export function SimpleCard({ icon, title, desc, actions, children, className }: { icon: string; title: string; desc?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Card className={cx('rb-scard', className)}>
      <CardHeader>
        <CardIcon icon={icon} />
        <div {...slot('card-heading')}>
          <CardTitle>{title}</CardTitle>
          {desc && <CardDescription>{desc}</CardDescription>}
        </div>
        {actions && <CardActions>{actions}</CardActions>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}
