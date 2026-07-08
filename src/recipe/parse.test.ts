import { describe, expect, it } from 'vitest';
import { parseRecipe } from './parse';

const SAMPLE = `
portions: 2
ingredients:
  - 200 g spaghetti
  - 2 egg yolks
  - {0.5 tsp:sqrt} black pepper
  - salt to taste
steps:
  - Boil the pasta for {9 min:const} in salted water.
  - Toss and serve.
`;

describe('parseRecipe', () => {
  const r = parseRecipe(SAMPLE);

  it('reads the base portions', () => {
    expect(r.portions).toBe(2);
  });

  it('parses a bare ingredient: number is the token, unit stays in the name', () => {
    const ing = r.ingredients[0];
    expect(ing.cell?.token?.entries[0].value).toBe(200);
    expect(ing.name).toBe('g spaghetti');
  });

  it('parses a countable ingredient with no unit', () => {
    expect(r.ingredients[1].cell?.token?.entries[0].value).toBe(2);
    expect(r.ingredients[1].name).toBe('egg yolks');
  });

  it('parses a braced ingredient token and its trailing name', () => {
    const ing = r.ingredients[2];
    expect(ing.cell?.token?.entries[0].unit).toBe('tsp');
    expect(ing.cell?.token?.entries[0].mode).toEqual({ kind: 'pow', k: 0.5 });
    expect(ing.name).toBe('black pepper');
  });

  it('keeps a static line (no leading number) as name only', () => {
    expect(r.ingredients[3].cell).toBeNull();
    expect(r.ingredients[3].name).toBe('salt to taste');
  });

  it('splits a step into text and token parts', () => {
    const parts = r.steps[0].parts;
    expect(parts.map((p) => p.kind)).toEqual(['text', 'token', 'text']);
  });

  it('defaults a step time to const (times do not scale)', () => {
    const tokenPart = r.steps[0].parts.find((p) => p.kind === 'token');
    // @ts-expect-error narrowed by the find above
    expect(tokenPart.cell.token.entries[0].mode).toEqual({ kind: 'const' });
  });

  it('handles a step with no tokens', () => {
    expect(r.steps[1].parts).toEqual([{ kind: 'text', text: 'Toss and serve.' }]);
  });
});
