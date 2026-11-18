import { useMemo, useRef } from 'react';
import { debounce } from 'obsidian';
import { arrayMove } from '@dnd-kit/sortable';
import type { SelectOption } from '../../../../types/database';
import { autoColor } from '../../../../lib/render/values';
import { ColorSwatch } from '@/components/color-swatch';
import { AddRowInput, IconButton, Pill, SettingsRow, SortableSettingsList, TextInput } from './controls';

let nextId = 0;

/**
 * The known values of a select / multi property: drag to reorder (sets group
 * and sort order), each with an optional label and color. Controlled.
 */
export function OptionsEditor({ options, onChange }: { options: SelectOption[]; onChange: (next: SelectOption[] | undefined) => void }) {
  const ids = useRef<string[]>([]);
  if (ids.current.length !== options.length) {
    ids.current = Array.from({ length: options.length }, (_, i) => ids.current[i] ?? `o${nextId++}`);
  }
  const latest = useRef({ options, onChange });
  latest.current = { options, onChange };

  const emit = (next: SelectOption[]): void => latest.current.onChange(next.length ? next : undefined);
  const patch = (i: number, p: Partial<SelectOption>): void =>
    emit(latest.current.options.map((o, j) => (j === i ? clean({ ...o, ...p }) : o)));
  // Color pickers fire continuously while dragging; persist once the user settles.
  const setColor = useMemo(() => debounce((i: number, color: string) => patch(i, { color }), 200), []);

  const add = (value: string): void => {
    if (options.some((o) => o.value === value)) return;
    ids.current = [...ids.current, `o${nextId++}`];
    emit([...options, { value }]);
  };

  return (
    <div className="rb-options">
      {options.length > 0 && (
        <SortableSettingsList
          ids={ids.current}
          onReorder={(from, to) => {
            ids.current = arrayMove(ids.current, from, to);
            emit(arrayMove(options, from, to));
          }}
          renderRow={(_id, i, handle) => {
            const o = options[i];
            return (
              <SettingsRow
                className="rb-option-row"
                handle={handle}
                name={
                  <>
                    <ColorSwatch color={o.color} label={`Color of ${o.label || o.value}`} onChange={(c) => setColor(i, c)} />
                    <TextInput size="sm" aria-label="Value" value={o.value} placeholder="Value" onChange={(v) => v.trim() && patch(i, { value: v.trim() })} />
                    <TextInput size="sm" aria-label="Label" value={o.label ?? ''} placeholder="Label" onChange={(v) => patch(i, { label: v.trim() || undefined })} />
                  </>
                }
                meta={<Pill color={o.color ?? autoColor(o.value)}>{o.label || o.value}</Pill>}
                actions={
                  <IconButton
                    icon="trash-2"
                    size="sm"
                    tone="danger"
                    label={`Remove ${o.label || o.value}`}
                    onClick={() => {
                      ids.current = ids.current.filter((_, j) => j !== i);
                      emit(options.filter((_, j) => j !== i));
                    }}
                  />
                }
              />
            );
          }}
        />
      )}
      <AddRowInput placeholder="Add a value…" onAdd={add} />
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
