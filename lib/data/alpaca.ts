import WebSocket from "ws";
import type { Bar } from "../types";

export type AlpacaFeed = "iex" | "sip" | "delayed_sip";

export interface AlpacaConfig {
  keyId: string;
  secret: string;
  feed: AlpacaFeed;
}

export function alpacaConfig(): AlpacaConfig | null {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) return null;
  const f = (process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase();
  const feed: AlpacaFeed = f === "sip" || f === "delayed_sip" ? f : "iex";
  return { keyId, secret, feed };
}

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
}

const toBar = (b: RawBar): Bar => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw, n: b.n });

/** Historical 1m bars via REST (handles pagination). */
export async function fetchBars(cfg: AlpacaConfig, symbols: string[], start: number, end?: number): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  let pageToken: string | undefined;
  do {
    const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
    u.searchParams.set("symbols", symbols.join(","));
    u.searchParams.set("timeframe", "1Min");
    u.searchParams.set("start", new Date(start).toISOString());
    if (end !== undefined) u.searchParams.set("end", new Date(end).toISOString());
    u.searchParams.set("limit", "10000");
    u.searchParams.set("adjustment", "raw");
    // REST has no "delayed_sip" feed; the SIP request is bounded to >15 min old by the caller instead.
    u.searchParams.set("feed", cfg.feed === "delayed_sip" ? "sip" : cfg.feed);
    u.searchParams.set("sort", "asc");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const r = await fetch(u, {
      headers: { "APCA-API-KEY-ID": cfg.keyId, "APCA-API-SECRET-KEY": cfg.secret },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`Alpaca REST ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { bars?: Record<string, RawBar[]>; next_page_token?: string | null };
    for (const [s, arr] of Object.entries(j.bars ?? {})) (out[s] ??= []).push(...arr.map(toBar));
    pageToken = j.next_page_token ?? undefined;
  } while (pageToken);
  return out;
}

// Auth failure / insufficient subscription: retrying will not help.
const FATAL_CODES = new Set([401, 402, 409]);

/** Live minute-bar stream (bars + updatedBars) with exponential-backoff reconnect. */
export class AlpacaStream {
  authed = false;
  fatal = false;
  lastMessageAt = 0;
  error?: string;
  private retry = 0;
  private ws?: WebSocket;

  constructor(
    private cfg: AlpacaConfig,
    private symbols: string[],
    private onBars: (symbol: string, bars: Bar[]) => void,
    private onSubscribed: () => void,
  ) {}

  connect() {
    const ws = new WebSocket(`wss://stream.data.alpaca.markets/v2/${this.cfg.feed}`);
    this.ws = ws;
    ws.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      let msgs: Array<Record<string, unknown>>;
      try {
        msgs = JSON.parse(raw.toString());
      } catch {
        return;
      }
      for (const m of msgs) {
        if (m.T === "success" && m.msg === "connected") {
          ws.send(JSON.stringify({ action: "auth", key: this.cfg.keyId, secret: this.cfg.secret }));
        } else if (m.T === "success" && m.msg === "authenticated") {
          ws.send(JSON.stringify({ action: "subscribe", bars: this.symbols, updatedBars: this.symbols }));
        } else if (m.T === "subscription") {
          this.authed = true;
          this.retry = 0;
          this.error = undefined;
          this.onSubscribed();
        } else if (m.T === "error") {
          this.error = `stream error ${m.code}: ${m.msg}`;
          if (FATAL_CODES.has(Number(m.code))) this.fatal = true;
        } else if ((m.T === "b" || m.T === "u") && typeof m.S === "string") {
          this.onBars(m.S, [toBar(m as unknown as RawBar)]);
        }
      }
    });
    ws.on("error", (e) => {
      this.error = `stream: ${e.message}`;
    });
    ws.on("close", () => {
      this.authed = false;
      if (this.fatal) return;
      const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    });
  }
}
