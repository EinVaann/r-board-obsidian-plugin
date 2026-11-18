import type { ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Icon } from '../../react/Icon';
import { slot } from '../cx';
import { IconButton } from './button';
import { DragHandle, SortableList, type HandleProps } from './sortable-list';

/** A list of items in settings: one bordered box, a hairline between rows. See styles/RULES.md. */
export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div {...slot('settings-list')} className={className}>
      {children}
    </div>
  );
}

/** A reorderable settings list: the same box, rows dragged by their grip. */
export function SortableSettingsList({
  ids,
  onReorder,
  renderRow,
  className,
}: {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  renderRow: (id: string, index: number, handle: HandleProps) => ReactNode;
  className?: string;
}) {
  return <SortableList ids={ids} onReorder={onReorder} renderRow={renderRow} variant="settings" className={className} />;
}

export interface SettingsRowProps {
  /** The property-type (or item) icon after the grip. */
  icon?: string;
  /** Usually text; may be an input that looks like text until hovered. */
  name: ReactNode;
  /** Muted text after the name (a type, a count). */
  meta?: ReactNode;
  /** Grip props from a sortable list. */
  handle?: HandleProps;
  /** Row actions (IconButtons), before the trailing control. */
  actions?: ReactNode;
  /** The trailing control: a Switch. */
  control?: ReactNode;
  /** Options shown when the row expands in place (adds the ⌄ button). */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Dimmed (e.g. an item that's switched off). */
  muted?: boolean;
  /** Keep an empty ⌄ slot when this row has no options, so controls line up with rows that do. */
  expandSlot?: boolean;
  className?: string;
}

/** One row: grip · icon · name · meta · actions · control · ⌄, with in-place options. */
export function SettingsRow({ icon, name, meta, handle, actions, control, children, open = false, onOpenChange, muted, expandSlot, className }: SettingsRowProps) {
  const expandable = children !== undefined && children !== null && children !== false;
  const head = (
    <div {...slot('settings-row-head')}>
      {handle && <DragHandle handle={handle} />}
      {icon && (
        <span {...slot('settings-row-icon')}>
          <Icon name={icon} />
        </span>
      )}
      <div {...slot('settings-row-name')}>{name}</div>
      {meta !== undefined && <span {...slot('settings-row-meta')}>{meta}</span>}
      {actions && <span {...slot('settings-row-actions')}>{actions}</span>}
      {control && <span {...slot('settings-row-control')}>{control}</span>}
      {expandable ? (
        <Collapsible.Trigger asChild>
          <IconButton icon="chevron-down" size="sm" data-part="expand" label={open ? 'Hide options' : 'Show options'} />
        </Collapsible.Trigger>
      ) : (
        // Rows in one list line up: a row without options keeps the ⌄ slot empty.
        expandSlot && <span data-part="expand-spacer" aria-hidden="true" />
      )}
    </div>
  );
  if (!expandable) {
    return (
      <div {...slot('settings-row')} data-muted={muted || undefined} className={className}>
        {head}
      </div>
    );
  }
  return (
    <Collapsible.Root {...slot('settings-row')} data-state={open ? 'open' : 'closed'} data-muted={muted || undefined} className={className} open={open} onOpenChange={onOpenChange}>
      {head}
      <Collapsible.Content {...slot('settings-row-body')}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/** "Add …" for the list right above it: full width, dashed. */
export function AddRow({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" {...slot('add-row')} className={className} onClick={onClick}>
      <Icon name="plus" />
      <span>{label}</span>
    </button>
  );
}
