"use client";

import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { TF_MINUTES, TIMEFRAMES, UI_SYMBOLS, type Timeframe } from "@/lib/types";
import { MIN, addDays, formatNY, nyDate, nyToUtc } from "@/lib/time";
import PriceChart, { type ChartToggles } from "./PriceChart";
import AnalysisPanel from "./AnalysisPanel";
import ChatPanel from "./ChatPanel";

const STATUS_STYLE: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  delayed: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  stale: "bg-red-500/15 text-red-300 ring-red-500/40",
  "no-data": "bg-red-500/15 text-red-300 ring-red-500/40",
  closed: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/40",
  mock: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/40",
  historical: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
};

function prevWeekday(): string {
  let d = addDays(nyDate(Date.now()), -1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${o === value ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [symbol, setSymbol] = useState<string>("QQQ");
  const [tf, setTf] = useState<Timeframe>("5m");
  const [show, setShow] = useState<ChartToggles>({ vwap: true, ema: true, levels: true, swings: true });
  const [replay, setReplay] = useState(false);
  const [rDate, setRDate] = useState("");
  const [rTime, setRTime] = useState("10:30");
  const [asOf, setAsOf] = useState<number | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setRDate(prevWeekday()), []);

  const load = useCallback(async () => {
    if (replay && asOf === null) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ symbol, tf });
      if (replay && asOf !== null) q.set("asOf", new Date(asOf).toISOString());
      const r = await fetch(`/api/market?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setSnap(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, tf, replay, asOf]);

  useEffect(() => {
    void load();
    if (replay) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load, replay]);

  const startReplay = () => {
    if (!rDate || !rTime) return;
    setAsOf(nyToUtc(rDate, rTime));
    setReplay(true);
  };
  const step = (dir: 1 | -1) => setAsOf((a) => (a === null ? a : Math.min(Date.now(), a + dir * TF_MINUTES[tf] * MIN)));

  const a = snap?.analysis;
  const m = TF_MINUTES[tf];

  return (
    <main className="mx-auto max-w-[1800px] p-3 lg:p-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-100">Market Context</h1>
        {snap && (
          <>
            <span className={`rounded px-2 py-0.5 font-semibold uppercase ring-1 ${STATUS_STYLE[snap.freshness.status]}`} title={snap.freshness.message}>
              {snap.freshness.status}
            </span>
            <span className="text-zinc-400">
              {snap.provider.name} · feed <b className="text-zinc-300">{snap.provider.feed}</b> · {snap.provider.transport}
            </span>
            <span className="text-zinc-400">
              Latest completed 1m bar:{" "}
              <b className="text-zinc-200">{a?.latest1mT ? `${formatNY(a.latest1mT)} (closed ${formatNY(a.latest1mT + MIN, false)})` : "—"}</b>
            </span>
            <span className="text-zinc-500">{snap.freshness.message}</span>
          </>
        )}
        {loading && <span className="text-zinc-500">updating…</span>}
        {error && <span className="text-red-400">Error: {error}</span>}
      </header>

      {snap && snap.warnings.length > 0 && (
        <div className="mb-3 space-y-1">
          {snap.warnings.map((w) => (
            <div key={w} className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <section className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Segmented value={symbol} options={UI_SYMBOLS} onChange={setSymbol} />
            <Segmented value={tf} options={TIMEFRAMES} onChange={setTf} />
            <div className="flex flex-wrap gap-3 px-1 text-xs text-zinc-400">
              {(
                [
                  ["vwap", "VWAP"],
                  ["ema", "EMA 9/20"],
                  ["levels", "PDH/PDL/PMH/PML"],
                  ["swings", "Swings/BOS"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} className="accent-sky-500" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">Replay (ET):</span>
            <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
            <input type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1" />
            <button onClick={startReplay} className="rounded bg-sky-600 px-2.5 py-1 font-medium text-white hover:bg-sky-500">
              {replay ? "Jump" : "Start replay"}
            </button>
            {replay && (
              <>
                <button onClick={() => step(-1)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
                  ◀ {tf}
                </button>
                <button onClick={() => step(1)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
                  {tf} ▶
                </button>
                <button
                  onClick={() => {
                    setReplay(false);
                    setAsOf(null);
                  }}
                  className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
                >
                  Exit replay
                </button>
              </>
            )}
          </div>

          {replay && asOf !== null && (
            <div className="mb-2 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200">
              REPLAY as of <b>{formatNY(asOf)}</b>. Only candles that had closed by this moment are loaded; swings, levels and
              indicators use no later data.
            </div>
          )}

          <PriceChart snap={snap} show={show} />

          <div className="mt-2 text-xs text-zinc-400">
            {a?.latestCandleT ? (
              <>
                Latest completed {tf} candle: <b className="text-zinc-200">{formatNY(a.latestCandleT)}</b> → closed{" "}
                {formatNY(a.latestCandleT + m * MIN, false)}. Forming candles are not shown.
              </>
            ) : (
              "No completed candles."
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-3 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          <AnalysisPanel snap={snap} />
          <ChatPanel symbol={symbol} tf={tf} asOf={replay ? asOf : null} />
        </aside>
      </div>
    </main>
  );
}
