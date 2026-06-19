import type { BoardItem } from '../types';

/** Items shown before the "View More" button appears. */
export const PAGE_SIZE = 50;

/**
 * Render items in pages: draw the first `PAGE_SIZE`, then a "View More" button
 * that reveals the next page in place. `drawItem` appends one item to `host`.
 */
export function renderPaged(
  host: HTMLElement,
  items: BoardItem[],
  drawItem: (item: BoardItem, host: HTMLElement) => void,
): void {
  let shown = 0;

  const drawNext = (): void => {
    const end = Math.min(shown + PAGE_SIZE, items.length);
    for (let i = shown; i < end; i++) drawItem(items[i], host);
    shown = end;
  };

  drawNext();

  if (shown < items.length) {
    const remaining = items.length - shown;
    const more = host.createEl('button', {
      cls: 'rb-view-more',
      text: `View More (${remaining})`,
    });
    more.onclick = () => {
      more.remove();
      renderPaged(host, items.slice(shown), drawItem);
    };
  }
}
