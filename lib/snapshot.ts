import { analyze, type Analysis } from "./analysis/analyze";
import { classifyFreshness, type FreshnessResult } from "./freshness";
import { getService, type ProviderInfo } from "./data/service";
import { resolveSymbol, type Timeframe } from "./types";

const DISPLAY_CANDLES = 400;
const LIVE_GRACE_MS = 90_000;

export interface Snapshot {
  symbol: string;
  sourceSymbol: string;
  proxyNote?: string;
  tf: Timeframe;
  mode: "live" | "mock" | "replay";
  asOf: number;
  generatedAt: number;
  provider: ProviderInfo;
  freshness: FreshnessResult;
  warnings: string[];
  analysis: Analysis; // candle arrays trimmed to the most recent DISPLAY_CANDLES
}

/** Everything the UI and the AI see for one symbol/timeframe at one moment (now, or a replay time). */
export async function buildSnapshot(symbol: string, tf: Timeframe, asOf?: number): Promise<Snapshot> {
  const svc = getService();
  await svc.ensureStarted();
  const { source, proxyNote } = resolveSymbol(symbol);
  const now = Date.now();
  const replay = asOf !== undefined;
  const at = replay ? Math.min(asOf, now) : now;
  const bars = replay ? await svc.historicalBars(source, at) : svc.liveBars(source, now);
  const a = analyze({ bars1m: bars, tf, asOf: at, graceMs: replay ? 0 : LIVE_GRACE_MS });
  const provider = svc.provider();
  const mode = replay ? "replay" : svc.isMock ? "mock" : "live";
  const freshness = classifyFreshness({
    now,
    mode,
    feed: provider.feed,
    latestBarT: a.latest1mT ?? undefined,
    lastProviderContact: provider.lastContact,
    providerError: provider.error,
  });

  const warnings: string[] = [];
  if (proxyNote) warnings.push(proxyNote);
  if (svc.isMock) warnings.push("MOCK DATA: synthetic prices generated locally for demo/testing. Add Alpaca keys for real market data.");
  if (provider.feed === "iex") {
    warnings.push("IEX feed: volume and VWAP reflect IEX trades only (a small share of US volume) — NOT consolidated market volume/VWAP.");
  }
  warnings.push(...a.quality.notes);

  const start = Math.max(0, a.candles.length - DISPLAY_CANDLES);
  const analysis: Analysis = {
    ...a,
    candles: a.candles.slice(start),
    ema9: a.ema9.slice(start),
    ema20: a.ema20.slice(start),
    vwap: a.vwap.slice(start),
  };
  return { symbol, sourceSymbol: source, proxyNote, tf, mode, asOf: at, generatedAt: now, provider, freshness, warnings, analysis };
}
