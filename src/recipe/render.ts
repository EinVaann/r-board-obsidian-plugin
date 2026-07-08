/**
 * Render a parsed `Recipe` into `el`: a portions stepper, the ingredient list,
 * and the method. Changing the portions re-resolves every token live. Tokens
 * that fail (parse error or an unresolvable/ambiguous condition) show their
 * base value with a ⚠ mark; all errors are also collected into a summary strip.
 * See `docs/recipe-tokens.md` §5.
 */

import { resolve } from './token';
import type { Recipe, Step, TokenCell } from './parse';

const MIN_PORTIONS = 1;
const MAX_PORTIONS = 99;

/** Format a number for display: integers bare, otherwise up to 2 decimals. */
function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

interface CellResult {
  text: string;
  error: string | null;
}

/** Resolve a token cell at `portions`, returning display text and any error. */
function resolveCell(cell: TokenCell, portions: number, anchor: number): CellResult {
  if (cell.parseError) {
    const bare = cell.raw.replace(/^\{|\}$/g, '');
    return { text: bare, error: cell.parseError };
  }
  const r = resolve(cell.token!, portions, anchor);
  const text = r.unit ? `${formatNum(r.value)} ${r.unit}` : formatNum(r.value);
  return { text, error: r.error ? r.error.message : null };
}

/** Draw a value with an optional trailing ⚠ mark; push any error to `errors`. */
function drawCell(parent: HTMLElement, res: CellResult, errors: string[]): void {
  parent.appendText(res.text);
  if (res.error) {
    errors.push(res.error);
    parent.createSpan({ cls: 'rb-token-error', text: ' ⚠', attr: { 'aria-label': res.error, title: res.error } });
  }
}

export function renderRecipe(el: HTMLElement, recipe: Recipe): void {
  const root = el.createDiv({ cls: 'rb-recipe' });
  let portions = recipe.portions;

  // Header: a Recipe label and the portions stepper.
  const header = root.createDiv({ cls: 'rb-recipe-header' });
  header.createSpan({ cls: 'rb-recipe-title', text: 'Recipe' });
  const stepper = header.createDiv({ cls: 'rb-recipe-portions' });
  const dec = stepper.createEl('button', { cls: 'rb-recipe-step', text: '−', attr: { 'aria-label': 'fewer portions' } });
  const count = stepper.createSpan({ cls: 'rb-recipe-count' });
  const inc = stepper.createEl('button', { cls: 'rb-recipe-step', text: '+', attr: { 'aria-label': 'more portions' } });
  stepper.createSpan({ cls: 'rb-recipe-portions-label', text: 'portions' });

  const bodyEl = root.createDiv({ cls: 'rb-recipe-body' });

  const repaint = (): void => {
    count.setText(String(portions));
    dec.toggleAttribute('disabled', portions <= MIN_PORTIONS);
    inc.toggleAttribute('disabled', portions >= MAX_PORTIONS);
    bodyEl.empty();
    const errors: string[] = [];

    if (recipe.ingredients.length > 0) {
      bodyEl.createDiv({ cls: 'rb-recipe-label', text: 'Ingredients' });
      const list = bodyEl.createEl('ul', { cls: 'rb-recipe-ing' });
      for (const ing of recipe.ingredients) {
        const li = list.createEl('li');
        if (ing.cell) {
          const amt = li.createSpan({ cls: 'rb-recipe-amt' });
          drawCell(amt, resolveCell(ing.cell, portions, recipe.portions), errors);
          li.appendText(' ');
        }
        li.createSpan({ cls: 'rb-recipe-name', text: ing.name });
      }
    }

    if (recipe.steps.length > 0) {
      bodyEl.createDiv({ cls: 'rb-recipe-label', text: 'Method' });
      const ol = bodyEl.createEl('ol', { cls: 'rb-recipe-steps' });
      for (const step of recipe.steps) drawStep(ol.createEl('li'), step, portions, recipe.portions, errors);
    }

    if (errors.length > 0) {
      const strip = bodyEl.createDiv({ cls: 'rb-recipe-errors' });
      strip.createSpan({ text: '⚠ ' });
      strip.appendText(
        errors.length === 1 ? errors[0] : `${errors.length} scaling issues — hover the ⚠ marks to see each.`,
      );
    }
  };

  const clamp = (n: number): number => Math.max(MIN_PORTIONS, Math.min(MAX_PORTIONS, n));
  dec.onclick = () => {
    portions = clamp(portions - 1);
    repaint();
  };
  inc.onclick = () => {
    portions = clamp(portions + 1);
    repaint();
  };

  repaint();
}

function drawStep(li: HTMLElement, step: Step, portions: number, anchor: number, errors: string[]): void {
  for (const part of step.parts) {
    if (part.kind === 'text') li.appendText(part.text);
    else {
      const span = li.createSpan({ cls: 'rb-recipe-time' });
      drawCell(span, resolveCell(part.cell, portions, anchor), errors);
    }
  }
}
