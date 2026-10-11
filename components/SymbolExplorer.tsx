"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadIndex, loadStrategies, SOURCE_LABEL, type Strategy, type SymbolIndex, type SymbolSummary } from "@/lib/data";
import { int, num, pct, scoreTone, tone } from "@/lib/format";

const SORTS: Record<string, { label: string; fn: (a: SymbolSummary, b: SymbolSummary) => number }> = {
  held: { label: "Most strategies held up", fn: (a, b) => b.held - a.held },
  score: { label: "Best strategy score", fn: (a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1) },
  move: { label: "Biggest move today", fn: (a, b) => Math.abs(b.last?.chg_pct ?? 0) - Math.abs(a.last?.chg_pct ?? 0) },
  az: { label: "A – Z", fn: (a, b) => a.symbol.localeCompare(b.symbol) },
};

export default function SymbolExplorer() {
  const [index, setIndex] = useState<SymbolIndex | null>(null);
  const [strategies, setStrategies] = useState<Record<string, Strategy> | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("held");
  const params = useSearchParams();
  const router = useRouter();
  const list = params.get("list") ?? "";
  useEffect(() => { loadIndex().then(setIndex); loadStrategies().then(setStrategies); }, []);

  const shown = useMemo(() => {
    if (!index) return [];
    const s = q.trim().toLowerCase();
    return index.symbols
      .filter((x) => !list || x.lists.includes(list))
      .filter((x) => !s || x.symbol.toLowerCase().includes(s) || x.name.toLowerCase().includes(s))
      .sort(SORTS[sort].fn);
  }, [index, q, list, sort]);

  const totals = useMemo(() => index && {
    symbols: index.symbols.length,
    backtests: index.symbols.reduce((a, x) => a + x.backtests, 0),
    held: index.symbols.reduce((a, x) => a + x.held, 0),
    strategies: strategies ? Object.keys(strategies).length : null,
  }, [index, strategies]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Explore by symbol</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {list ? `${list} — best backtested strategies per stock` : "Every stock, its best backtested strategies"}
        </h1>
        <p className="max-w-3xl text-ink-dim">
          TradingView strategies run as published by Foresight, and the TrendSpider strategy runs, on each of your watchlist
          stocks across 5-minute, 15-minute, hourly and daily bars. Pick a stock to see which strategies held up on it —
          and which only looked good once.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[
          { k: "Stocks", v: totals?.symbols, s: "from your IBKR watchlists" },
          { k: "Backtests", v: totals?.backtests, s: "TradingView + TrendSpider" },
          { k: "Strategies", v: totals?.strategies, s: "with at least one closed trade" },
          { k: "Held up", v: totals?.held, s: "strategy–stock pairs that held up" },
        ].map((t) => (
          <div key={t.k} className="bg-panel px-4 py-3">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">{t.k}</div>
            <div className="num mt-1 text-2xl">{t.v != null ? int(t.v) : "…"}</div>
            <div className="text-xs text-ink-faint">{t.s}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {["", ...(index?.lists ?? [])].map((l) => (
            <button key={l || "all"} onClick={() => router.push(l ? `/symbols?list=${encodeURIComponent(l)}` : "/symbols")}
              className={`rounded-full border px-3 py-1 text-sm ${list === l ? "border-signal/50 bg-signal-soft text-signal" : "border-line text-ink-dim hover:text-ink"}`}>
              {l || "All"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <input id="explore-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ticker or name"
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-signal/60 sm:w-56" />
          <select id="explore-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort symbols"
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm outline-none">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {!index ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl border border-line bg-panel" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => <SymbolCard key={s.symbol} s={s} best={s.best ? strategies?.[s.best.sid] : undefined} />)}
          {shown.length === 0 && <p className="text-ink-dim">No stock matches.</p>}
        </div>
      )}
    </div>
  );
}

function SymbolCard({ s, best }: { s: SymbolSummary; best?: Strategy }) {
  return (
    <Link href={`/symbols/${s.symbol}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-signal/40 hover:bg-panel-2">
      <div className="flex items-start gap-3">
        <span className="num grid h-10 w-12 shrink-0 place-items-center rounded-lg bg-panel-2 text-xs font-semibold text-ink group-hover:bg-ground">
          {s.symbol.slice(0, 4)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{s.name}</div>
          <div className="num text-xs text-ink-faint">{s.exchange ? `${s.exchange}:` : ""}{s.symbol}</div>
        </div>
        {s.last && (
          <div className="text-right">
            <div className="num text-sm">{num(s.last.close)}</div>
            <div className={`num text-xs ${tone(s.last.chg_pct)}`}>{pct(s.last.chg_pct)}</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-ink-dim">
        <span><span className="num text-ink">{int(s.strategies)}</span> strategies</span>
        <span><span className="num text-gain">{int(s.held)}</span> held up</span>
      </div>
      {s.best && (
        <div className="flex items-center gap-2 border-t border-line-soft pt-3 text-xs">
          <span className={`num rounded px-1.5 py-0.5 font-semibold ${scoreTone(s.best.score)}`}>{s.best.score}</span>
          <span className="truncate text-ink-dim">{best?.title ?? s.best.sid}</span>
          <span className="ml-auto shrink-0 text-ink-faint">{s.best.tf} · {SOURCE_LABEL[s.best.src]}</span>
        </div>
      )}
    </Link>
  );
}
