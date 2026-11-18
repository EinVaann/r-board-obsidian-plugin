import type { ReactNode } from 'react';
import { DndContext, closestCenter, type DragEndEvent, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from './icon';
import { useDragSensors } from '@/hooks/use-drag-sensors';
import { cn } from '@/lib/utils';

/** Drag-handle props handed to a sortable row. */
export interface HandleProps {
  ref: (el: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
  attributes: Record<string, unknown>;
}

/** The grip a row passes its handle props to: always first in the row. */
export function DragHandle({ handle, className }: { handle: HandleProps; className?: string }) {
  return (
    <span
      ref={handle.ref}
      data-slot="drag-handle"
      aria-label="Drag to reorder"
      className={cn(
        'rb:inline-flex rb:shrink-0 rb:cursor-grab rb:touch-none rb:px-0.5 rb:py-1 rb:text-faint-foreground rb:hover:text-muted-foreground',
        'rb:[&_svg]:size-[var(--rb-icon-size-sm)] rb:focus-visible:outline-none rb:focus-visible:ring-2 rb:focus-visible:ring-ring rb:rounded-control-sm',
        className,
      )}
      {...handle.attributes}
      {...handle.listeners}
    >
      <Icon name="grip-vertical" />
    </span>
  );
}

function SortableRow({ id, className, children }: { id: string; className?: string; children: (handle: HandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      data-slot="sortable-row"
      data-state={isDragging ? 'dragging' : undefined}
      className={cn(className, isDragging && 'rb:relative rb:z-10 rb:bg-popover rb:shadow-lg rb:cursor-grabbing')}
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
  className?: string;
  rowClassName?: string;
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
        <div data-slot="sortable-list" className={className}>
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
