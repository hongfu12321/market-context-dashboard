import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";
import { SYSTEM_PROMPT, deterministicReply, marketContext } from "@/lib/chat";
import { TIMEFRAMES, UI_SYMBOLS, type Timeframe } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { symbol: string; tf: Timeframe; asOf?: string; messages: ChatMessage[] };
  const question = body.messages?.at(-1);
  if (!question || question.role !== "user" || !TIMEFRAMES.includes(body.tf)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const asOf = body.asOf ? Date.parse(body.asOf) : undefined;
  const mentioned = question.content.toUpperCase().match(/\b(QQQ|SPY|NVDA|META|SPX)\b/g) ?? [];
  const symbols = [...new Set([body.symbol.toUpperCase(), ...mentioned])]
    .filter((s) => (UI_SYMBOLS as readonly string[]).includes(s))
    .slice(0, 3);
  const snaps = await Promise.all(symbols.map((s) => buildSnapshot(s, body.tf, asOf)));

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ mode: "deterministic", reply: deterministicReply(snaps) });
  }

  const context = await Promise.all(
    snaps.map(async (s) => marketContext(s, s.tf === "1m" ? undefined : await buildSnapshot(s.symbol, "1m", asOf))),
  );
  // Prior turns as plain text; fresh market data only on the latest turn. History must start with a user turn.
  const history = body.messages.slice(-13, -1);
  while (history[0]?.role === "assistant") history.shift();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  try {
    const client = new Anthropic();
    const resp = (await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: `<market_data>\n${JSON.stringify(context)}\n</market_data>\n\nQuestion: ${question.content}` },
      ],
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)) as Anthropic.Beta.BetaMessage;
    if (resp.stop_reason === "refusal") {
      return NextResponse.json({ mode: "ai", model: resp.model, reply: "The model declined to answer this request." });
    }
    const reply = resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return NextResponse.json({ mode: "ai", model: resp.model, reply: reply || "(empty response)" });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}` : String(e);
    return NextResponse.json({
      mode: "error",
      reply: `AI request failed (${msg}). Deterministic summary instead:\n\n${deterministicReply(snaps)}`,
    });
  }
}
