/**
 * A parsed `Recipe` as an interactive card: a portions stepper, the ingredient
 * list, and the method. Changing the portions re-resolves every token live.
 * Tokens that fail (parse error or an unresolvable/ambiguous condition) show
 * their base value with a ⚠ mark; all errors are also collected into a summary
 * strip. See `docs/recipe-tokens.md` §5.
 */

import { useState } from 'react';
import { resolve } from './token';
import type { Recipe as RecipeData, Step, TokenCell } from './parse';

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

/** A value with an optional trailing ⚠ mark; pushes any error to `errors`. */
function cellNode(res: CellResult, errors: string[]) {
  if (res.error) errors.push(res.error);
  return (
    <>
      {res.text}
      {res.error && (
        <span className="rb-token-error" aria-label={res.error} title={res.error}>
          {' ⚠'}
        </span>
      )}
    </>
  );
}

/** One method step (a plain function, so its errors are collected synchronously). */
function stepNode(key: number, step: Step, portions: number, anchor: number, errors: string[]) {
  return (
    <li key={key}>
      {step.parts.map((part, i) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <span key={i} className="rb-recipe-time">
            {cellNode(resolveCell(part.cell, portions, anchor), errors)}
          </span>
        ),
      )}
    </li>
  );
}

export function Recipe({ recipe }: { recipe: RecipeData }) {
  const [portions, setPortions] = useState(recipe.portions);
  const clamp = (n: number): number => Math.max(MIN_PORTIONS, Math.min(MAX_PORTIONS, n));
  const errors: string[] = [];

  return (
    <div className="rb-recipe">
      <div className="rb-recipe-header">
        <span className="rb-recipe-title">Recipe</span>
        <div className="rb-recipe-portions">
          <button className="rb-recipe-step" aria-label="fewer portions" disabled={portions <= MIN_PORTIONS} onClick={() => setPortions((p) => clamp(p - 1))}>
            −
          </button>
          <span className="rb-recipe-count">{portions}</span>
          <button className="rb-recipe-step" aria-label="more portions" disabled={portions >= MAX_PORTIONS} onClick={() => setPortions((p) => clamp(p + 1))}>
            +
          </button>
          <span className="rb-recipe-portions-label">portions</span>
        </div>
      </div>

      <div className="rb-recipe-body">
        {recipe.ingredients.length > 0 && (
          <>
            <div className="rb-recipe-label">Ingredients</div>
            <ul className="rb-recipe-ing">
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>
                  {ing.cell && (
                    <>
                      <span className="rb-recipe-amt">{cellNode(resolveCell(ing.cell, portions, recipe.portions), errors)}</span>{' '}
                    </>
                  )}
                  <span className="rb-recipe-name">{ing.name}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {recipe.steps.length > 0 && (
          <>
            <div className="rb-recipe-label">Method</div>
            <ol className="rb-recipe-steps">
              {recipe.steps.map((step, i) => stepNode(i, step, portions, recipe.portions, errors))}
            </ol>
          </>
        )}

        {/* Evaluated last, after the cells above have pushed their errors. */}
        {errorStrip(errors)}
      </div>
    </div>
  );
}

function errorStrip(errors: string[]) {
  if (errors.length === 0) return null;
  return (
    <div className="rb-recipe-errors">
      <span>⚠ </span>
      {errors.length === 1 ? errors[0] : `${errors.length} scaling issues — hover the ⚠ marks to see each.`}
    </div>
  );
}
