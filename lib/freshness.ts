import type { Freshness } from "./types";
import { MIN, formatNY, sessionOf } from "./time";

export const LIVE_MAX_LAG_SEC = 90;
export const DELAYED_MAX_LAG_SEC = 300;
export const PROVIDER_TIMEOUT_MS = 120_000;

export interface FreshnessInput {
  now: number;
  mode: "live" | "mock" | "replay";
  feed: string;
  latestBarT?: number; // start time of latest completed 1m bar
  lastProviderContact?: number;
  providerError?: string;
}

export interface FreshnessResult {
  status: Freshness;
  lagSec: number | null; // seconds between latest bar CLOSE and now
  message: string;
}

/**
 * Classify data freshness. Lag is measured from the latest 1m bar's close (start + 60s), so a bar that closed
 * 20 seconds ago reports 20s lag. Minute bars cannot be fresher than ~1 minute; we never claim sub-minute data.
 */
export function classifyFreshness(i: FreshnessInput): FreshnessResult {
  if (i.mode === "mock") {
    return { status: "mock", lagSec: null, message: "MOCK synthetic data for demo/testing — not real market prices." };
  }
  if (i.mode === "replay") {
    return { status: "historical", lagSec: null, message: "Historical replay — only bars closed before the replay time are used." };
  }
  if (i.latestBarT === undefined) {
    return { status: "no-data", lagSec: null, message: i.providerError ?? "No bars received from the provider yet." };
  }
  const lagSec = Math.round((i.now - (i.latestBarT + MIN)) / 1000);
  if (i.feed === "delayed_sip") {
    return { status: "delayed", lagSec, message: "Feed is Alpaca delayed SIP: data is ~15 minutes delayed by design." };
  }
  if (sessionOf(i.now) === "closed") {
    return {
      status: "closed",
      lagSec,
      message: `Market closed (outside 04:00–20:00 ET or weekend). Latest bar ${formatNY(i.latestBarT)}.`,
    };
  }
  if (i.providerError && (i.lastProviderContact === undefined || i.now - i.lastProviderContact > PROVIDER_TIMEOUT_MS)) {
    return { status: "stale", lagSec, message: `Provider error: ${i.providerError}` };
  }
  if (lagSec <= LIVE_MAX_LAG_SEC) return { status: "live", lagSec, message: `Latest 1m bar closed ${lagSec}s ago.` };
  if (lagSec <= DELAYED_MAX_LAG_SEC) {
    return { status: "delayed", lagSec, message: `Latest 1m bar closed ${lagSec}s ago (no IEX trades in the last minute(s), or feed lag).` };
  }
  return {
    status: "stale",
    lagSec,
    message: `No new bars for ${Math.round(lagSec / 60)} min — feed disconnected, no IEX trades, or a market holiday.`,
  };
}
