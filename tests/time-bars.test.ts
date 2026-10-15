import { describe, expect, it } from "vitest";
import { MIN, formatNY, nyOffsetMinutes, nyToUtc, sessionOf } from "../lib/time";
import { findGaps, mergeBars } from "../lib/bars";
import { T930, minuteBars } from "./helpers";

describe("timestamp handling", () => {
  it("converts ET wall-clock to UTC across DST", () => {
    expect(nyToUtc("2026-10-14", "09:30")).toBe(Date.UTC(2026, 9, 14, 13, 30)); // EDT
    expect(nyToUtc("2026-01-14", "09:30")).toBe(Date.UTC(2026, 0, 14, 14, 30)); // EST
    expect(nyToUtc("2026-03-09", "09:30")).toBe(Date.UTC(2026, 2, 9, 13, 30)); // day after DST start
    expect(nyOffsetMinutes(Date.UTC(2026, 9, 14, 13, 30))).toBe(-240);
    expect(nyOffsetMinutes(Date.UTC(2026, 0, 14, 14, 30))).toBe(-300);
  });

  it("formats UTC instants in America/New_York", () => {
    expect(formatNY(Date.UTC(2026, 9, 14, 13, 30))).toBe("2026-10-14 09:30 ET");
    expect(formatNY(Date.UTC(2026, 9, 15, 0, 5))).toBe("2026-10-14 20:05 ET");
  });

  it("classifies session phases", () => {
    expect(sessionOf(T930 - MIN)).toBe("pre");
    expect(sessionOf(T930)).toBe("rth");
    expect(sessionOf(nyToUtc("2026-10-14", "15:59"))).toBe("rth");
    expect(sessionOf(nyToUtc("2026-10-14", "16:00"))).toBe("post");
    expect(sessionOf(nyToUtc("2026-10-14", "03:59"))).toBe("closed");
    expect(sessionOf(nyToUtc("2026-10-17", "10:00"))).toBe("closed"); // Saturday
  });
});

describe("bar merging, duplicates and gaps", () => {
  it("dedupes by timestamp and lets corrections replace the original", () => {
    const base = minuteBars(T930, [1, 2, 3]);
    const corrected = { ...base[1], c: 2.05, h: 2.2, v: 999 };
    const { bars, duplicates } = mergeBars(base, [base[0], corrected]);
    expect(bars).toHaveLength(3);
    expect(duplicates).toBe(2);
    expect(bars[1].v).toBe(999);
  });

  it("rejects malformed bars", () => {
    const bad = { t: T930 + 30_000, o: 1, h: 1, l: 1, c: 1, v: 1 }; // not minute-aligned
    const inverted = { t: T930, o: 1, h: 0.5, l: 2, c: 1, v: 1 };
    expect(mergeBars([], [bad, inverted]).rejected).toBe(2);
  });

  it("reports missing minutes without filling them", () => {
    const bars = minuteBars(T930, [1, 2, null, null, 5]);
    expect(findGaps(bars)).toEqual([{ after: T930 + MIN, before: T930 + 4 * MIN, missing: 2 }]);
  });
});
