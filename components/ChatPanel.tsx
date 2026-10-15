"use client";

import { useState } from "react";
import type { Timeframe } from "@/lib/types";

const SUGGESTIONS = [
  "What is the current market structure?",
  "Is this a trend or range?",
  "Where are the important support and resistance levels?",
  "Is this breakout being accepted or rejected?",
  "Are buyers or sellers showing stronger price action?",
  "What would invalidate the bullish scenario?",
  "Is there enough price movement for a potential 1.5R setup?",
  "Compare QQQ and NVDA market structure.",
  "Explain the most recent 30 minutes of price action.",
];

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

/** Minimal rendering: **bold** only; everything else stays plain text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <b key={i} className="text-zinc-100">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export default function ChatPanel({ symbol, tf, asOf }: { symbol: string; tf: Timeframe; asOf: number | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          tf,
          asOf: asOf !== null ? new Date(asOf).toISOString() : undefined,
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const j = await r.json();
      const meta = j.mode === "ai" ? `AI · ${j.model}` : j.mode === "deterministic" ? "Deterministic summary (no ANTHROPIC_API_KEY)" : "AI error";
      setMsgs([...next, { role: "assistant", content: j.reply ?? j.error ?? "No reply", meta }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: String(e), meta: "Request failed" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[420px] flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Discuss · {symbol} {tf}
          {asOf !== null && <span className="ml-1 text-sky-400">(replay)</span>}
        </h2>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} className="text-[11px] text-zinc-500 hover:text-zinc-300">
            clear
          </button>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-[13px] leading-relaxed lg:max-h-[55vh]">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-zinc-700 px-2.5 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-6 rounded-md bg-sky-900/30 px-3 py-2 text-sky-100" : "whitespace-pre-wrap text-zinc-300"}>
            {m.meta && <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{m.meta}</div>}
            <Rich text={m.content} />
          </div>
        ))}
        {busy && <div className="text-xs text-zinc-500">Analysing structured market data…</div>}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about structure, levels, breakouts…"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-sky-600"
        />
        <button disabled={busy} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}
