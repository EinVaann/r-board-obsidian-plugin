import { describe, expect, it } from 'vitest';
import { type Mode, parseToken, resolve, type Token } from './token';

const LINEAR: Mode = { kind: 'linear' };
const CONST: Mode = { kind: 'const' };

/** Parse helper that fails the test on a hard parse error. */
function parse(src: string, def: Mode = LINEAR): Token {
  const t = parseToken(src, def);
  if ('error' in t) throw new Error(`parse failed: ${t.error}`);
  return t;
}

/** Resolve at `p` with base anchor 2, returning the (rounded) value. */
function val(src: string, p: number, def: Mode = LINEAR, anchor = 2): number {
  const r = resolve(parse(src, def), p, anchor);
  return Math.round(r.value * 1000) / 1000;
}

describe('parseToken', () => {
  it('parses a bare value with unit', () => {
    const t = parse('200 g');
    expect(t.entries[0]).toMatchObject({ value: 200, unit: 'g', mode: LINEAR, point: null });
  });

  it('is whitespace tolerant (9min == 9 min)', () => {
    expect(parse('9min').entries[0].value).toBe(9);
    expect(parse('9 min').entries[0].unit).toBe('min');
  });

  it('parses modes including sqrt and pow=k', () => {
    expect(parse('{6:sqrt}').entries[0].mode).toEqual({ kind: 'pow', k: 0.5 });
    expect(parse('{6:pow=0.3}').entries[0].mode).toEqual({ kind: 'pow', k: 0.3 });
  });

  it('parses all point forms', () => {
    expect(parse('{5:2p}').entries[0].point).toEqual({ rel: 'eq', n: 2 });
    expect(parse('{5:>3p}').entries[0].point).toEqual({ rel: 'gt', n: 3 });
    expect(parse('{5:>=3p}').entries[0].point).toEqual({ rel: 'gte', n: 3 });
    expect(parse('{5:<=4p}').entries[0].point).toEqual({ rel: 'lte', n: 4 });
    expect(parse('{5:2-4p}').entries[0].point).toEqual({ rel: 'range', lo: 2, hi: 4 });
  });

  it('parses round and bound tags', () => {
    expect(parse('{2:int}').entries[0].round).toEqual({ kind: 'int' });
    expect(parse('{2:round=0.25}').entries[0].round).toEqual({ kind: 'nearest', step: 0.25 });
    expect(parse('{2:min=1}').entries[0].min).toBe(1);
  });

  it('defaults mode to the section default', () => {
    expect(parse('9 min', CONST).entries[0].mode).toEqual(CONST);
  });

  it('errors on non-numeric value and unbalanced braces', () => {
    expect(parseToken('{oops}', LINEAR)).toHaveProperty('error');
    expect(parseToken('{200g', LINEAR)).toHaveProperty('error');
  });
});

describe('resolve — spec §4.3 value table (base 2 portions)', () => {
  it('const never changes', () => {
    expect(val('{9 min:const}', 1)).toBe(9);
    expect(val('{9 min:const}', 4)).toBe(9);
  });

  it('linear scales 1:1', () => {
    expect(val('{9 min:linear}', 1)).toBe(4.5);
    expect(val('{9 min:linear}', 2)).toBe(9);
    expect(val('{9 min:linear}', 4)).toBe(18);
    expect(val('{9 min:linear}', 6)).toBe(27);
  });

  it('sqrt scales sub-linearly', () => {
    expect(val('{6 min:sqrt}', 2)).toBe(6);
    expect(val('{6 min:sqrt}', 4)).toBeCloseTo(8.485, 2);
    expect(val('{6 min:sqrt}', 1)).toBeCloseTo(4.243, 2);
  });

  it('anchors to a single point', () => {
    expect(val('{200g:2p}', 1)).toBe(100);
    expect(val('{200g:2p}', 4)).toBe(400);
    expect(val('{200g:2p}', 6)).toBe(600);
  });

  it('rounds eggs to whole numbers', () => {
    expect(val('{2:linear:int}', 1)).toBe(1);
    expect(val('{2:linear:int}', 4)).toBe(4);
    expect(val('{2:linear:int}', 3)).toBe(3);
  });

  it('piecewise plateau (ramp then hold)', () => {
    const t = '{9:1p, 18:2p, 27:>=3p}';
    expect(val(t, 1)).toBe(9);
    expect(val(t, 2)).toBe(18);
    expect(val(t, 4)).toBe(27);
    expect(val(t, 6)).toBe(27);
  });

  it('step thresholds pick the matching segment, no interpolation', () => {
    const t = '{1 pan:<=4p, 2 pans:>4p:step}';
    expect(val(t, 2)).toBe(1);
    expect(val(t, 4)).toBe(1);
    expect(val(t, 6)).toBe(2);
  });
});

describe('resolve — specificity: formula + override', () => {
  it('an exact point overrides the linear formula only at that portion', () => {
    const t = '{200g:linear, 250g:4p}';
    expect(val(t, 1)).toBe(100);
    expect(val(t, 2)).toBe(200);
    expect(val(t, 3)).toBe(300);
    expect(val(t, 4)).toBe(250); // exact (rank 1) beats formula (rank 4)
    expect(val(t, 5)).toBe(500);
  });

  it('does not flag a clean specificity win as an error', () => {
    const r = resolve(parse('{200g:linear, 250g:4p}'), 4, 2);
    expect(r.error).toBeUndefined();
  });
});

describe('resolve — gaps (interpolation)', () => {
  it('interpolates between defined points', () => {
    expect(val('{9:1p, 27:3p}', 2)).toBe(18);
  });

  it('holds the edge below the first point', () => {
    expect(val('{9:1p, 27:3p}', 0.5)).toBe(9);
  });
});

describe('resolve — §5.1 errors fall back to base value + mark', () => {
  it('overlapping same-rank condition', () => {
    const r = resolve(parse('{200g:<=4p, 300g:>=4p}'), 4, 2);
    expect(r.error).toBeDefined();
    expect(r.value).toBe(200); // base value (first entry, unscaled)
    expect(r.error?.message).toMatch(/overlapping/);
  });

  it('contradictory tags (two modes) → last wins but flagged', () => {
    const r = resolve(parse('{9 min:linear:const}'), 4, 2);
    expect(r.error).toBeDefined();
    expect(r.value).toBe(9);
  });

  it('min exceeds max → both ignored, flagged', () => {
    const r = resolve(parse('{5:min=5:max=3}'), 2, 2);
    expect(r.error).toBeDefined();
  });

  it('unresolvable missing (no neighbour to interpolate)', () => {
    const r = resolve(parse('{200g:>=5p}'), 2, 2);
    expect(r.error).toBeDefined();
    expect(r.value).toBe(200);
    expect(r.error?.message).toMatch(/no rule matches/);
  });
});
