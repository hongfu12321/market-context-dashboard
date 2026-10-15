import { describe, expect, it } from "vitest";
import { aggregate, bucketStart } from "../lib/aggregate";
import { MIN, formatNY, nyToUtc } from "../lib/time";
import { T930, minuteBars } from "./helpers";

const closes15 = Array.from({ length: 15 }, (_, i) => 100 + i);

describe("1m → 5m / 15m aggregation", () => {
  it("builds correct OHLCV for completed buckets", () => {
    const bars = minuteBars(T930, closes15);
    const c5 = aggregate(bars, 5, T930 + 15 * MIN);
    expect(c5.map((c) => formatNY(c.t, false))).toEqual(["09:30 ET", "09:35 ET", "09:40 ET"]);
    const first = c5[0];
    const src = bars.slice(0, 5);
    expect(first.o).toBe(src[0].o);
    expect(first.c).toBe(src[4].c);
    expect(first.h).toBe(Math.max(...src.map((b) => b.h)));
    expect(first.l).toBe(Math.min(...src.map((b) => b.l)));
    expect(first.v).toBe(500);
    expect(first.minutes).toBe(5);

    const c15 = aggregate(bars, 15, T930 + 15 * MIN);
    expect(c15).toHaveLength(1);
    expect(c15[0].v).toBe(1500);
    expect(c15[0].c).toBe(114);
  });

  it("never emits a bucket that has not finished", () => {
    const bars = minuteBars(T930, closes15);
    expect(aggregate(bars, 5, T930 + 13 * MIN)).toHaveLength(2);
    expect(aggregate(bars, 15, T930 + 14 * MIN + 59_000)).toHaveLength(0);
  });

  it("does not fabricate missing candles", () => {
    const closes = [...closes15];
    closes[2] = null as unknown as number; // one missing minute
    for (let i = 5; i < 10; i++) closes[i] = null as unknown as number; // whole 09:35 bucket missing
    const c5 = aggregate(minuteBars(T930, closes), 5, T930 + 15 * MIN);
    expect(c5.map((c) => formatNY(c.t, false))).toEqual(["09:30 ET", "09:40 ET"]);
    expect(c5[0].minutes).toBe(4);
    expect(c5[0].v).toBe(400);
  });

  it("holds a bucket whose final minute is late, then releases it after the grace period", () => {
    const bars = minuteBars(T930, [1, 2, 3, 4, null]);
    expect(aggregate(bars, 5, T930 + 5 * MIN + 30_000, 90_000)).toHaveLength(0);
    const late = aggregate(bars, 5, T930 + 5 * MIN + 91_000, 90_000);
    expect(late).toHaveLength(1);
    expect(late[0].minutes).toBe(4);
  });

  it("aligns 5m/15m buckets to the ET clock in both EDT and EST", () => {
    for (const d of ["2026-10-14", "2026-01-14"]) {
      expect(formatNY(bucketStart(nyToUtc(d, "09:47"), 15))).toBe(`${d} 09:45 ET`);
      expect(formatNY(bucketStart(nyToUtc(d, "09:34"), 5))).toBe(`${d} 09:30 ET`);
    }
  });
});
