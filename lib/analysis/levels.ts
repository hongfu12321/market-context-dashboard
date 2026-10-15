import type { Bar } from "../types";
import { nyDate, sessionOf } from "../time";

export interface SessionLevels {
  sessionDate?: string; // NY date of the latest bar
  prevDate?: string;
  pdh?: number;
  pdl?: number;
  pdc?: number;
  pmh?: number;
  pml?: number;
  rthOpen?: number;
  rthHigh?: number;
  rthLow?: number;
}

/** Previous regular session high/low/close, current premarket high/low, and current RTH range so far. */
export function sessionLevels(bars1m: Bar[]): SessionLevels {
  if (bars1m.length === 0) return {};
  const tagged = bars1m.map((b) => ({ b, date: nyDate(b.t), phase: sessionOf(b.t) }));
  const sessionDate = tagged[tagged.length - 1].date;
  const out: SessionLevels = { sessionDate };

  const prevDate = [...new Set(tagged.filter((x) => x.date < sessionDate && x.phase === "rth").map((x) => x.date))].sort().pop();
  if (prevDate) {
    const rth = tagged.filter((x) => x.date === prevDate && x.phase === "rth").map((x) => x.b);
    out.prevDate = prevDate;
    out.pdh = Math.max(...rth.map((b) => b.h));
    out.pdl = Math.min(...rth.map((b) => b.l));
    out.pdc = rth[rth.length - 1].c;
  }
  const pre = tagged.filter((x) => x.date === sessionDate && x.phase === "pre").map((x) => x.b);
  if (pre.length) {
    out.pmh = Math.max(...pre.map((b) => b.h));
    out.pml = Math.min(...pre.map((b) => b.l));
  }
  const rth = tagged.filter((x) => x.date === sessionDate && x.phase === "rth").map((x) => x.b);
  if (rth.length) {
    out.rthOpen = rth[0].o;
    out.rthHigh = Math.max(...rth.map((b) => b.h));
    out.rthLow = Math.min(...rth.map((b) => b.l));
  }
  return out;
}
