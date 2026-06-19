import type { BoardItem } from '../types';
import { renderField } from '../render/fields';
import { bodyFields, coverField, createTitleLink, type RenderContext } from '../render/common';
import { renderPaged } from '../render/paginate';

/**
 * Masonry gallery (CSS column-count). Each card shows the cover image, the
 * title as an internal link, and the remaining configured fields. Cards are
 * not draggable.
 */
export function renderGallery(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'No notes match this board.' });
    return;
  }

  const cover = coverField(ctx.config);
  const fields = bodyFields(ctx.config);
  const grid = host.createDiv({ cls: 'rb-gallery' });

  renderPaged(grid, items, (item, parent) => {
    const card = parent.createDiv({ cls: 'rb-card rb-gallery-card' });

    if (cover) renderField(ctx.app, card, item, cover);

    const bodyEl = card.createDiv({ cls: 'rb-card-body' });
    createTitleLink(ctx.app, bodyEl, item);

    for (const field of fields) {
      const row = bodyEl.createDiv({ cls: 'rb-field' });
      const drew = renderField(ctx.app, row, item, field);
      if (!drew) row.remove();
    }
  });
}
