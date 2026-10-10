/**
 * Pointer-driven drag-to-reorder for a vertical list. Uses pointer events
 * rather than HTML5 drag-and-drop, which never fires on touch screens.
 *
 * Rows are the direct children of `list` matching `rowSelector`; dragging
 * starts only from an element matching `handleSelector` inside a row (give it
 * `touch-action: none`). The row moves live in the DOM while dragging;
 * `onReorder(from, to)` runs once on drop if its position changed.
 */
export function makeReorderable(
  list: HTMLElement,
  rowSelector: string,
  handleSelector: string,
  onReorder: (from: number, to: number) => void,
): void {
  const rows = (): HTMLElement[] =>
    Array.from(list.children).filter((el): el is HTMLElement => el.matches(rowSelector));

  list.addEventListener('pointerdown', (e) => {
    const handle = (e.target as HTMLElement).closest<HTMLElement>(handleSelector);
    const row = handle?.closest<HTMLElement>(rowSelector);
    if (!handle || !row || row.parentElement !== list || e.button !== 0) return;
    e.preventDefault();

    const from = rows().indexOf(row);
    row.addClass('rb-dragging');
    handle.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent): void => {
      const others = rows().filter((r) => r !== row);
      const before = others.find((r) => {
        const box = r.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      if (before) {
        if (row.nextElementSibling !== before) list.insertBefore(row, before);
      } else {
        const last = others[others.length - 1];
        if (last && last.nextElementSibling !== row) last.after(row);
      }
    };
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      row.removeClass('rb-dragging');
      const to = rows().indexOf(row);
      if (to !== from) onReorder(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

/** Move `arr[from]` to index `to`, in place. */
export function moveItem<T>(arr: T[], from: number, to: number): void {
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

/**
 * A row of mutually exclusive buttons (segmented control). Updates its own
 * active state on click and reports the picked value.
 */
export function segmented<T extends string>(
  parent: HTMLElement,
  options: { value: T; label: string }[],
  value: T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = parent.createDiv({ cls: 'rb-segmented' });
  for (const opt of options) {
    const btn = group.createEl('button', {
      cls: opt.value === value ? 'rb-segment rb-active' : 'rb-segment',
      text: opt.label,
    });
    btn.onclick = () => {
      if (btn.hasClass('rb-active')) return;
      group.querySelectorAll('.rb-segment').forEach((b) => b.removeClass('rb-active'));
      btn.addClass('rb-active');
      onPick(opt.value);
    };
  }
  return group;
}
