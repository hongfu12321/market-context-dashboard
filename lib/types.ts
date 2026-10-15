export type Timeframe = "1m" | "5m" | "15m";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m"];
export const TF_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15 };

/** One OHLCV bar. `t` is the bar START time in epoch ms (UTC). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
}

/** Aggregated candle. `minutes` = how many 1m bars actually existed in the bucket (gaps are never filled). */
export interface AggBar extends Bar {
  minutes: number;
}

export type Freshness = "live" | "delayed" | "stale" | "closed" | "mock" | "historical" | "no-data";

/** Symbols shown in the UI. SPX is served from SPY as a clearly-labelled proxy (no index feed on Alpaca). */
export const UI_SYMBOLS = ["QQQ", "SPY", "NVDA", "META", "SPX"] as const;
export const SOURCE_SYMBOLS = ["QQQ", "SPY", "NVDA", "META"] as const;

export function resolveSymbol(symbol: string): { source: string; proxyNote?: string } {
  const s = symbol.toUpperCase();
  if (s === "SPX") {
    return {
      source: "SPY",
      proxyNote:
        "SPX index data is not available from Alpaca. Showing SPY (ETF) as a PROXY for SPX market structure. Prices are SPY prices (~1/10 of SPX), not SPX levels.",
    };
  }
  return { source: s };
}
