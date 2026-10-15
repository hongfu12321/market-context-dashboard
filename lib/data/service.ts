import type { Bar } from "../types";
import { SOURCE_SYMBOLS } from "../types";
import { MIN, addDays, nyDate, nyToUtc, sessionOf } from "../time";
import { mergeBars } from "../bars";
import { mockBars } from "./mock";
import { AlpacaStream, alpacaConfig, fetchBars, type AlpacaConfig } from "./alpaca";

const DAY = 24 * 60 * MIN;
const HISTORY_MS = 6 * DAY; // rolling window: covers the previous session across weekends + a holiday
const POLL_MS = 15_000;
const STREAM_SILENCE_MS = 120_000;
const DELAY_MS = 15 * MIN;

export interface ProviderInfo {
  name: string;
  feed: string;
  transport: "websocket" | "rest-polling" | "mock";
  lastContact?: number;
  error?: string;
  duplicates: number;
}

/**
 * In-memory market data cache. Requires a long-lived Node process (next dev / next start / a VM / container).
 * On serverless hosts the WebSocket cannot persist; the REST polling path still works per-request.
 */
class MarketDataService {
  readonly cfg: AlpacaConfig | null = alpacaConfig();
  private bars = new Map<string, Bar[]>();
  private duplicates = 0;
  private stream?: AlpacaStream;
  private started?: Promise<void>;
  private lastContact?: number;
  private lastError?: string;
  private hist = new Map<string, { fetchedAt: number; bars: Bar[] }>();

  get isMock() {
    return this.cfg === null;
  }

  ensureStarted(): Promise<void> {
    return (this.started ??= this.start());
  }

  private async start() {
    if (!this.cfg) return;
    await this.poll(true).catch((e) => (this.lastError = String(e)));
    this.stream = new AlpacaStream(
      this.cfg,
      [...SOURCE_SYMBOLS],
      (s, b) => this.ingest(s, b),
      () => void this.poll().catch((e) => (this.lastError = String(e))), // gap-fill after (re)connect
    );
    this.stream.connect();
    setInterval(() => {
      if (!this.streamHealthy()) void this.poll().catch((e) => (this.lastError = String(e)));
    }, POLL_MS).unref?.();
  }

  private streamHealthy(): boolean {
    const s = this.stream;
    if (!s?.authed) return false;
    if (sessionOf(Date.now()) === "closed") return true;
    return Date.now() - s.lastMessageAt < STREAM_SILENCE_MS;
  }

  private ingest(symbol: string, incoming: Bar[]) {
    const merged = mergeBars(this.bars.get(symbol) ?? [], incoming);
    const cutoff = Date.now() - HISTORY_MS;
    this.bars.set(symbol, merged.bars.filter((b) => b.t >= cutoff));
    this.duplicates += merged.duplicates;
    this.lastContact = Date.now();
  }

  /** REST fetch of recent bars: full history on start, otherwise from a few minutes before the oldest latest bar. */
  private async poll(initial = false) {
    const cfg = this.cfg!;
    const now = Date.now();
    let start = now - HISTORY_MS;
    if (!initial) {
      const latest = SOURCE_SYMBOLS.map((s) => this.bars.get(s)?.at(-1)?.t).filter((t): t is number => t !== undefined);
      if (latest.length === SOURCE_SYMBOLS.length) start = Math.min(...latest) - 5 * MIN;
    }
    const end = cfg.feed === "delayed_sip" ? now - DELAY_MS : undefined;
    const res = await fetchBars(cfg, [...SOURCE_SYMBOLS], start, end);
    for (const [s, b] of Object.entries(res)) this.ingest(s, b);
    this.lastContact = now;
    this.lastError = undefined;
  }

  liveBars(symbol: string, now: number): Bar[] {
    if (!this.cfg) return mockBars(symbol, now - HISTORY_MS, now);
    return this.bars.get(symbol) ?? [];
  }

  /** Bars for replay: everything from ~5 days before asOf, filtered so that only bars CLOSED by asOf are returned. */
  async historicalBars(symbol: string, asOf: number): Promise<Bar[]> {
    const date = nyDate(asOf);
    const from = nyToUtc(addDays(date, -5), "00:00");
    let bars: Bar[];
    if (!this.cfg) {
      bars = mockBars(symbol, from, asOf);
    } else {
      const now = Date.now();
      const key = `${symbol}:${date}`;
      const hit = this.hist.get(key);
      const isToday = date === nyDate(now);
      if (hit && (!isToday || now - hit.fetchedAt < 60_000)) {
        bars = hit.bars;
      } else {
        const ceiling = now - (this.cfg.feed === "delayed_sip" ? DELAY_MS : 0);
        const end = Math.min(nyToUtc(addDays(date, 1), "00:00"), ceiling);
        bars = (await fetchBars(this.cfg, [symbol], from, end))[symbol] ?? [];
        bars = mergeBars([], bars).bars;
        this.hist.set(key, { fetchedAt: now, bars });
      }
    }
    return bars.filter((b) => b.t + MIN <= asOf);
  }

  provider(): ProviderInfo {
    if (!this.cfg) return { name: "MOCK (synthetic)", feed: "mock", transport: "mock", duplicates: 0 };
    return {
      name: "Alpaca Market Data",
      feed: this.cfg.feed,
      transport: this.streamHealthy() ? "websocket" : "rest-polling",
      lastContact: this.lastContact,
      error: this.lastError ?? this.stream?.error,
      duplicates: this.duplicates,
    };
  }
}

const g = globalThis as unknown as { __marketData?: MarketDataService };
export function getService(): MarketDataService {
  return (g.__marketData ??= new MarketDataService());
}
