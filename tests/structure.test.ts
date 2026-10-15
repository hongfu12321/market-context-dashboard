import { describe, expect, it } from "vitest";
import { findSwings } from "../lib/analysis/swings";
import { classifySequence, detectLevelBreaks, detectStructureBreaks, labelSwings } from "../lib/analysis/structure";
import { MIN } from "../lib/time";
import { DOWNTREND, RANGE, T930, UPTREND, midBars } from "./helpers";

const classify = (mids: number[]) => {
  const bars = midBars(T930, mids);
  const swings = labelSwings(findSwings(bars, 5), 0.05);
  return { bars, swings, ...classifySequence(swings) };
};

describe("confirmed swing points", () => {
  it("finds pivots and records when they were confirmed", () => {
    const bars = midBars(T930, UPTREND);
    const swings = findSwings(bars, 5);
    expect(swings.map((s) => `${s.kind}@${s.index}`)).toEqual(["high@2", "low@4", "high@8", "low@10", "high@14", "low@16"]);
    const h = swings[0];
    expect(h.confirmedIndex).toBe(4);
    expect(h.confirmedAt).toBe(bars[4].t + 5 * MIN); // close of the 2nd right-hand candle
  });

  it("does not mark a swing until the right-hand candles have closed", () => {
    expect(findSwings(midBars(T930, UPTREND.slice(0, 16)), 5).some((s) => s.index === 14)).toBe(false);
    expect(findSwings(midBars(T930, UPTREND.slice(0, 17)), 5).some((s) => s.index === 14)).toBe(true);
  });
});

describe("market structure classification", () => {
  it("HH + HL → uptrend", () => {
    const r = classify(UPTREND);
    expect(r.trend).toBe("uptrend");
    expect(r.swings.filter((s) => s.kind === "high").map((s) => s.label)).toEqual(["first", "HH", "HH"]);
    expect(r.swings.filter((s) => s.kind === "low").map((s) => s.label)).toEqual(["first", "HL", "HL"]);
  });

  it("LH + LL → downtrend", () => {
    expect(classify(DOWNTREND).trend).toBe("downtrend");
  });

  it("equal highs / lows → range", () => {
    expect(classify(RANGE).trend).toBe("range");
  });

  it("too few swings → range / unclear instead of forcing a direction", () => {
    const r = classify(UPTREND.slice(0, 9));
    expect(r.trend).toBe("range");
    expect(r.reason).toMatch(/Insufficient/);
  });
});

describe("BOS / CHoCH", () => {
  it("labels continuation breaks as BOS and a flip as CHoCH", () => {
    const mids = [...UPTREND, 13];
    const bars = midBars(T930, mids);
    const events = detectStructureBreaks(bars, findSwings(bars, 5), 5);
    expect(events.map((e) => `${e.type}:${e.direction}@${e.index}`)).toEqual(["BOS:bullish@7", "BOS:bullish@13", "CHoCH:bearish@19"]);
    // A break is only known after the breaking candle closes.
    expect(events[0].t).toBe(bars[7].t + 5 * MIN);
  });
});

describe("breakout acceptance", () => {
  const level = [{ name: "PDH", price: 10.5 }];
  it("accepted after 3 closes hold above", () => {
    const e = detectLevelBreaks(midBars(T930, [10, 11, 11.2, 11.4, 11.6]), level, 5);
    expect(e[0]).toMatchObject({ type: "breakout", status: "accepted" });
  });
  it("failed when price closes back below", () => {
    const e = detectLevelBreaks(midBars(T930, [10, 11, 10.2, 10.1]), level, 5);
    expect(e[0]).toMatchObject({ type: "breakout", status: "failed" });
  });
  it("pending until enough candles have closed", () => {
    const e = detectLevelBreaks(midBars(T930, [10, 11, 11.2]), level, 5);
    expect(e[0].status).toBe("pending");
  });
});
