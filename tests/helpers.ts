import type { Bar } from "../lib/types";
import { MIN, nyToUtc } from "../lib/time";

export const T930 = nyToUtc("2026-10-14", "09:30"); // Wednesday, EDT

/** 1m bars starting at `start`, one per minute; `null` entries are skipped (missing minute). */
export function minuteBars(start: number, closes: (number | null)[], v = 100): Bar[] {
  const out: Bar[] = [];
  let prev = closes.find((c) => c !== null) ?? 100;
  closes.forEach((c, i) => {
    if (c === null) return;
    out.push({ t: start + i * MIN, o: prev, h: Math.max(prev, c) + 0.1, l: Math.min(prev, c) - 0.1, c, v });
    prev = c;
  });
  return out;
}

/** Candles with explicit mid prices: h = mid + 0.5, l = mid - 0.5, o = c = mid. */
export function midBars(start: number, mids: number[], minutes = 5): Bar[] {
  return mids.map((m, i) => ({ t: start + i * minutes * MIN, o: m, h: m + 0.5, l: m - 0.5, c: m, v: 1000 }));
}

export const UPTREND = [10, 11, 12, 11, 10, 11, 12, 13, 14, 13, 12, 13, 14, 15, 16, 15, 14, 15, 16];
export const DOWNTREND = UPTREND.map((x) => 30 - x);
export const RANGE = [10, 11, 12, 11, 10, 11, 12, 11, 10, 11, 12, 11, 10, 11, 12];
