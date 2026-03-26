import { describe, it, expect } from "vitest";
import { centralDiff, movingAverage1d, sgDeriv5, smartDeriv } from "./derivatives";

describe("centralDiff", () => {
  it("returns empty for empty input", () => {
    expect(centralDiff([], 1)).toEqual([]);
  });

  it("returns [0] for single element", () => {
    expect(centralDiff([5], 1)).toEqual([0]);
  });

  it("computes correct derivatives for a linear signal", () => {
    // f(t) = 2t  =>  f'(t) = 2 everywhere
    const signal = [0, 2, 4, 6, 8];
    const dt = 1;
    const result = centralDiff(signal, dt);
    for (const v of result) {
      expect(v).toBeCloseTo(2, 10);
    }
  });

  it("uses forward/backward at edges, central in interior", () => {
    const signal = [0, 1, 4, 9, 16]; // t^2 at 0,1,2,3,4
    const dt = 1;
    const result = centralDiff(signal, dt);
    // Forward at 0: (1-0)/1 = 1
    expect(result[0]).toBeCloseTo(1);
    // Central at 1: (4-0)/2 = 2
    expect(result[1]).toBeCloseTo(2);
    // Central at 2: (9-1)/2 = 4
    expect(result[2]).toBeCloseTo(4);
    // Central at 3: (16-4)/2 = 6
    expect(result[3]).toBeCloseTo(6);
    // Backward at 4: (16-9)/1 = 7
    expect(result[4]).toBeCloseTo(7);
  });
});

describe("sgDeriv5", () => {
  it("falls back to centralDiff for short signals", () => {
    const signal = [0, 1, 4];
    expect(sgDeriv5(signal, 1)).toEqual(centralDiff(signal, 1));
  });

  it("produces finite results for a quadratic", () => {
    const signal = Array.from({ length: 10 }, (_, i) => i * i);
    const result = sgDeriv5(signal, 1);
    expect(result).toHaveLength(10);
    for (const v of result) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("is exact for linear functions", () => {
    const signal = Array.from({ length: 10 }, (_, i) => 3 * i + 1);
    const result = sgDeriv5(signal, 0.5);
    // derivative of 3t+1 w.r.t. index is 3, but dt=0.5 so f'=3/0.5=6
    for (const v of result) {
      expect(v).toBeCloseTo(6, 5);
    }
  });
});

describe("movingAverage1d", () => {
  it("returns empty for empty input", () => {
    expect(movingAverage1d([], 2)).toEqual([]);
  });

  it("with halfWidth 1 smooths a spike", () => {
    const s = [0, 0, 10, 0, 0];
    const m = movingAverage1d(s, 1);
    expect(m[2]).toBeCloseTo(10 / 3, 5);
  });

  it("ignores NaN in window", () => {
    const s = [1, NaN, 3];
    const m = movingAverage1d(s, 1);
    expect(m[1]).toBeCloseTo(2, 5);
  });
});

describe("smartDeriv", () => {
  it("uses sgDeriv5 for long signals", () => {
    const signal = Array.from({ length: 10 }, (_, i) => i);
    expect(smartDeriv(signal, 1)).toEqual(sgDeriv5(signal, 1));
  });

  it("uses centralDiff for short signals", () => {
    const signal = [1, 2, 3];
    expect(smartDeriv(signal, 1)).toEqual(centralDiff(signal, 1));
  });
});
