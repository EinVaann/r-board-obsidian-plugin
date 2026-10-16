import { useMemo, useRef, useState } from 'react';
import { debounce } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { SelectOption } from '../types';
import { autoColor } from '../render/values';
import { Icon } from '../react/Icon';
import { DragHandle, SortableList, TextInput } from './controls';

let nextId = 0;

/** CSS color → `#rrggbb` for the color input (non-hex colors show as gray). */
function hexOf(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#888888';
}

/**
 * The known values of a select / multi property: drag to reorder (sets group
 * and sort order), each with an optional label and color. Controlled.
 */
export function OptionsEditor({ options, onChange }: { options: SelectOption[]; onChange: (next: SelectOption[] | undefined) => void }) {
  const ids = useRef<string[]>([]);
  if (ids.current.length !== options.length) {
    ids.current = Array.from({ length: options.length }, (_, i) => ids.current[i] ?? `o${nextId++}`);
  }
  const [draft, setDraft] = useState('');
  const latest = useRef({ options, onChange });
  latest.current = { options, onChange };

  const emit = (next: SelectOption[]): void => latest.current.onChange(next.length ? next : undefined);
  const patch = (i: number, p: Partial<SelectOption>): void =>
    emit(latest.current.options.map((o, j) => (j === i ? clean({ ...o, ...p }) : o)));
  // Color pickers fire continuously while dragging; persist once the user settles.
  const setColor = useMemo(() => debounce((i: number, color: string) => patch(i, { color }), 200), []);

  const add = (): void => {
    const value = draft.trim();
    setDraft('');
    if (!value || options.some((o) => o.value === value)) return;
    ids.current = [...ids.current, `o${nextId++}`];
    emit([...options, { value }]);
  };

  return (
    <div className="rb-options">
      <SortableList
        ids={ids.current}
        onReorder={(from, to) => {
          ids.current = arrayMove(ids.current, from, to);
          emit(arrayMove(options, from, to));
        }}
        className="rb-options-list"
        rowClassName="rb-option-row"
        renderRow={(_id, i, handle) => {
          const o = options[i];
          return (
            <>
              <DragHandle handle={handle} />
              <input
                className="rb-option-color"
                type="color"
                aria-label="Color"
                value={hexOf(o.color ?? '')}
                style={o.color ? undefined : { opacity: 0.5 }}
                onChange={(e) => setColor(i, e.target.value)}
              />
              <TextInput className="rb-option-value" value={o.value} placeholder="Value" onChange={(v) => v.trim() && patch(i, { value: v.trim() })} />
              <TextInput className="rb-option-label" value={o.label ?? ''} placeholder="Label" onChange={(v) => patch(i, { label: v.trim() || undefined })} />
              <span className="rb-pill rb-opt rb-option-preview" style={{ '--oc': o.color ?? autoColor(o.value) } as React.CSSProperties}>
                {o.label || o.value}
              </span>
              <button
                className="rb-icon-btn"
                aria-label="Remove value"
                onClick={() => {
                  ids.current = ids.current.filter((_, j) => j !== i);
                  emit(options.filter((_, j) => j !== i));
                }}
              >
                <Icon name="x" />
              </button>
            </>
          );
        }}
      />
      <div className="rb-option-add">
        <input
          type="text"
          placeholder="Add a value…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button onClick={add}>
          <Icon name="plus" /> Add
        </button>
      </div>
    </div>
  );
}

/** Drop empty label / color keys. */
function clean(o: SelectOption): SelectOption {
  const out: SelectOption = { value: o.value };
  if (o.label) out.label = o.label;
  if (o.color) out.color = o.color;
  return out;
}
