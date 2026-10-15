"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Snapshot } from "@/lib/snapshot";
import { MIN, formatNY, nyOffsetMinutes } from "@/lib/time";

export interface ChartToggles {
  vwap: boolean;
  ema: boolean;
  levels: boolean;
  swings: boolean;
}

// Lightweight Charts renders timestamps as UTC; shift by the NY offset so the axis reads in ET.
const toTime = (t: number) => Math.floor((t + nyOffsetMinutes(t) * MIN) / 1000) as UTCTimestamp;

interface Refs {
  chart: IChartApi;
  candle: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  vwap: ISeriesApi<"Line">;
  ema9: ISeriesApi<"Line">;
  ema20: ISeriesApi<"Line">;
  markers: ISeriesMarkersPluginApi<Time>;
  lines: IPriceLine[];
  viewKey: string;
}

export default function PriceChart({ snap, show }: { snap: Snapshot | null; show: ChartToggles }) {
  const el = useRef<HTMLDivElement>(null);
  const refs = useRef<Refs | null>(null);

  useEffect(() => {
    const chart = createChart(el.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#a1a1aa", fontSize: 11 },
      grid: { vertLines: { color: "#27272a66" }, horzLines: { color: "#27272a66" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#3f3f46" },
      rightPriceScale: { borderColor: "#3f3f46" },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const line = (color: string) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    refs.current = {
      chart,
      candle,
      volume,
      vwap: line("#38bdf8"),
      ema9: line("#f59e0b"),
      ema20: line("#a78bfa"),
      markers: createSeriesMarkers(candle, []),
      lines: [],
      viewKey: "",
    };
    return () => {
      chart.remove();
      refs.current = null;
    };
  }, []);

  useEffect(() => {
    const r = refs.current;
    if (!r || !snap) return;
    const a = snap.analysis;
    r.candle.setData(a.candles.map((c) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
    r.volume.setData(a.candles.map((c) => ({ time: toTime(c.t), value: c.v, color: c.c >= c.o ? "#22c55e55" : "#ef444455" })));
    // Whitespace points (time only) break the line, so VWAP does not bridge sessions.
    const lineData = (arr: (number | null)[]) =>
      a.candles.map((c, i) => (arr[i] === null || arr[i] === undefined ? { time: toTime(c.t) } : { time: toTime(c.t), value: arr[i] as number }));
    r.vwap.setData(show.vwap ? lineData(a.vwap) : []);
    r.ema9.setData(show.ema ? lineData(a.ema9) : []);
    r.ema20.setData(show.ema ? lineData(a.ema20) : []);

    r.lines.forEach((l) => r.candle.removePriceLine(l));
    r.lines = [];
    if (show.levels) {
      const L = a.levels;
      const defs: [string, number | undefined, string][] = [
        ["PDH", L.pdh, "#d4d4d8"],
        ["PDL", L.pdl, "#d4d4d8"],
        ["PMH", L.pmh, "#fbbf24"],
        ["PML", L.pml, "#fbbf24"],
      ];
      for (const [title, price, color] of defs) {
        if (price !== undefined) r.lines.push(r.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title }));
      }
    }

    const first = a.candles[0]?.t ?? Infinity;
    const ms: SeriesMarker<Time>[] = [];
    if (show.swings) {
      for (const s of a.swings) {
        if (s.t < first || s.label === "first") continue;
        ms.push({ time: toTime(s.t), position: s.kind === "high" ? "aboveBar" : "belowBar", color: s.kind === "high" ? "#fca5a5" : "#86efac", shape: "circle", size: 0.4, text: s.label });
      }
      for (const e of a.structureEvents) {
        if (e.barT < first) continue;
        ms.push({
          time: toTime(e.barT),
          position: e.direction === "bullish" ? "belowBar" : "aboveBar",
          color: e.type === "CHoCH" ? "#e879f9" : "#38bdf8",
          shape: e.direction === "bullish" ? "arrowUp" : "arrowDown",
          text: e.type,
        });
      }
    }
    ms.sort((x, y) => (x.time as number) - (y.time as number));
    r.markers.setMarkers(ms);

    const key = `${snap.symbol}|${snap.tf}|${snap.mode}`;
    if (key !== r.viewKey && a.candles.length) {
      r.viewKey = key;
      const n = a.candles.length;
      r.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 3 });
    }
  }, [snap, show]);

  const a = snap?.analysis;
  return (
    <div className="relative h-[360px] sm:h-[460px] lg:h-[calc(100vh-17rem)] lg:min-h-[460px]">
      <div ref={el} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 text-[11px] leading-4 text-zinc-400">
        <div className="text-zinc-200">
          {snap ? `${snap.symbol}${snap.proxyNote ? " (SPY proxy)" : ""} · ${snap.tf}` : "Loading…"}
          {a?.latestCandleT ? ` · last candle ${formatNY(a.latestCandleT)}` : ""}
        </div>
        <div>
          {show.vwap && <span className="mr-2 text-sky-400">VWAP{snap?.provider.feed === "iex" ? " (IEX)" : ""}</span>}
          {show.ema && (
            <>
              <span className="mr-2 text-amber-400">EMA9</span>
              <span className="mr-2 text-violet-400">EMA20</span>
            </>
          )}
          {show.levels && <span>-- PDH/PDL · <span className="text-amber-300">PMH/PML</span></span>}
        </div>
      </div>
    </div>
  );
}
