import { describe, expect, it } from "vitest";

import { add, clone, dot, eye, inv, matVec, scale, transpose } from "./matrix";

describe("eye", () => {
  it("builds an identity matrix of the requested size", () => {
    const I = eye(3);
    expect(I).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});

describe("transpose / matVec / dot / scale / add", () => {
  it("transposes correctly", () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("matVec is consistent with hand calculation", () => {
    const A = [
      [1, 2],
      [3, 4],
    ];
    expect(matVec(A, [5, 6])).toEqual([1 * 5 + 2 * 6, 3 * 5 + 4 * 6]);
  });

  it("dot is symmetric and matches Σ a_i·b_i", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(1 * 4 + 2 * 5 + 3 * 6);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(dot([4, 5, 6], [1, 2, 3]));
  });

  it("scale and add behave like plain arithmetic", () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(add([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
  });
});

describe("clone", () => {
  it("returns a deep copy — mutating output leaves input unchanged", () => {
    const A = [
      [1, 2],
      [3, 4],
    ];
    const B = clone(A);
    B[0][0] = 99;
    expect(A[0][0]).toBe(1);
  });
});

describe("inv — round-trip identity", () => {
  it("A · A⁻¹ ≈ I for a 2×2 well-conditioned matrix", () => {
    const A = [
      [4, 3],
      [6, 3],
    ];
    const Ai = inv(A);
    // Hand-computed inverse: det = 12 - 18 = -6
    // [d -b; -c a] / det = [3 -3; -6 4] / -6 = [-0.5 0.5; 1 -0.6667]
    expect(Ai[0][0]).toBeCloseTo(-0.5, 6);
    expect(Ai[0][1]).toBeCloseTo(0.5, 6);
    expect(Ai[1][0]).toBeCloseTo(1, 6);
    expect(Ai[1][1]).toBeCloseTo(-2 / 3, 6);
  });

  it("A · A⁻¹ ≈ I for a 4×4 symmetric positive-definite matrix", () => {
    const A = [
      [4, 1, 0, 0],
      [1, 4, 1, 0],
      [0, 1, 4, 1],
      [0, 0, 1, 4],
    ];
    const Ai = inv(A);
    // Verify A · A⁻¹ ≈ I element-wise
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += A[i][k] * Ai[k][j];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
  });

  it("partial pivoting handles a zero on the diagonal", () => {
    // Without partial pivoting, this would divide by zero.
    const A = [
      [0, 1],
      [1, 0],
    ];
    const Ai = inv(A);
    expect(Ai[0][0]).toBeCloseTo(0, 10);
    expect(Ai[0][1]).toBeCloseTo(1, 10);
    expect(Ai[1][0]).toBeCloseTo(1, 10);
    expect(Ai[1][1]).toBeCloseTo(0, 10);
  });

  it("throws on a singular matrix", () => {
    // Rank-1 matrix: rows are linearly dependent
    const A = [
      [1, 2],
      [2, 4],
    ];
    expect(() => inv(A)).toThrow(/singular/i);
  });

  it("does not mutate the input matrix", () => {
    const A = [
      [4, 3],
      [6, 3],
    ];
    const before = JSON.stringify(A);
    inv(A);
    expect(JSON.stringify(A)).toBe(before);
  });
});
