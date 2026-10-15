import type { AggBar, Bar } from "./types";
import { MIN } from "./time";

/**
 * Bucket start for an N-minute candle. Floors on UTC epoch; because New York's UTC offset is a whole
 * number of hours, 5m/15m buckets line up with the ET clock (09:30, 09:35, 09:45 ...).
 */
export const bucketStart = (t: number, minutes: number) => Math.floor(t / (minutes * MIN)) * minutes * MIN;

/**
 * Aggregate 1m bars into COMPLETED N-minute candles as of `asOf`.
 * - Only 1m bars that had closed by `asOf` are used.
 * - A bucket is emitted only once its end time <= asOf.
 * - If the bucket's final 1m bar has not arrived, the bucket is held back for `graceMs` (live feeds publish a
 *   minute bar a few seconds after the minute closes). After the grace period it is emitted with what exists.
 * - Empty buckets are never emitted and missing minutes are never fabricated; `minutes` records how many 1m bars
 *   the candle actually contains.
 */
export function aggregate(bars1m: Bar[], minutes: number, asOf: number, graceMs = 0): AggBar[] {
  const ms = minutes * MIN;
  const groups = new Map<number, Bar[]>();
  for (const b of bars1m) {
    if (b.t + MIN > asOf) continue;
    const k = bucketStart(b.t, minutes);
    const g = groups.get(k);
    if (g) g.push(b);
    else groups.set(k, [b]);
  }
  const out: AggBar[] = [];
  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const end = k + ms;
    if (end > asOf) continue;
    const g = groups.get(k)!.sort((a, b) => a.t - b.t);
    const last = g[g.length - 1];
    if (last.t !== end - MIN && asOf < end + graceMs) continue;
    let h = -Infinity, l = Infinity, v = 0, n = 0, pv = 0, vwOk = true;
    for (const b of g) {
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
      v += b.v;
      n += b.n ?? 0;
      if (b.vw === undefined) vwOk = false;
      else pv += b.vw * b.v;
    }
    out.push({
      t: k,
      o: g[0].o,
      h,
      l,
      c: last.c,
      v,
      n,
      vw: vwOk && v > 0 ? pv / v : undefined,
      minutes: g.length,
    });
  }
  return out;
}
