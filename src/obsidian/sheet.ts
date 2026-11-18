import { Platform, type Modal } from 'obsidian';

/** Drag distance (px) past which letting go dismisses the sheet. */
const DISMISS_DISTANCE = 120;
/** Flick speed (px/ms) that dismisses the sheet regardless of distance. */
const DISMISS_VELOCITY = 0.6;

/**
 * On phones, turn a modal into a bottom sheet: anchored to the bottom edge,
 * full width, sliding up, with a grab handle. Dragging the handle or the
 * header down follows the finger and dismisses past a threshold (or on a
 * flick); otherwise it springs back. No-op on desktop and tablets.
 *
 * Call from the modal's `onOpen`. `dragFrom` are extra elements (e.g. a custom
 * header) that start the swipe besides the handle.
 */
export function applySheet(modal: Modal, dragFrom: HTMLElement[] = []): void {
  if (!Platform.isPhone) return;
  const sheet = modal.modalEl;
  modal.containerEl.addClass('rb-sheet-container');
  sheet.addClass('rb-sheet');

  const handle = sheet.ownerDocument.createElement('div');
  handle.className = 'rb-sheet-handle';
  handle.setAttribute('aria-label', 'Drag down to close');
  sheet.prepend(handle);

  for (const el of [handle, modal.titleEl, ...dragFrom]) wireSwipe(el, sheet, () => modal.close());
}

function wireSwipe(grip: HTMLElement, sheet: HTMLElement, dismiss: () => void): void {
  grip.addClass('rb-sheet-grip');
  grip.addEventListener('pointerdown', (e) => {
    // Let buttons and inputs in a header work normally.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const startY = e.clientY;
    const startT = e.timeStamp;
    let dy = 0;
    grip.setPointerCapture(e.pointerId);
    sheet.addClass('rb-sheet-dragging');

    const move = (ev: PointerEvent): void => {
      dy = Math.max(0, ev.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const end = (ev: PointerEvent): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      sheet.removeClass('rb-sheet-dragging');
      const velocity = dy / Math.max(1, ev.timeStamp - startT);
      if (ev.type === 'pointerup' && (dy > DISMISS_DISTANCE || (dy > 20 && velocity > DISMISS_VELOCITY))) {
        // Slide the rest of the way out, then close.
        sheet.addClass('rb-sheet-leaving');
        sheet.style.transform = 'translateY(100%)';
        window.setTimeout(dismiss, 180);
      } else {
        sheet.style.transform = '';
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
}
