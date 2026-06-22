import type { BoardItem, LoadLimit } from '../types';

/** Persisted "how many are revealed" state, so re-renders keep the page count. */
export interface PageState {
  /** Stable key for this list (column / section). */
  key: string;
  /** Shared store kept on the view's UI state. */
  store: Record<string, number>;
}

/**
 * Render items in pages of `limit`, with a "View More" button. When `page` is
 * given, the number of revealed items is remembered in `page.store[page.key]`
 * so re-rendering the board (e.g. after moving a card) keeps everything that
 * was already revealed instead of collapsing back to the first page.
 * `limit === 'none'` renders everything.
 */
export function renderPaged(
  host: HTMLElement,
  items: BoardItem[],
  limit: LoadLimit,
  drawItem: (item: BoardItem, host: HTMLElement) => void,
  page?: PageState,
): void {
  if (limit === 'none') {
    for (const item of items) drawItem(item, host);
    return;
  }

  const pageSize = limit;
  let shown = 0;
  let moreBtn: HTMLButtonElement | null = null;

  const reveal = (target: number): void => {
    const end = Math.min(target, items.length);
    for (let i = shown; i < end; i++) drawItem(items[i], host);
    shown = end;
    if (page) page.store[page.key] = shown;

    if (moreBtn) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (shown < items.length) {
      moreBtn = host.createEl('button', {
        cls: 'rb-view-more',
        text: `View More (${items.length - shown})`,
      });
      moreBtn.onclick = () => reveal(shown + pageSize);
    }
  };

  // Start at the previously-revealed count (at least one page), clamped to size.
  const remembered = page ? page.store[page.key] : undefined;
  reveal(Math.max(pageSize, remembered ?? pageSize));
}
