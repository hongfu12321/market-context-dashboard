import type { Bar } from "../types";
import { MIN } from "../time";
import type { Swing } from "./swings";

export type Trend = "uptrend" | "downtrend" | "range";
export const TREND_LABEL: Record<Trend, string> = { uptrend: "Uptrend", downtrend: "Downtrend", range: "Range / Unclear" };

export type SwingLabel = "HH" | "LH" | "EH" | "HL" | "LL" | "EL" | "first";
export interface LabeledSwing extends Swing {
  label: SwingLabel;
}

/** Label each swing against the previous swing of the same kind. Differences within `tol` count as equal. */
export function labelSwings(swings: Swing[], tol: number): LabeledSwing[] {
  let lastH: Swing | undefined;
  let lastL: Swing | undefined;
  return swings.map((s) => {
    let label: SwingLabel;
    if (s.kind === "high") {
      label = !lastH ? "first" : s.price > lastH.price + tol ? "HH" : s.price < lastH.price - tol ? "LH" : "EH";
      lastH = s;
    } else {
      label = !lastL ? "first" : s.price > lastL.price + tol ? "HL" : s.price < lastL.price - tol ? "LL" : "EL";
      lastL = s;
    }
    return { ...s, label };
  });
}

/** Trend from the latest confirmed swing high and low. Anything other than HH+HL or LH+LL is Range / Unclear. */
export function classifySequence(swings: LabeledSwing[]): { trend: Trend; reason: string } {
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  if (highs.length < 2 || lows.length < 2) {
    return { trend: "range", reason: "Insufficient confirmed swings (need at least 2 swing highs and 2 swing lows)." };
  }
  const h = highs[highs.length - 1].label;
  const l = lows[lows.length - 1].label;
  if (h === "HH" && l === "HL") return { trend: "uptrend", reason: "Latest confirmed swings: higher high and higher low." };
  if (h === "LH" && l === "LL") return { trend: "downtrend", reason: "Latest confirmed swings: lower high and lower low." };
  return { trend: "range", reason: `Mixed swing sequence: latest high is ${h}, latest low is ${l}.` };
}

export interface StructureEvent {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  index: number; // candle that closed through the level
  barT: number;
  t: number; // close time of that candle (when the event became known)
  level: number;
  swingT: number;
  close: number;
}

/**
 * Walk candles forward. At candle j only swings confirmed BEFORE j are known. A close beyond the most recent
 * unbroken swing is a Break of Structure if it agrees with the current bias, or a Change of Character if it flips it.
 */
export function detectStructureBreaks(bars: Bar[], swings: Swing[], tfMinutes: number): StructureEvent[] {
  const sorted = [...swings].sort((a, b) => a.confirmedIndex - b.confirmedIndex || a.index - b.index);
  const events: StructureEvent[] = [];
  let bias: "bullish" | "bearish" | null = null;
  let p = 0;
  let sh: Swing | undefined;
  let sl: Swing | undefined;
  let shBroken = false;
  let slBroken = false;
  for (let j = 0; j < bars.length; j++) {
    while (p < sorted.length && sorted[p].confirmedIndex < j) {
      const s = sorted[p++];
      if (s.kind === "high") {
        sh = s;
        shBroken = false;
      } else {
        sl = s;
        slBroken = false;
      }
    }
    const b = bars[j];
    const mk = (dir: "bullish" | "bearish", s: Swing): StructureEvent => ({
      type: bias !== null && bias !== dir ? "CHoCH" : "BOS",
      direction: dir,
      index: j,
      barT: b.t,
      t: b.t + tfMinutes * MIN,
      level: s.price,
      swingT: s.t,
      close: b.c,
    });
    if (sh && !shBroken && b.c > sh.price) {
      events.push(mk("bullish", sh));
      shBroken = true;
      bias = "bullish";
    } else if (sl && !slBroken && b.c < sl.price) {
      events.push(mk("bearish", sl));
      slBroken = true;
      bias = "bearish";
    }
  }
  return events;
}

export interface LevelEvent {
  type: "breakout" | "breakdown";
  level: string;
  price: number;
  barT: number;
  t: number; // close time of the breaking candle
  status: "pending" | "accepted" | "failed";
  resolvedAt?: number;
}

/**
 * Close-based breakouts of named levels. A breakout is "accepted" after `confirmBars` further closes stay beyond the
 * level, "failed" if any of those closes back through it, and "pending" while fewer than `confirmBars` have closed.
 */
export function detectLevelBreaks(
  bars: Bar[],
  levels: { name: string; price: number }[],
  tfMinutes: number,
  confirmBars = 3,
): LevelEvent[] {
  const out: LevelEvent[] = [];
  const close = (i: number) => bars[i].t + tfMinutes * MIN;
  for (const { name, price } of levels) {
    for (let j = 1; j < bars.length; j++) {
      const prev = bars[j - 1].c;
      const c = bars[j].c;
      const up = prev <= price && c > price;
      const down = prev >= price && c < price;
      if (!up && !down) continue;
      let status: LevelEvent["status"] = "pending";
      let resolvedAt: number | undefined;
      const follow = bars.slice(j + 1, j + 1 + confirmBars);
      const failIdx = follow.findIndex((f) => (up ? f.c < price : f.c > price));
      if (failIdx >= 0) {
        status = "failed";
        resolvedAt = close(j + 1 + failIdx);
      } else if (follow.length === confirmBars) {
        status = "accepted";
        resolvedAt = close(j + confirmBars);
      }
      out.push({ type: up ? "breakout" : "breakdown", level: name, price, barT: bars[j].t, t: close(j), status, resolvedAt });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** How far price has retraced the latest leg of the trend (0% = at the extreme, 100% = back at the swing origin). */
export function pullbackDepth(bars: Bar[], swings: Swing[], trend: Trend) {
  if (trend === "range" || bars.length === 0) return null;
  const last = bars[bars.length - 1].c;
  if (trend === "uptrend") {
    const low = [...swings].reverse().find((s) => s.kind === "low");
    if (!low) return null;
    const extreme = Math.max(...bars.slice(low.index).map((b) => b.h));
    const leg = extreme - low.price;
    return leg > 0 ? { origin: low.price, extreme, retracePct: ((extreme - last) / leg) * 100 } : null;
  }
  const high = [...swings].reverse().find((s) => s.kind === "high");
  if (!high) return null;
  const extreme = Math.min(...bars.slice(high.index).map((b) => b.l));
  const leg = high.price - extreme;
  return leg > 0 ? { origin: high.price, extreme, retracePct: ((last - extreme) / leg) * 100 } : null;
}
