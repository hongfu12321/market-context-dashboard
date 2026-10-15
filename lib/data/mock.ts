import type { Bar } from "../types";
import { MIN, addDays, nyDate, nyToUtc } from "../time";

// Deterministic SYNTHETIC data so the app and tests run without credentials. Always labelled MOCK in the UI.
const BASE: Record<string, number> = { QQQ: 600, SPY: 670, NVDA: 185, META: 720 };

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
const cache = new Map<string, Bar[]>();

/** Synthetic 1m bars for one New York weekday, 04:00–20:00 ET. Some extended-hours minutes are left empty on purpose. */
export function mockSessionBars(symbol: string, date: string): Bar[] {
  const key = `${symbol}:${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(hash(key));
  let price = (BASE[symbol] ?? 100) * (1 + (r() - 0.5) * 0.04);
  const start = nyToUtc(date, "04:00");
  const out: Bar[] = [];
  let drift = 0;
  for (let i = 0; i < 960; i++) {
    const rth = i >= 330 && i < 720;
    if (i % 40 === 0) drift = (r() - 0.5) * 0.0004;
    if (!rth && r() < 0.06) continue; // no trades this minute → no bar
    const vol = rth ? 0.0009 : 0.0003;
    const o = price;
    const c = o * (1 + drift + (r() - 0.5) * 2 * vol);
    const h = Math.max(o, c) * (1 + r() * vol * 0.6);
    const l = Math.min(o, c) * (1 - r() * vol * 0.6);
    const vBase = rth ? 20000 * (1 + 2 * ((i - 525) / 195) ** 2) : 1500;
    const v = Math.round(vBase * (0.5 + r()));
    out.push({ t: start + i * MIN, o: round(o), h: round(h), l: round(l), c: round(c), v, vw: round((h + l + c) / 3), n: Math.round(v / 50) });
    price = c;
  }
  cache.set(key, out);
  return out;
}

/** Completed synthetic 1m bars with start >= from and close <= to (weekdays only). */
export function mockBars(symbol: string, from: number, to: number): Bar[] {
  const out: Bar[] = [];
  const last = nyDate(to);
  for (let d = nyDate(from); d <= last; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (const b of mockSessionBars(symbol, d)) if (b.t >= from && b.t + MIN <= to) out.push(b);
  }
  return out;
}
