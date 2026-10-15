import type { AggBar, Bar, Timeframe } from "../types";
import { TF_MINUTES } from "../types";
import { MIN, formatNY, nyDate, sessionOf } from "../time";
import { aggregate } from "../aggregate";
import { findGaps, type Gap } from "../bars";
import { atr, ema, sessionVwap } from "./indicators";
import { findSwings } from "./swings";
import {
  TREND_LABEL,
  classifySequence,
  detectLevelBreaks,
  detectStructureBreaks,
  labelSwings,
  pullbackDepth,
  type LabeledSwing,
  type LevelEvent,
  type StructureEvent,
  type Trend,
} from "./structure";
import { sessionLevels, type SessionLevels } from "./levels";

export interface AnalysisInput {
  bars1m: Bar[];
  tf: Timeframe;
  asOf: number;
  /** Live feeds: how long to wait for a late final 1m bar before emitting a higher-timeframe candle. */
  graceMs?: number;
}

export interface KeyLevel {
  name: string;
  price: number;
  kind: "session" | "swing" | "vwap";
  distance: number; // level - last price
  distanceAtr: number | null;
}

export interface Analysis {
  tf: Timeframe;
  asOf: number;
  candles: AggBar[];
  ema9: (number | null)[];
  ema20: (number | null)[];
  vwap: (number | null)[];
  latest1mT: number | null;
  latestCandleT: number | null;
  lastPrice: number | null;
  atr: number | null;
  swings: LabeledSwing[];
  trend: { trend: Trend; label: string; reason: string };
  structureEvents: StructureEvent[];
  levelEvents: LevelEvent[];
  levels: SessionLevels;
  keyLevels: KeyLevel[];
  nearestSupport: KeyLevel | null;
  nearestResistance: KeyLevel | null;
  pullback: ReturnType<typeof pullbackDepth>;
  vwapDistance: { vwap: number; abs: number; pct: number; atr: number | null } | null;
  momentum: { candles: number; up: number; down: number; avgUpBody: number; avgDownBody: number; netChange: number } | null;
  quality: { bars1m: number; sessionBars1m: number; missingSession1m: number; gaps: Gap[]; partialCandles: number; notes: string[] };
  observations: string[];
  interpretation: string[];
  scenarios: { bullish: string; bearish: string };
}

const f = (x: number) => x.toFixed(2);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Deterministic price-action analysis as of `asOf`. The very first step drops every 1m bar that had not closed by
 * `asOf`, so nothing downstream can see the future — the same input truncated at `asOf` gives an identical result.
 */
export function analyze({ bars1m, tf, asOf, graceMs = 0 }: AnalysisInput): Analysis {
  const m = TF_MINUTES[tf];
  const one = bars1m.filter((b) => b.t + MIN <= asOf).sort((a, b) => a.t - b.t);
  const candles = aggregate(one, m, asOf, graceMs);
  const closes = candles.map((c) => c.c);
  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const atrNow = atr(candles, 14).at(-1) ?? null;

  const vw1 = sessionVwap(one);
  const vwByT = new Map<number, number | null>();
  one.forEach((b, i) => vwByT.set(b.t, vw1[i]));
  const vwap = candles.map((c) => {
    for (let t = c.t + (m - 1) * MIN; t >= c.t; t -= MIN) if (vwByT.has(t)) return vwByT.get(t)!;
    return null;
  });

  const levels = sessionLevels(one);
  const last = candles.at(-1);
  const lastPrice = last?.c ?? null;

  // --- structure ---
  const swings = labelSwings(findSwings(candles, m), (atrNow ?? 0) * 0.1);
  const seq = classifySequence(swings);
  const structureEvents = detectStructureBreaks(candles, swings, m);
  let { trend, reason } = seq;
  const lastEvt = structureEvents.at(-1);
  const lastConfirm = swings.at(-1)?.confirmedIndex ?? -1;
  if (
    lastEvt &&
    lastEvt.index > lastConfirm &&
    ((trend === "uptrend" && lastEvt.direction === "bearish") || (trend === "downtrend" && lastEvt.direction === "bullish"))
  ) {
    reason += ` However, a ${lastEvt.direction} ${lastEvt.type} at ${formatNY(lastEvt.t, false)} closed through the last swing ${
      lastEvt.direction === "bearish" ? "low" : "high"
    } (${f(lastEvt.level)}), so the trend is in question.`;
    trend = "range";
  } else if (lastEvt && lastEvt.index > lastConfirm && trend === "range") {
    reason += ` Since then a ${lastEvt.direction} ${lastEvt.type} at ${formatNY(lastEvt.t, false)} closed through ${f(lastEvt.level)}, but no new swing has been confirmed — the move is not yet confirmed by structure.`;
  }

  // --- level breakouts (regular-session candles of the current session only) ---
  const named: { name: string; price: number }[] = [];
  const addNamed = (name: string, price?: number) => price !== undefined && named.push({ name, price });
  addNamed("PDH", levels.pdh);
  addNamed("PDL", levels.pdl);
  addNamed("PMH", levels.pmh);
  addNamed("PML", levels.pml);
  const rthCandles = candles.filter((c) => sessionOf(c.t) === "rth" && nyDate(c.t) === levels.sessionDate);
  const levelEvents = detectLevelBreaks(rthCandles, named, m, 3);

  // --- key levels ---
  const raw: { name: string; price: number; kind: KeyLevel["kind"] }[] = [];
  const add = (name: string, price: number | undefined | null, kind: KeyLevel["kind"]) =>
    price !== undefined && price !== null && raw.push({ name, price, kind });
  add("Prev day high (PDH)", levels.pdh, "session");
  add("Prev day low (PDL)", levels.pdl, "session");
  add("Prev day close (PDC)", levels.pdc, "session");
  add("Premarket high (PMH)", levels.pmh, "session");
  add("Premarket low (PML)", levels.pml, "session");
  add("RTH open", levels.rthOpen, "session");
  add("Session high", levels.rthHigh, "session");
  add("Session low", levels.rthLow, "session");
  for (const s of swings.filter((s) => s.kind === "high").slice(-3)) add(`Swing high ${s.label} @${formatNY(s.t, false)}`, s.price, "swing");
  for (const s of swings.filter((s) => s.kind === "low").slice(-3)) add(`Swing low ${s.label} @${formatNY(s.t, false)}`, s.price, "swing");
  const vwapNow = vwap.at(-1) ?? null;
  add("Session VWAP", vwapNow, "vwap");
  const keyLevels: KeyLevel[] =
    lastPrice === null
      ? []
      : raw
          .map((k) => ({ ...k, distance: k.price - lastPrice, distanceAtr: atrNow ? (k.price - lastPrice) / atrNow : null }))
          .sort((a, b) => b.price - a.price);
  const above = lastPrice === null ? [] : keyLevels.filter((k) => k.price > lastPrice); // descending
  const below = lastPrice === null ? [] : keyLevels.filter((k) => k.price < lastPrice); // descending
  const nearestResistance = above.at(-1) ?? null;
  const nearestSupport = below[0] ?? null;

  const pullback = pullbackDepth(candles, swings, trend);
  const vwapDistance =
    vwapNow !== null && lastPrice !== null
      ? { vwap: vwapNow, abs: lastPrice - vwapNow, pct: ((lastPrice - vwapNow) / vwapNow) * 100, atr: atrNow ? (lastPrice - vwapNow) / atrNow : null }
      : null;

  const recent = candles.slice(-10);
  const ups = recent.filter((c) => c.c > c.o);
  const downs = recent.filter((c) => c.c < c.o);
  const momentum = recent.length
    ? {
        candles: recent.length,
        up: ups.length,
        down: downs.length,
        avgUpBody: avg(ups.map((c) => c.c - c.o)),
        avgDownBody: avg(downs.map((c) => c.o - c.c)),
        netChange: recent[recent.length - 1].c - recent[0].o,
      }
    : null;

  // --- data quality ---
  const sess1m = one.filter((b) => nyDate(b.t) === levels.sessionDate);
  const gaps = findGaps(sess1m);
  const missing = gaps.reduce((s, g) => s + g.missing, 0);
  const partialCandles = candles.filter((c) => c.minutes < m && nyDate(c.t) === levels.sessionDate).length;
  const notes: string[] = [];
  if (candles.length < 30) notes.push(`Only ${candles.length} completed ${tf} candles — structure reads are low-confidence.`);
  if (missing) notes.push(`${missing} 1m bars missing in the current session (minutes with no trades on this feed). Gaps are NOT filled.`);
  if (partialCandles && m > 1) notes.push(`${partialCandles} ${tf} candles in the current session were built from fewer than ${m} 1m bars.`);

  // --- narrative (deterministic) ---
  const obs: string[] = [];
  const interp: string[] = [];
  if (last) {
    obs.push(
      `Last completed ${tf} candle ${formatNY(last.t)}–${formatNY(last.t + m * MIN, false)}: O ${f(last.o)} H ${f(last.h)} L ${f(last.l)} C ${f(last.c)} V ${last.v.toLocaleString("en-US")}.`,
    );
  } else {
    obs.push("No completed candles available.");
  }
  if (levels.rthHigh !== undefined) obs.push(`Current session (RTH) range: ${f(levels.rthLow!)} – ${f(levels.rthHigh)}, open ${f(levels.rthOpen!)}.`);
  if (levels.pdh !== undefined) obs.push(`Previous session ${levels.prevDate}: high ${f(levels.pdh)}, low ${f(levels.pdl!)}, close ${f(levels.pdc!)}.`);
  if (levels.pmh !== undefined) obs.push(`Premarket: high ${f(levels.pmh)}, low ${f(levels.pml!)}.`);
  if (vwapDistance) {
    obs.push(
      `Price ${f(Math.abs(vwapDistance.abs))} (${f(Math.abs(vwapDistance.pct))}%${vwapDistance.atr !== null ? `, ${f(Math.abs(vwapDistance.atr))} ATR` : ""}) ${vwapDistance.abs >= 0 ? "above" : "below"} session VWAP ${f(vwapDistance.vwap)}.`,
    );
  }
  const e9 = ema9.at(-1);
  const e20 = ema20.at(-1);
  if (e9 != null && e20 != null && lastPrice !== null) {
    obs.push(`EMA9 ${f(e9)} is ${e9 >= e20 ? "above" : "below"} EMA20 ${f(e20)}; close is ${lastPrice > Math.max(e9, e20) ? "above both" : lastPrice < Math.min(e9, e20) ? "below both" : "between them"}.`);
  }
  if (atrNow !== null && lastPrice) obs.push(`ATR(14, ${tf}) = ${f(atrNow)} (${f((atrNow / lastPrice) * 100)}% of price).`);
  const hs = swings.filter((s) => s.kind === "high").slice(-2);
  const ls = swings.filter((s) => s.kind === "low").slice(-2);
  if (hs.length || ls.length) {
    obs.push(
      `Latest confirmed swings — highs: ${hs.map((s) => `${s.label} ${f(s.price)} @${formatNY(s.t, false)}`).join(", ") || "none"}; lows: ${ls.map((s) => `${s.label} ${f(s.price)} @${formatNY(s.t, false)}`).join(", ") || "none"}.`,
    );
  }
  if (lastEvt) obs.push(`Most recent structure event: ${lastEvt.direction} ${lastEvt.type} — close ${f(lastEvt.close)} through ${f(lastEvt.level)} at ${formatNY(lastEvt.t, false)}.`);
  const lastLvl = levelEvents.at(-1);
  if (lastLvl) obs.push(`Most recent level event: ${lastLvl.type} of ${lastLvl.level} ${f(lastLvl.price)} at ${formatNY(lastLvl.t, false)} — status ${lastLvl.status}.`);
  if (momentum) {
    obs.push(
      `Last ${momentum.candles} ${tf} candles: ${momentum.up} up / ${momentum.down} down; avg up body ${f(momentum.avgUpBody)} vs avg down body ${f(momentum.avgDownBody)}; net change ${momentum.netChange >= 0 ? "+" : ""}${f(momentum.netChange)}.`,
    );
  }
  if (pullback) obs.push(`Pullback: price has retraced ${f(pullback.retracePct)}% of the leg ${f(pullback.origin)} → ${f(pullback.extreme)}.`);

  interp.push(`Structure on ${tf}: ${TREND_LABEL[trend]}. ${reason}`);
  if (momentum) {
    const buyers = momentum.up > momentum.down && momentum.avgUpBody >= momentum.avgDownBody;
    const sellers = momentum.down > momentum.up && momentum.avgDownBody >= momentum.avgUpBody;
    interp.push(
      buyers
        ? "Recent candles lean toward buyers (more and larger up-candles)."
        : sellers
          ? "Recent candles lean toward sellers (more and larger down-candles)."
          : "Recent candles are mixed; neither side shows clearly stronger price action.",
    );
  }
  if (lastLvl?.status === "failed") interp.push(`The latest ${lastLvl.type} of ${lastLvl.level} was rejected (closed back through the level).`);
  if (lastLvl?.status === "accepted") interp.push(`The latest ${lastLvl.type} of ${lastLvl.level} was accepted (3 closes held beyond the level).`);

  const S = nearestSupport;
  const R = nearestResistance;
  const R2 = above.at(-2);
  const S2 = below[1];
  const scenarios = {
    bullish:
      S && R
        ? `If price holds above ${S.name} ${f(S.price)} and a ${tf} candle closes above ${R.name} ${f(R.price)}, the next reference above is ${R2 ? `${R2.name} ${f(R2.price)}` : "undefined (no higher level in data)"}. Invalidated by a ${tf} close below ${f(S.price)}.`
        : "Not enough levels on both sides of price to frame a bullish scenario.",
    bearish:
      S && R
        ? `If price stays below ${R.name} ${f(R.price)} and a ${tf} candle closes below ${S.name} ${f(S.price)}, the next reference below is ${S2 ? `${S2.name} ${f(S2.price)}` : "undefined (no lower level in data)"}. Invalidated by a ${tf} close above ${f(R.price)}.`
        : "Not enough levels on both sides of price to frame a bearish scenario.",
  };

  return {
    tf,
    asOf,
    candles,
    ema9,
    ema20,
    vwap,
    latest1mT: one.at(-1)?.t ?? null,
    latestCandleT: last?.t ?? null,
    lastPrice,
    atr: atrNow,
    swings,
    trend: { trend, label: TREND_LABEL[trend], reason },
    structureEvents,
    levelEvents,
    levels,
    keyLevels,
    nearestSupport,
    nearestResistance,
    pullback,
    vwapDistance,
    momentum,
    quality: { bars1m: one.length, sessionBars1m: sess1m.length, missingSession1m: missing, gaps: gaps.slice(-5), partialCandles, notes },
    observations: obs,
    interpretation: interp,
    scenarios,
  };
}
