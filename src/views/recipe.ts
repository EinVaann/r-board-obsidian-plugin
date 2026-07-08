import type { App, TFile } from 'obsidian';
import type { BoardItem } from '../types';
import { renderField } from '../render/fields';
import {
  bodyProperties,
  coverProperty,
  createTitleLink,
  renderSectionHeader,
  type RenderContext,
} from '../render/common';
import { renderPaged } from '../render/paginate';
import { groupItems } from '../data/group';
import { extractRecipeBlock, parseRecipe } from '../recipe/parse';
import { renderRecipe } from '../recipe/render';

/**
 * Recipe view: one card per note, showing the note's title, its visible
 * properties, and its full interactive recipe block (portions stepper and all).
 * Unlike gallery/kanban cards, the card is not click-to-open — only the title
 * link opens the note — so the stepper stays usable. When the view sets
 * `group`, cards are split into labelled sections.
 */
export function renderRecipeView(host: HTMLElement, items: BoardItem[], ctx: RenderContext): void {
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
      if (!collapsed) renderList(section, group.items, ctx, `r:${group.label}`);
    }
    return;
  }

  renderList(host, items, ctx, 'r');
}

function renderList(parent: HTMLElement, items: BoardItem[], ctx: RenderContext, pageKey: string): void {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);
  const list = parent.createDiv({ cls: 'rb-recipe-view' });

  renderPaged(list, items, ctx.view.limit ?? 50, (item, host) => {
    const card = host.createDiv({ cls: 'rb-card rb-recipe-card' });

    if (cover) renderField(ctx, card, item, cover);

    const body = card.createDiv({ cls: 'rb-card-body' });
    createTitleLink(ctx, body, item);
    for (const prop of fields) {
      const row = body.createDiv({ cls: 'rb-field' });
      if (!renderField(ctx, row, item, prop)) row.remove();
    }

    void mountRecipe(ctx.app, body.createDiv({ cls: 'rb-recipe-mount' }), item.file);
  }, { key: pageKey, store: ctx.ui.pages });
}

/** Read a note, render its first recipe block in full, or note its absence. */
async function mountRecipe(app: App, el: HTMLElement, file: TFile): Promise<void> {
  try {
    const raw = await app.vault.cachedRead(file);
    const src = extractRecipeBlock(raw);
    if (!src) {
      el.createDiv({ cls: 'rb-recipe-none', text: 'No recipe block in this note.' });
      return;
    }
    renderRecipe(el, parseRecipe(src));
  } catch {
    /* ignore unreadable notes */
  }
}
