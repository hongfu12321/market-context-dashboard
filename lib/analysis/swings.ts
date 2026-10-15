import type { Bar } from "../types";
import { MIN } from "../time";

export interface Swing {
  kind: "high" | "low";
  index: number; // candle index of the pivot
  t: number; // pivot candle start
  price: number;
  confirmedIndex: number; // candle whose close confirmed the pivot
  confirmedAt: number; // close time of that candle — the earliest moment this swing was knowable
}

/**
 * Fractal pivots: a swing high needs `left` candles with strictly lower highs before it and `right` candles with
 * highs not above it after it. Pivots are only returned once all `right` candles exist, i.e. after they CLOSED —
 * callers must pass completed candles only. No look-ahead: the most recent `right` candles can never be pivots.
 */
export function findSwings(bars: Bar[], tfMinutes: number, left = 2, right = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < bars.length - right; i++) {
    const b = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j < i; j++) {
      if (bars[j].h >= b.h) isHigh = false;
      if (bars[j].l <= b.l) isLow = false;
    }
    for (let j = i + 1; j <= i + right; j++) {
      if (bars[j].h > b.h) isHigh = false;
      if (bars[j].l < b.l) isLow = false;
    }
    const ci = i + right;
    const confirmedAt = bars[ci].t + tfMinutes * MIN;
    if (isHigh) out.push({ kind: "high", index: i, t: b.t, price: b.h, confirmedIndex: ci, confirmedAt });
    if (isLow) out.push({ kind: "low", index: i, t: b.t, price: b.l, confirmedIndex: ci, confirmedAt });
  }
  return out;
}
