/**
 * A small dense two-phase simplex: minimize `c·x` subject to `A·x = b`, `x ≥ 0`.
 * Factory problems have tens of variables, so a plain tableau with Bland's rule
 * (no cycling) is plenty.
 */

export type LpResult = { status: 'optimal'; x: number[]; value: number } | { status: 'infeasible' } | { status: 'unbounded' };

const EPS = 1e-9;
const MAX_PIVOTS = 20000;

export function minimize(c: number[], A: number[][], b: number[]): LpResult {
  const m = A.length;
  const n = c.length;
  const rhs = n + m;
  // Rows with b ≥ 0, one artificial variable per row (columns n..n+m-1).
  const T: number[][] = A.map((row, i) => {
    const sign = b[i] < 0 ? -1 : 1;
    const r = new Array<number>(rhs + 1).fill(0);
    for (let j = 0; j < n; j++) r[j] = sign * (row[j] ?? 0);
    r[n + i] = 1;
    r[rhs] = sign * b[i];
    return r;
  });
  const basis = Array.from({ length: m }, (_, i) => n + i);

  // Phase 1: minimize the sum of the artificials. The last row holds reduced costs; its RHS is -objective.
  const z = new Array<number>(rhs + 1).fill(0);
  for (const r of T) {
    for (let j = 0; j < n; j++) z[j] -= r[j];
    z[rhs] -= r[rhs];
  }
  T.push(z);
  if (run(T, basis, n + m) === 'stuck') return { status: 'infeasible' };
  const scale = Math.max(1, ...b.map(Math.abs));
  if (-T[m][rhs] > 1e-7 * scale) return { status: 'infeasible' };

  // Drive artificials out of the basis; a row with no usable column is redundant and stays put.
  for (let i = 0; i < m; i++) {
    if (basis[i] < n) continue;
    let j = 0;
    while (j < n && Math.abs(T[i][j]) <= EPS) j++;
    if (j < n) pivot(T, basis, i, j);
  }

  // Phase 2: the real objective; artificials may no longer enter.
  const z2 = new Array<number>(rhs + 1).fill(0);
  for (let j = 0; j < n; j++) z2[j] = c[j];
  for (let i = 0; i < m; i++) {
    const cb = basis[i] < n ? c[basis[i]] : 0;
    if (cb) for (let k = 0; k <= rhs; k++) z2[k] -= cb * T[i][k];
  }
  T[m] = z2;
  const res = run(T, basis, n);
  if (res === 'unbounded') return { status: 'unbounded' };
  if (res === 'stuck') return { status: 'infeasible' };

  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i][rhs] > EPS ? T[i][rhs] : 0;
  return { status: 'optimal', x, value: x.reduce((s, v, j) => s + v * c[j], 0) };
}

/** Pivot until optimal. Only columns below `enter` may enter the basis. */
function run(T: number[][], basis: number[], enter: number): 'optimal' | 'unbounded' | 'stuck' {
  const m = basis.length;
  const rhs = T[0]?.length ? T[0].length - 1 : 0;
  for (let it = 0; it < MAX_PIVOTS; it++) {
    // Bland's rule: the lowest-index improving column, the lowest-index basic variable on ties.
    let j = -1;
    for (let k = 0; k < enter; k++) {
      if (T[m][k] < -EPS) {
        j = k;
        break;
      }
    }
    if (j < 0) return 'optimal';
    let row = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][j] <= EPS) continue;
      const ratio = T[i][rhs] / T[i][j];
      if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[row])) {
        best = ratio;
        row = i;
      }
    }
    if (row < 0) return 'unbounded';
    pivot(T, basis, row, j);
  }
  return 'stuck';
}

function pivot(T: number[][], basis: number[], row: number, col: number): void {
  const pr = T[row];
  const p = pr[col];
  for (let k = 0; k < pr.length; k++) pr[k] /= p;
  for (let i = 0; i < T.length; i++) {
    if (i === row) continue;
    const f = T[i][col];
    if (f === 0) continue;
    const r = T[i];
    for (let k = 0; k < r.length; k++) r[k] -= f * pr[k];
  }
  basis[row] = col;
}
