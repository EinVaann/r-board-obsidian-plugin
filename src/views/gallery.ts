import type { BoardItem } from '../types';
import { renderField } from '../render/fields';
import { bodyProperties, coverProperty, createTitleLink, type RenderContext } from '../render/common';
import { renderPaged } from '../render/paginate';
import { groupItems } from '../data/group';

/**
 * Masonry gallery (CSS column-count). Each card shows the cover image, the
 * title as an internal link, and the remaining visible properties. When the
 * view sets `group`, items are split into labelled sections. Cards are not
 * draggable.
 */
export function renderGallery(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: 'rb-empty', text: 'No notes match this view.' });
    return;
  }

  const groupProp = ctx.view.group
    ? ctx.properties.find((p) => p.name === ctx.view.group)
    : undefined;

  if (groupProp) {
    for (const group of groupItems(items, groupProp, ctx.view.columns)) {
      const section = host.createDiv({ cls: 'rb-section' });
      const header = section.createDiv({ cls: 'rb-section-header' });
      header.createSpan({ cls: 'rb-section-title', text: group.label });
      header.createSpan({ cls: 'rb-section-count', text: String(group.items.length) });
      renderGrid(section, group.items, ctx);
    }
    return;
  }

  renderGrid(host, items, ctx);
}

function renderGrid(parent: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);
  const grid = parent.createDiv({ cls: 'rb-gallery' });

  renderPaged(grid, items, ctx.view.limit ?? 50, (item, host) => {
    const card = host.createDiv({ cls: 'rb-card rb-gallery-card' });
    if (cover) renderField(ctx.app, card, item, cover);

    const body = card.createDiv({ cls: 'rb-card-body' });
    createTitleLink(ctx.app, body, item);
    for (const prop of fields) {
      const row = body.createDiv({ cls: 'rb-field' });
      if (!renderField(ctx.app, row, item, prop)) row.remove();
    }
  });
}
