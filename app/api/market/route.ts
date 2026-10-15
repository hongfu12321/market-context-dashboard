import { NextResponse, type NextRequest } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";
import { TIMEFRAMES, UI_SYMBOLS, type Timeframe } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const symbol = (p.get("symbol") ?? "QQQ").toUpperCase();
  const tf = (p.get("tf") ?? "5m") as Timeframe;
  if (!(UI_SYMBOLS as readonly string[]).includes(symbol)) return NextResponse.json({ error: "unknown symbol" }, { status: 400 });
  if (!TIMEFRAMES.includes(tf)) return NextResponse.json({ error: "unknown timeframe" }, { status: 400 });
  let asOf: number | undefined;
  const asOfParam = p.get("asOf");
  if (asOfParam) {
    asOf = Date.parse(asOfParam);
    if (!Number.isFinite(asOf)) return NextResponse.json({ error: "invalid asOf" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildSnapshot(symbol, tf, asOf));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
