/**
 * Tiny matrix utilities for the client-side Markowitz solver.
 *
 * Inverts via Gauss-Jordan with partial pivoting. For N ≤ ~100 (our universe
 * is ~50 tickers) this is fast and stable enough; no external dep.
 */

export type Matrix = number[][];
export type Vector = number[];

export function eye(n: number): Matrix {
  const m: Matrix = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

export function clone(m: Matrix): Matrix {
  return m.map((r) => r.slice());
}

export function transpose(m: Matrix): Matrix {
  const r = m.length;
  const c = m[0].length;
  const out: Matrix = [];
  for (let i = 0; i < c; i++) {
    const row = new Array(r);
    for (let j = 0; j < r; j++) row[j] = m[j][i];
    out.push(row);
  }
  return out;
}

export function matVec(m: Matrix, v: Vector): Vector {
  const r = m.length;
  const c = m[0].length;
  const out = new Array(r).fill(0);
  for (let i = 0; i < r; i++) {
    let s = 0;
    for (let j = 0; j < c; j++) s += m[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function scale(v: Vector, k: number): Vector {
  return v.map((x) => x * k);
}

export function add(a: Vector, b: Vector): Vector {
  return a.map((x, i) => x + b[i]);
}

/**
 * Invert a square matrix via Gauss-Jordan with partial pivoting.
 * Throws if singular.
 */
export function inv(m: Matrix): Matrix {
  const n = m.length;
  const a = clone(m);
  const I = eye(n);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find largest |a[row][col]| at or below `col`
    let pivotRow = col;
    let pivotVal = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = r;
      }
    }
    if (pivotVal < 1e-12) {
      throw new Error("Matriz singular — não é possível inverter (verifique covariância).");
    }
    if (pivotRow !== col) {
      [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
      [I[col], I[pivotRow]] = [I[pivotRow], I[col]];
    }
    // Scale pivot row to 1
    const pivot = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] /= pivot;
      I[col][j] /= pivot;
    }
    // Eliminate other rows
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r][j] -= factor * a[col][j];
        I[r][j] -= factor * I[col][j];
      }
    }
  }
  return I;
}
