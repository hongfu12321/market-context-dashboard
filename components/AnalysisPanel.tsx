"use client";

import type { Snapshot } from "@/lib/snapshot";
import { formatNY } from "@/lib/time";

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const TREND_STYLE = {
  uptrend: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  downtrend: "bg-red-500/15 text-red-300 ring-red-500/40",
  range: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/40",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

export default function AnalysisPanel({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Card title="Market structure">Loading…</Card>;
  const a = snap.analysis;
  const events = [
    ...a.structureEvents.map((e) => ({
      t: e.t,
      text: `${e.direction === "bullish" ? "▲" : "▼"} ${e.type} ${e.direction} — close ${f(e.close)} through ${f(e.level)}`,
      tone: e.direction === "bullish" ? "text-emerald-300" : "text-red-300",
    })),
    ...a.levelEvents.map((e) => ({
      t: e.t,
      text: `${e.type === "breakout" ? "▲" : "▼"} ${e.type} ${e.level} ${f(e.price)} — ${e.status}`,
      tone: e.status === "failed" ? "text-amber-300" : e.type === "breakout" ? "text-emerald-300" : "text-red-300",
    })),
  ]
    .sort((x, y) => y.t - x.t)
    .slice(0, 8);
  const last = a.lastPrice;
  const above = last === null ? [] : a.keyLevels.filter((k) => k.price > last);
  const below = last === null ? [] : a.keyLevels.filter((k) => k.price <= last);

  const levelRow = (k: (typeof a.keyLevels)[number]) => {
    const near = k === a.nearestSupport || k === a.nearestResistance;
    return (
      <tr key={k.name + k.price} className={near ? "text-zinc-100" : "text-zinc-400"}>
        <td className="py-0.5 pr-2">{k.name}</td>
        <td className="py-0.5 pr-2 text-right tabular-nums">{f(k.price)}</td>
        <td className="py-0.5 pr-2 text-right tabular-nums">{k.distance >= 0 ? "+" : ""}{f(k.distance)}</td>
        <td className="py-0.5 text-right tabular-nums">{f(k.distanceAtr, 1)}</td>
      </tr>
    );
  };

  return (
    <>
      <Card title={`Market structure · ${snap.symbol} ${snap.tf}`}>
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-sm font-semibold ring-1 ${TREND_STYLE[a.trend.trend]}`}>{a.trend.label}</span>
          <span className="text-xs text-zinc-500">as of {formatNY(snap.asOf)}</span>
        </div>
        <p className="mb-2 text-xs text-zinc-300">{a.trend.reason}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
          <div><span className="text-zinc-500">Last</span> <b className="tabular-nums">{f(last)}</b></div>
          <div><span className="text-zinc-500">ATR14</span> <b className="tabular-nums">{f(a.atr)}</b></div>
          <div>
            <span className="text-zinc-500">vs VWAP</span>{" "}
            <b className="tabular-nums">{a.vwapDistance ? `${f(a.vwapDistance.atr, 1)} ATR` : "—"}</b>
          </div>
          <div>
            <span className="text-zinc-500">Pullback</span> <b className="tabular-nums">{a.pullback ? `${f(a.pullback.retracePct, 0)}%` : "—"}</b>
          </div>
        </div>
      </Card>

      <Card title="Support / resistance">
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-normal">Level</th>
              <th className="text-right font-normal">Price</th>
              <th className="text-right font-normal">Δ</th>
              <th className="text-right font-normal">ATR</th>
            </tr>
          </thead>
          <tbody>
            {above.map(levelRow)}
            <tr className="text-sky-300">
              <td className="py-0.5">— last price —</td>
              <td className="text-right tabular-nums">{f(last)}</td>
              <td colSpan={2} />
            </tr>
            {below.map(levelRow)}
          </tbody>
        </table>
      </Card>

      <Card title="Recent price action events">
        {events.length === 0 ? (
          <p className="text-xs text-zinc-500">No structure or level events in the loaded data.</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {events.map((e, i) => (
              <li key={i} className={e.tone}>
                <span className="mr-2 text-zinc-500 tabular-nums">{formatNY(e.t, false)}</span>
                {e.text}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Scenarios (conditional, not predictions)">
        <p className="mb-1 text-xs text-emerald-200/90">
          <b>Bullish:</b> {a.scenarios.bullish}
        </p>
        <p className="text-xs text-red-200/90">
          <b>Bearish:</b> {a.scenarios.bearish}
        </p>
      </Card>

      <Card title="Deterministic summary">
        <details className="text-xs" open>
          <summary className="cursor-pointer text-zinc-400">Observations (objective)</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-300">
            {a.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
        <details className="mt-2 text-xs" open>
          <summary className="cursor-pointer text-zinc-400">Interpretation</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-300">
            {a.interpretation.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
      </Card>
    </>
  );
}
