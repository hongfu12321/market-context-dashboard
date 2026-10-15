// All timestamps are stored as UTC epoch ms; these helpers only convert for display / session logic.
export const MIN = 60_000;
export const NY_TZ = "America/New_York";

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface NyParts {
  date: string; // YYYY-MM-DD in New York
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

export function nyParts(t: number): NyParts {
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(t))) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour % 24,
    minute: +p.minute,
    weekday: WEEKDAY[p.weekday],
  };
}

export const nyDate = (t: number) => nyParts(t).date;

/** Offset of New York from UTC in minutes at instant t (e.g. -240 in EDT, -300 in EST). */
export function nyOffsetMinutes(t: number): number {
  const p = nyParts(t);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(t / MIN) * MIN) / MIN);
}

/** Convert a New York wall-clock date ("YYYY-MM-DD") and time ("HH:MM") to UTC epoch ms. */
export function nyToUtc(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const local = Date.UTC(y, m - 1, d, hh, mm);
  const first = local - nyOffsetMinutes(local) * MIN;
  return local - nyOffsetMinutes(first) * MIN;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type SessionPhase = "pre" | "rth" | "post" | "closed";

/** Session phase by clock only (04:00–09:30 pre, 09:30–16:00 RTH, 16:00–20:00 post ET). Holidays are not known here. */
export function sessionOf(t: number): SessionPhase {
  const p = nyParts(t);
  if (p.weekday === 0 || p.weekday === 6) return "closed";
  const m = p.hour * 60 + p.minute;
  if (m < 240) return "closed";
  if (m < 570) return "pre";
  if (m < 960) return "rth";
  if (m < 1200) return "post";
  return "closed";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatNY(t: number, withDate = true): string {
  const p = nyParts(t);
  const hm = `${pad(p.hour)}:${pad(p.minute)}`;
  return withDate ? `${p.date} ${hm} ET` : `${hm} ET`;
}
