import type { Bar } from "./types";
import { MIN, nyDate } from "./time";

export function isValidBar(b: Bar): boolean {
  return (
    [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite) &&
    b.t % MIN === 0 &&
    b.h >= Math.max(b.o, b.c, b.l) &&
    b.l <= Math.min(b.o, b.c)
  );
}

/**
 * Merge incoming bars into an existing series keyed by start time.
 * A bar with an existing timestamp replaces the old one (Alpaca "updatedBars" corrections) and counts as a duplicate.
 */
export function mergeBars(existing: Bar[], incoming: Bar[]) {
  const map = new Map(existing.map((b) => [b.t, b]));
  let duplicates = 0;
  let rejected = 0;
  for (const b of incoming) {
    if (!isValidBar(b)) {
      rejected++;
      continue;
    }
    if (map.has(b.t)) duplicates++;
    map.set(b.t, b);
  }
  return { bars: [...map.values()].sort((a, b) => a.t - b.t), duplicates, rejected };
}

export interface Gap {
  after: number; // start of last bar before the gap
  before: number; // start of first bar after the gap
  missing: number; // number of absent 1m bars
}

/** Missing 1m bars between consecutive bars on the same New York date. Gaps are reported, never filled. */
export function findGaps(bars: Bar[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].t - bars[i - 1].t;
    if (diff > MIN && nyDate(bars[i].t) === nyDate(bars[i - 1].t)) {
      gaps.push({ after: bars[i - 1].t, before: bars[i].t, missing: diff / MIN - 1 });
    }
  }
  return gaps;
}
