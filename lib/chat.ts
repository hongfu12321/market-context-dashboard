import type { Bar } from "./types";
import { formatNY, MIN } from "./time";
import { TF_MINUTES } from "./types";
import type { Snapshot } from "./snapshot";

export const SYSTEM_PROMPT = `You are a price-action research assistant inside a market-structure dashboard. You help the user understand what the market has done and how its structure reads. You do not give trading signals, financial advice, or predictions.

Rules:
- Use ONLY the data in the <market_data> block of the latest user message. Never invent prices, volumes, levels, times, or probabilities. If something is not in the data, say it is not available.
- Structure answers as **Observations** (objective facts from the data, with numbers and ET times) followed by **Interpretation** (your reading, labelled as interpretation, with what would confirm or invalidate it).
- Swings, trend classification, BOS/CHoCH, breakouts and key levels are computed deterministically by the app. Use them. If the candles suggest a different reading, explain why with the candle data.
- When evidence is insufficient or mixed, say "Range / Unclear" rather than forcing a direction.
- Respect data quality: state it when data is MOCK, delayed, stale, a historical replay, or a proxy (SPY for SPX). IEX-feed volume and VWAP are not consolidated market statistics; never present them as such.
- For risk/reward questions (e.g. "is there room for 1.5R?"), use ATR and the distances to the nearest support/resistance from the data, show the arithmetic, and answer whether the price room exists — not whether to trade.
- In replay mode the analysis time is "now"; you know nothing after it.
- Be concise. Use ET times.`;

const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const candleRow = (c: Bar) => [formatNY(c.t, false), r2(c.o), r2(c.h), r2(c.l), r2(c.c), c.v];

/** Compact structured context for the model. `oneMinute` adds the last 30 1m candles when the main tf is higher. */
export function marketContext(s: Snapshot, oneMinute?: Snapshot) {
  const a = s.analysis;
  const m = TF_MINUTES[s.tf];
  return {
    symbol: s.symbol,
    data_symbol: s.sourceSymbol,
    proxy_note: s.proxyNote ?? null,
    mode: s.mode,
    analysis_time: { et: formatNY(s.asOf), utc: new Date(s.asOf).toISOString() },
    data_source: { provider: s.provider.name, feed: s.provider.feed, transport: s.provider.transport },
    freshness: s.freshness,
    warnings: s.warnings,
    timeframe: s.tf,
    latest_completed_candle:
      a.latestCandleT === null ? null : { start_et: formatNY(a.latestCandleT), end_et: formatNY(a.latestCandleT + m * MIN) },
    last_price: r2(a.lastPrice),
    atr14: r2(a.atr),
    trend: a.trend,
    recent_confirmed_swings: a.swings.slice(-8).map((x) => ({
      kind: x.kind,
      label: x.label,
      price: r2(x.price),
      time_et: formatNY(x.t, false),
      confirmed_at_et: formatNY(x.confirmedAt, false),
    })),
    recent_structure_events: a.structureEvents.slice(-6).map((e) => ({
      type: e.type,
      direction: e.direction,
      level: r2(e.level),
      close: r2(e.close),
      time_et: formatNY(e.t, false),
    })),
    recent_level_events: a.levelEvents.slice(-6).map((e) => ({
      type: e.type,
      level: e.level,
      price: r2(e.price),
      status: e.status,
      time_et: formatNY(e.t, false),
    })),
    session_levels: a.levels,
    key_levels: a.keyLevels.map((k) => ({ name: k.name, price: r2(k.price), distance: r2(k.distance), distance_atr: r2(k.distanceAtr) })),
    nearest_support: a.nearestSupport && { name: a.nearestSupport.name, price: r2(a.nearestSupport.price), distance_atr: r2(a.nearestSupport.distanceAtr) },
    nearest_resistance: a.nearestResistance && { name: a.nearestResistance.name, price: r2(a.nearestResistance.price), distance_atr: r2(a.nearestResistance.distanceAtr) },
    vwap_distance: a.vwapDistance,
    ema9: r2(a.ema9.at(-1)),
    ema20: r2(a.ema20.at(-1)),
    pullback: a.pullback,
    momentum_last_10: a.momentum,
    data_quality: { ...a.quality, gaps: a.quality.gaps.map((g) => `${g.missing} missing after ${formatNY(g.after, false)}`) },
    deterministic_observations: a.observations,
    deterministic_interpretation: a.interpretation,
    conditional_scenarios: a.scenarios,
    candle_columns: ["time_et", "open", "high", "low", "close", "volume"],
    candles: a.candles.slice(-40).map(candleRow),
    recent_1m_candles: oneMinute ? oneMinute.analysis.candles.slice(-30).map(candleRow) : undefined,
  };
}

/** Fallback answer when no AI key is configured: the deterministic engine's own summary. */
export function deterministicReply(snaps: Snapshot[]): string {
  const parts = snaps.map((s) => {
    const a = s.analysis;
    return [
      `${s.symbol}${s.proxyNote ? " (SPY proxy)" : ""} · ${s.tf} · as of ${formatNY(s.asOf)} · data: ${s.freshness.status}`,
      "",
      "**Observations**",
      ...a.observations.map((o) => `• ${o}`),
      "",
      "**Interpretation**",
      ...a.interpretation.map((o) => `• ${o}`),
      "",
      "**Conditional scenarios (not predictions)**",
      `• Bullish: ${a.scenarios.bullish}`,
      `• Bearish: ${a.scenarios.bearish}`,
      ...(s.warnings.length ? ["", "**Data notes**", ...s.warnings.map((w) => `• ${w}`)] : []),
    ].join("\n");
  });
  return `${parts.join("\n\n")}\n\n_Deterministic summary. Set ANTHROPIC_API_KEY to get AI answers to free-form questions._`;
}
