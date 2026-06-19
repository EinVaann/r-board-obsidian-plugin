import type { BoardItem, LoadLimit } from '../types';

/**
 * Render items in pages of `limit`: draw the first page, then a "View More"
 * button that reveals the next page in place. `limit === 'none'` renders all
 * items with no button. `drawItem` appends one item to `host`.
 */
export function renderPaged(
  host: HTMLElement,
  items: BoardItem[],
  limit: LoadLimit,
  drawItem: (item: BoardItem, host: HTMLElement) => void,
): void {
  if (limit === 'none') {
    for (const item of items) drawItem(item, host);
    return;
  }

  const pageSize = limit;
  const page = items.slice(0, pageSize);
  for (const item of page) drawItem(item, host);

  if (items.length > pageSize) {
    const rest = items.slice(pageSize);
    const more = host.createEl('button', {
      cls: 'rb-view-more',
      text: `View More (${rest.length})`,
    });
    more.onclick = () => {
      more.remove();
      renderPaged(host, rest, limit, drawItem);
    };
  }
}
