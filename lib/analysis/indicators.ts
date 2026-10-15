import type { Bar } from "../types";
import { nyDate, sessionOf } from "../time";

/** EMA seeded with the SMA of the first `period` values; null until then. Each value uses only past data. */
export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let sum = 0;
  return values.map((v, i) => {
    if (i < period - 1) {
      sum += v;
      return null;
    }
    if (prev === null) {
      prev = (sum + v) / period;
      return prev;
    }
    prev = v * k + prev * (1 - k);
    return prev;
  });
}

/** Wilder ATR. */
export function atr(bars: Bar[], period = 14): (number | null)[] {
  let prev: number | null = null;
  let sum = 0;
  return bars.map((b, i) => {
    const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
    if (i < period - 1) {
      sum += tr;
      return null;
    }
    if (prev === null) {
      prev = (sum + tr) / period;
      return prev;
    }
    prev = (prev * (period - 1) + tr) / period;
    return prev;
  });
}

/**
 * Regular-session VWAP per 1m bar, reset each New York date at 09:30. Null outside RTH.
 * Uses the bar's own vw when available, else typical price. With the IEX feed this is an IEX-only VWAP.
 */
export function sessionVwap(bars1m: Bar[]): (number | null)[] {
  let date = "";
  let pv = 0;
  let vol = 0;
  return bars1m.map((b) => {
    if (sessionOf(b.t) !== "rth") return null;
    const d = nyDate(b.t);
    if (d !== date) {
      date = d;
      pv = 0;
      vol = 0;
    }
    pv += (b.vw ?? (b.h + b.l + b.c) / 3) * b.v;
    vol += b.v;
    return vol > 0 ? pv / vol : null;
  });
}
