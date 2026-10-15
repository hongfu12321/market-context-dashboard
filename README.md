# Market Context Dashboard

A research tool for inspecting intraday US equity price action (QQQ, SPY, NVDA, META, SPX via SPY proxy) on 1m / 5m / 15m
candles, with a deterministic price-action engine and an AI chat that is grounded in the actual structured data.
It is **not** a trading system: no orders, no signals, no predictions.

## Quick start

Requires Node.js 20+ (22 LTS recommended).

```bash
npm install
cp .env.example .env.local   # optional — the app runs on labelled MOCK data without keys
npm run dev                  # http://localhost:3000
npm test                     # vitest, no credentials needed
```

With no keys configured, everything works on deterministic **synthetic** data that is labelled `MOCK` in every view.

### Alpaca credentials

1. Sign up at <https://app.alpaca.markets> (a free Paper Trading account is enough; Market Data works with paper keys).
2. In the dashboard, open **API Keys** (right side of the Home page) → **Generate New Keys**.
3. Put them in `.env.local`:
   ```
   ALPACA_API_KEY_ID=PK...
   ALPACA_API_SECRET_KEY=...
   ALPACA_DATA_FEED=iex
   ```
4. Restart `npm run dev`. The header should show `Alpaca Market Data · feed iex · websocket` and a `LIVE` badge during market hours.

### Anthropic key (optional)

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-opus-5-5`). Without it the chat answers with
the deterministic summary. Server-side refusal fallback is enabled (`fallbacks: "default"`).

### Claude preview

`.claude/launch.json` defines a `dashboard` configuration (`npm run dev`, port 3000), so the Claude desktop app's
browser pane can start and open it directly.

## Market data limitations (read this)

- **IEX is not the whole market.** The free Alpaca plan streams real-time data from the IEX exchange only. Prices track
  the consolidated tape closely for liquid names, but **volume and VWAP are IEX-only** and much smaller than consolidated
  volume. The UI labels VWAP as "(IEX)" and shows a warning; the AI is instructed never to present them as market-wide.
- **Minute bars only.** Bars arrive just after each minute closes, so freshness is ~1 minute at best. The app reports lag
  measured from the latest bar's close and never claims sub-minute data. Status: `live` ≤ 90 s, `delayed` ≤ 5 min,
  otherwise `stale`; `closed` outside 04:00–20:00 ET / weekends.
- **Missing minutes are real.** If no IEX trade printed in a minute, no bar exists. Gaps are reported in the data
  quality notes and higher-timeframe candles record how many 1m bars they contain. Nothing is interpolated.
- **No silent delay.** `ALPACA_DATA_FEED=delayed_sip` gives consolidated data 15 minutes late and is always shown as
  `DELAYED`. Consolidated real-time (`sip`) needs a paid Alpaca subscription.
- **SPX.** Alpaca does not provide index data. "SPX" shows **SPY** data as a clearly labelled proxy (prices are SPY's).
- **Holidays.** Session detection is clock-based; on an exchange holiday the feed will show `stale` rather than `closed`.
- **Hosting.** The WebSocket and in-memory cache need a long-running Node process (`next dev`, `next start`, a VM or
  container). On serverless platforms the socket cannot persist; the service falls back to REST polling (every 15 s when
  the stream is unhealthy), but the in-memory cache will be per-instance and cold starts refetch history.

## Architecture

```
lib/
  types.ts, time.ts          Bar types; UTC storage, America/New_York display & session logic
  bars.ts, aggregate.ts      merge/dedupe/validate; gap detection; 1m → 5m/15m (completed buckets only)
  freshness.ts               live / delayed / stale / closed / mock / historical classification
  data/alpaca.ts             REST bars (paginated) + WebSocket bars/updatedBars with backoff reconnect
  data/mock.ts               deterministic synthetic sessions (04:00–20:00 ET, with deliberate gaps)
  data/service.ts            singleton in-memory cache (6-day rolling window), stream + polling fallback, replay fetch
  analysis/                  indicators (EMA, ATR, session VWAP), fractal swings, structure, levels, analyze()
  snapshot.ts                one object the UI and the AI both consume
  chat.ts                    system prompt, structured context builder, deterministic fallback reply
app/api/market               GET  ?symbol=QQQ&tf=5m[&asOf=ISO]
app/api/chat                 POST {symbol, tf, asOf?, messages}
components/                  Dashboard, PriceChart (Lightweight Charts v5), AnalysisPanel, ChatPanel
```

### Analysis rules (no look-ahead)

- `analyze()` first drops every 1m bar that had not **closed** by `asOf`. A test asserts that analysis with future bars
  present (or tampered) is identical to analysis on truncated data.
- Swings are 2-left / 2-right fractals and only exist once both right-hand candles have closed (`confirmedAt`).
- Trend: latest confirmed swing high & low are HH+HL → Uptrend, LH+LL → Downtrend, else **Range / Unclear**
  (also when fewer than 2 highs and 2 lows are confirmed, or when a later opposite BOS/CHoCH broke the structure).
- BOS / CHoCH: a candle close through the most recent swing confirmed *before* that candle; CHoCH when it flips bias.
- Breakouts of PDH/PDL/PMH/PML on regular-session candles: `accepted` after 3 closes beyond the level, `failed` if a
  close returns through it, otherwise `pending`.
- Live mode holds a 5m/15m candle for up to 90 s if its final 1m bar has not arrived yet; replay has no grace.

### Replay

Pick a date and ET time and press **Start replay**; step forward/back one candle. The server fetches history, filters to
bars closed before the replay time, and runs the same `analyze()` — so the chart, levels, events and the AI context
contain nothing from after that moment.

### Reusing for backtesting

`analyze({ bars1m, tf, asOf })` is a pure function of 1m bars and a timestamp, and `fetchBars()` returns plain
`Bar[]`. A separate backtest can loop `asOf` across history and record the returned features without any of the web code.

## Tests

`npm test` covers aggregation (OHLCV, incomplete buckets, missing minutes, grace period, ET alignment in EDT/EST),
timestamp conversion across DST, dedupe/corrections/gaps, swing confirmation timing, trend classification, BOS/CHoCH,
breakout acceptance/failure, look-ahead invariance on every timeframe, and freshness classification.
