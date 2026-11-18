import { useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Icon } from '@/components/icon';
import { IconButton } from '@/components/form-controls';
import { cn } from '@/lib/utils';
import { DragHandle, SortableList, type HandleProps } from './sortable-list';

/** The box every settings list sits in (styles/RULES.md → Settings lists). */
const listBox = 'rb:flex rb:flex-col rb:overflow-hidden rb:border rb:border-solid rb:border-border rb:rounded-surface';
/** A hairline between rows. */
const rowDivider = 'rb:[&+&]:border-t rb:[&+&]:border-solid rb:[&+&]:border-divider rb:[&+&]:border-x-0 rb:[&+&]:border-b-0';

/** A list of items in settings: one bordered box, a hairline between rows. */
export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="settings-list" className={cn(listBox, className)}>
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
  return <SortableList ids={ids} onReorder={onReorder} renderRow={renderRow} className={cn(listBox, className)} rowClassName={rowDivider} />;
}

export interface SettingsRowProps {
  /** The property-type (or item) icon after the grip. */
  icon?: string;
  /** Usually text; may be an Input that reads as text until hovered. */
  name: ReactNode;
  /** Muted text after the name (a type, a count), or a quiet Select. */
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
  /** Dimmed (an item that's switched off). */
  muted?: boolean;
  /** Keep an empty ⌄ slot when this row has no options, so controls line up with rows that do. */
  expandSlot?: boolean;
  className?: string;
}

/** One row: grip · icon · name · meta · actions · control · ⌄, with in-place options. */
export function SettingsRow({ icon, name, meta, handle, actions, control, children, open: openProp, onOpenChange, muted, expandSlot, className }: SettingsRowProps) {
  const expandable = children !== undefined && children !== null && children !== false;
  // Controlled when the parent passes `open`, else the row keeps its own state.
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;

  const head = (
    <div data-slot="settings-row-head" className="rb:flex rb:items-center rb:gap-2.5 rb:min-h-row rb:py-1 rb:pr-2 rb:pl-2.5">
      {handle && <DragHandle handle={handle} />}
      {icon && (
        <span className="rb:inline-flex rb:shrink-0 rb:text-muted-foreground rb:[&_svg]:size-[var(--rb-icon-size)]">
          <Icon name={icon} />
        </span>
      )}
      <div
        data-slot="settings-row-name"
        className={cn(
          'rb:flex rb:flex-1 rb:min-w-0 rb:items-center rb:text-control rb:font-medium',
          muted ? 'rb:text-faint-foreground' : 'rb:text-foreground',
          // An Input or Select in the row reads as text until hovered or focused.
          'rb:[&_[data-slot=input]:not(:hover):not(:focus):not([aria-invalid])]:border-transparent rb:[&_[data-slot=input]:not(:hover):not(:focus):not([aria-invalid])]:bg-transparent',
          'rb:[&>[data-slot=input]]:flex-1 rb:[&>[data-slot=input]]:min-w-0 rb:[&>[data-slot=input]]:-ml-[var(--rb-control-px-sm)]',
        )}
      >
        {name}
      </div>
      {meta !== undefined && (
        <span className="rb:shrink-0 rb:whitespace-nowrap rb:text-hint rb:text-faint-foreground rb:[&_[data-slot=native-select]:not(:hover):not(:focus)]:border-transparent rb:[&_[data-slot=native-select]:not(:hover):not(:focus)]:bg-transparent">
          {meta}
        </span>
      )}
      {actions && <span className="rb:flex rb:shrink-0 rb:items-center rb:gap-0.5">{actions}</span>}
      {control && <span className="rb:flex rb:shrink-0 rb:items-center">{control}</span>}
      {expandable ? (
        <CollapsibleTrigger asChild>
          <IconButton icon="chevron-down" size="sm" data-part="expand" className="rb:[&_svg]:transition-transform rb:aria-expanded:[&_svg]:rotate-180" label={open ? 'Hide options' : 'Show options'} />
        </CollapsibleTrigger>
      ) : (
        expandSlot && <span aria-hidden="true" className="rb:w-icon-btn-sm rb:shrink-0" />
      )}
    </div>
  );

  if (!expandable) {
    return (
      <div data-slot="settings-row" className={cn(rowDivider, className)}>
        {head}
      </div>
    );
  }
  return (
    <Collapsible data-slot="settings-row" open={open} onOpenChange={setOpen} className={cn(rowDivider, 'rb:data-[state=open]:bg-muted', className)}>
      {head}
      <CollapsibleContent
        data-slot="settings-row-body"
        className="rb:data-[state=open]:flex rb:flex-col rb:gap-3 rb:pt-3 rb:pr-3.5 rb:pb-3.5 rb:pl-row-indent rb:border-t rb:border-solid rb:border-divider rb:border-x-0 rb:border-b-0"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

const addRowClass = cn(
  'rb:flex rb:w-full rb:items-center rb:justify-center rb:gap-1.5 rb:h-control rb:mt-2.5 rb:mb-0 rb:mx-0 rb:px-4',
  'rb:border rb:border-dashed rb:border-input-hover rb:rounded-surface rb:bg-transparent rb:shadow-none',
  'rb:text-control rb:font-medium rb:text-faint-foreground rb:cursor-pointer rb:transition-colors',
  'rb:hover:border-faint-foreground rb:hover:bg-transparent rb:hover:text-foreground',
  'rb:focus-visible:outline-none rb:focus-visible:ring-2 rb:focus-visible:ring-ring',
  'rb:[&_.rb-icon]:inline-flex rb:[&_svg]:size-[var(--rb-icon-size-sm)]',
);

/** "Add …" for the list right above it: full width, dashed. */
export function AddRow({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" data-slot="add-row" className={cn(addRowClass, className)} onClick={onClick}>
      <Icon name="plus" />
      <span>{label}</span>
    </button>
  );
}

/** "Add …" for lists added to by typing a value (option values): the same dashed row, typed into. */
export function AddRowInput({ placeholder, onAdd, className, label }: { placeholder: string; onAdd: (value: string) => void; className?: string; label?: string }) {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const v = draft.trim();
    setDraft('');
    if (v) onAdd(v);
  };
  return (
    <label data-slot="add-row" className={cn(addRowClass, 'rb:justify-start rb:cursor-text rb:focus-within:border-solid rb:focus-within:border-ring', className)}>
      <Icon name="plus" />
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="rb:flex-1 rb:min-w-0 rb:h-full rb:p-0 rb:border-0 rb:bg-transparent rb:shadow-none rb:outline-none rb:text-control rb:text-foreground rb:placeholder:text-faint-foreground"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
        onBlur={submit}
      />
    </label>
  );
}
