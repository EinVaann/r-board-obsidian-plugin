/**
 * A Data-tab table whose columns can be resized by dragging the right edge of
 * a header. Widths are remembered per table on this device (localStorage);
 * a trailing narrow column holds row actions.
 */

import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface DxColumn {
  key: string;
  label: string;
  /** Default width in px. */
  width: number;
  num?: boolean;
}

const MIN = 48;
const ACTIONS = 40;
const storeKey = (id: string): string => `r-board:factory-cols:${id}`;

function load(id: string): Record<string, number> {
  try {
    const v = JSON.parse(window.localStorage.getItem(storeKey(id)) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function save(id: string, widths: Record<string, number>): void {
  try {
    window.localStorage.setItem(storeKey(id), JSON.stringify(widths));
  } catch {
    // Storage unavailable: widths last for this session only.
  }
}

export function DxTable({ id, columns, children }: { id: string; columns: DxColumn[]; children: ReactNode }) {
  const [widths, setWidths] = useState<Record<string, number>>(() => load(id));
  const width = (c: DxColumn): number => widths[c.key] ?? c.width;
  const total = columns.reduce((t, c) => t + width(c), 0) + ACTIONS;

  const startDrag = (c: DxColumn, e: ReactPointerEvent<HTMLSpanElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width(c);
    let latest = widths;
    const move = (ev: PointerEvent): void => {
      latest = { ...latest, [c.key]: Math.max(MIN, Math.round(w0 + ev.clientX - x0)) };
      setWidths(latest);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('rb-dx-resizing');
      save(id, latest);
    };
    document.body.classList.add('rb-dx-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const reset = (c: DxColumn): void => {
    const next = { ...widths };
    delete next[c.key];
    setWidths(next);
    save(id, next);
  };

  return (
    <table className="rb-dx-table" style={{ width: total }}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: width(c) }} />
        ))}
        <col style={{ width: ACTIONS }} />
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.num ? 'rb-dx-num' : undefined}>
              <span className="rb-dx-th-label">{c.label}</span>
              <span
                className="rb-dx-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${c.label}`}
                title="Drag to resize · double-click to reset"
                onPointerDown={(e) => startDrag(c, e)}
                onDoubleClick={() => reset(c)}
              />
            </th>
          ))}
          <th />
        </tr>
      </thead>
      {children}
    </table>
  );
}
