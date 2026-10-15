import { describe, expect, it } from "vitest";
import { analyze } from "../lib/analysis/analyze";
import { mockSessionBars } from "../lib/data/mock";
import { classifyFreshness } from "../lib/freshness";
import { MIN, nyToUtc } from "../lib/time";
import { TIMEFRAMES } from "../lib/types";

describe("look-ahead bias", () => {
  const all = [...mockSessionBars("QQQ", "2026-10-13"), ...mockSessionBars("QQQ", "2026-10-14")];
  const T = nyToUtc("2026-10-14", "11:07");

  for (const tf of TIMEFRAMES) {
    it(`${tf}: analysis at T is identical whether or not future bars exist`, () => {
      const withFuture = analyze({ bars1m: all, tf, asOf: T });
      const truncated = analyze({ bars1m: all.filter((b) => b.t + MIN <= T), tf, asOf: T });
      expect(withFuture).toEqual(truncated);

      // Tamper with the future: results must not move.
      const tampered = all.map((b) => (b.t >= T ? { ...b, h: b.h * 2, c: b.c * 1.5, o: b.o * 1.5, l: b.l, v: b.v * 10 } : b));
      expect(analyze({ bars1m: tampered, tf, asOf: T })).toEqual(withFuture);
    });

    it(`${tf}: nothing in the output was knowable only after T`, () => {
      const a = analyze({ bars1m: all, tf, asOf: T });
      const m = tf === "1m" ? 1 : tf === "5m" ? 5 : 15;
      expect(a.candles.every((c) => c.t + m * MIN <= T)).toBe(true);
      expect(a.swings.every((s) => s.confirmedAt <= T)).toBe(true);
      expect(a.structureEvents.every((e) => e.t <= T)).toBe(true);
      expect(a.levelEvents.every((e) => e.t <= T && (e.resolvedAt ?? 0) <= T)).toBe(true);
    });
  }

  it("previous-session and premarket levels come from completed data", () => {
    const a = analyze({ bars1m: all, tf: "5m", asOf: T });
    expect(a.levels.prevDate).toBe("2026-10-13");
    expect(a.levels.sessionDate).toBe("2026-10-14");
    expect(a.levels.pdh).toBeDefined();
    expect(a.levels.pmh).toBeDefined();
  });
});

describe("stale data detection", () => {
  const now = nyToUtc("2026-10-14", "10:00") + 30_000; // Wed 10:00:30 ET
  const base = { now, mode: "live" as const, feed: "iex" };

  it("live when the latest 1m bar closed < 90s ago", () => {
    const r = classifyFreshness({ ...base, latestBarT: nyToUtc("2026-10-14", "09:59") });
    expect(r.status).toBe("live");
    expect(r.lagSec).toBe(30);
  });
  it("delayed for a few minutes of silence", () => {
    expect(classifyFreshness({ ...base, latestBarT: nyToUtc("2026-10-14", "09:55") }).status).toBe("delayed");
  });
  it("stale after 5+ minutes without bars during market hours", () => {
    expect(classifyFreshness({ ...base, latestBarT: nyToUtc("2026-10-14", "09:40") }).status).toBe("stale");
  });
  it("stale when the provider is erroring and silent", () => {
    const r = classifyFreshness({ ...base, latestBarT: nyToUtc("2026-10-14", "09:59"), providerError: "401", lastProviderContact: now - 600_000 });
    expect(r.status).toBe("stale");
  });
  it("closed on weekends, not stale", () => {
    const sat = nyToUtc("2026-10-17", "11:00");
    expect(classifyFreshness({ ...base, now: sat, latestBarT: nyToUtc("2026-10-16", "19:59") }).status).toBe("closed");
  });
  it("never presents delayed SIP as live", () => {
    expect(classifyFreshness({ ...base, feed: "delayed_sip", latestBarT: nyToUtc("2026-10-14", "09:59") }).status).toBe("delayed");
  });
  it("labels mock and missing data explicitly", () => {
    expect(classifyFreshness({ ...base, mode: "mock" }).status).toBe("mock");
    expect(classifyFreshness({ ...base }).status).toBe("no-data");
  });
});
