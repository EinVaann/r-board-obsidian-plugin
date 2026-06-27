import type { BoardItem } from '../types';
import { renderField } from '../render/fields';
import {
  bodyProperties,
  cardSizeClass,
  coverProperty,
  createTitleLink,
  renderSectionHeader,
  type RenderContext,
} from '../render/common';
import { renderPaged } from '../render/paginate';
import { renderNoteExcerpt } from '../render/content';
import { groupItems } from '../data/group';

/**
 * Gallery of cards (masonry or fixed grid). Each card shows the cover image,
 * the title as an internal link, the remaining visible properties, and
 * optionally an excerpt of the note body. Clicking the card opens the note
 * (clicking the cover opens it fullscreen). When the view sets `group`, items
 * are split into labelled sections.
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
    for (const group of groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig)) {
      const section = host.createDiv({ cls: 'rb-section' });
      const color = group.key != null ? ctx.view.groupConfig?.[group.key]?.color : undefined;
      const collapsed = renderSectionHeader(ctx, section, group.label, group.items.length, color);
      if (!collapsed) renderGrid(section, group.items, ctx, `g:${group.label}`);
    }
    return;
  }

  renderGrid(host, items, ctx, 'g');
}

function renderGrid(parent: HTMLElement, items: BoardItem[], ctx: RenderContext, pageKey: string): void {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);
  const layout = ctx.view.layout ?? 'masonry';
  const grid = parent.createDiv({
    cls: `rb-gallery rb-gallery-${layout} ${cardSizeClass(ctx.view)}`,
  });

  renderPaged(grid, items, ctx.view.limit ?? 50, (item, host) => {
    const card = host.createDiv({ cls: 'rb-card rb-gallery-card' });

    if (cover) renderField(ctx, card, item, cover);

    const body = card.createDiv({ cls: 'rb-card-body' });
    createTitleLink(ctx, body, item);
    for (const prop of fields) {
      const row = body.createDiv({ cls: 'rb-field' });
      if (!renderField(ctx, row, item, prop)) row.remove();
    }
    if (ctx.view.showContent) {
      const content = body.createDiv({ cls: 'rb-card-content' });
      void renderNoteExcerpt(ctx.app, content, item.file, ctx.component);
    }
  }, { key: pageKey, store: ctx.ui.pages });
}
