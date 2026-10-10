import { useEffect, useState, type ReactNode } from 'react';
import * as Switch from '@radix-ui/react-switch';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tabs from '@radix-ui/react-tabs';
import { DndContext, closestCenter, type DragEndEvent, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '../react/Icon';
import { useDragSensors } from '../components/dnd';

/** A settings row in Obsidian's own markup (label + description left, control right). */
export function SettingRow({
  name,
  desc,
  children,
  className,
  toggle = false,
}: {
  name?: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** A row whose control is a switch: Obsidian keeps these on one line on phones. */
  toggle?: boolean;
}) {
  const cls = ['setting-item', toggle ? 'mod-toggle' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="setting-item-info">
        {name && <div className="setting-item-name">{name}</div>}
        {desc && <div className="setting-item-description">{desc}</div>}
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}

/** A text input that edits locally and reports every change. Resyncs if the value changes elsewhere. */
export function TextInput({
  value,
  onChange,
  placeholder,
  className,
  type = 'text',
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  type?: 'text' | 'number';
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type={type}
      className={[className, invalid ? 'rb-invalid' : ''].filter(Boolean).join(' ') || undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** A native select styled as Obsidian's dropdown. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = 'dropdown',
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select className={className} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** An on/off switch (Radix Switch, styled like Obsidian's toggle). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <Switch.Root className="rb-switch" checked={checked} onCheckedChange={onChange} aria-label={label}>
      <Switch.Thumb className="rb-switch-thumb" />
    </Switch.Root>
  );
}

/** A segmented control (Radix single-select ToggleGroup). Never deselects. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Option<T>[]; onChange: (value: T) => void }) {
  return (
    <ToggleGroup.Root
      type="single"
      className="rb-segmented"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="rb-segment">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export interface TabDef {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
}

/** Settings tabs (Radix Tabs) over a scrolling body. */
export function SettingsTabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [tab, setTab] = useState(initial ?? tabs[0]?.id);
  // A tab can disappear (e.g. Columns when the view stops being a kanban).
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  return (
    <Tabs.Root className="rb-wizard rb-settings" value={current} onValueChange={setTab}>
      <Tabs.List className="rb-settings-tabs">
        {tabs.map((t) => (
          <Tabs.Trigger key={t.id} value={t.id} className="rb-settings-tab">
            <Icon name={t.icon} className="rb-settings-tab-icon" />
            <span>{t.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id} className="rb-settings-body">
          {t.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/** Drag-handle props handed to a sortable row. */
export interface HandleProps {
  ref: (el: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
  attributes: Record<string, unknown>;
}

/** The grip a row passes its handle props to. */
export function DragHandle({ handle }: { handle: HandleProps }) {
  return (
    <span ref={handle.ref} className="rb-drag-handle" aria-label="Drag to reorder" {...handle.attributes} {...handle.listeners}>
      <Icon name="grip-vertical" />
    </span>
  );
}

function SortableRow({ id, className, children }: { id: string; className: string; children: (handle: HandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? `${className} rb-dragging` : className}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children({ ref: setActivatorNodeRef, listeners, attributes: attributes as unknown as Record<string, unknown> })}
    </div>
  );
}

/**
 * A vertical list whose rows reorder by dragging a handle (dnd-kit; works with
 * mouse, touch long-press and keyboard). `onReorder` gets the moved indexes.
 */
export function SortableList({
  ids,
  onReorder,
  className,
  rowClassName,
  renderRow,
}: {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  className: string;
  rowClassName: string;
  renderRow: (id: string, index: number, handle: HandleProps) => ReactNode;
}) {
  const sensors = useDragSensors();
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    onReorder(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {ids.map((id, i) => (
            <SortableRow key={id} id={id} className={rowClassName}>
              {(handle) => renderRow(id, i, handle)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
