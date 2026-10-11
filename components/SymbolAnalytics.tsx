"use client";

import { SOURCE_LABEL, TIMEFRAMES, type Run, type Strategy, type SymbolData } from "@/lib/data";
import { int, num, pct, scoreTone, tone } from "@/lib/format";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The symbol's backtests in aggregate: what usually happens here, per timeframe and source. */
export default function SymbolAnalytics({ data, strategies, onOpen }: { data: SymbolData; strategies: Record<string, Strategy>; onOpen: (r: Run) => void }) {
  const s = data.stats;
  const scored = data.runs.filter((r) => r.score !== null && (r.trades ?? 0) >= 30 && !strategies[r.sid]?.dup_of);
  const groups = [...TIMEFRAMES].map((tf) => {
    const g = scored.filter((r) => r.tf === tf);
    return { tf, n: g.length, held: g.filter((r) => r.held).length,
      net: median(g.map((r) => r.net ?? 0)), win: g.length ? g.reduce((a, r) => a + (r.win ?? 0), 0) / g.length : null,
      dd: median(g.map((r) => Math.abs(r.dd ?? 0))) };
  });
  const top = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Backtests run", int(s.backtests), `${int(s.tv)} TradingView · ${int(s.ts)} TrendSpider`],
          ["Strategies", int(s.strategies), `${int(s.held_strategies ?? 0)} held up on this stock`],
          ["Beat buy & hold", s.beat_bh_pct == null ? "—" : `${num(s.beat_bh_pct, 0)}%`, "of scored backtests"],
          ["Median net", pct(s.median_net, 1), "per backtest"],
          ["Average win rate", s.avg_win == null ? "—" : `${num(s.avg_win, 1)}%`, "across backtests"],
          ["Median max DD", s.median_dd == null ? "—" : num(Math.abs(s.median_dd), 1), `${int(s.repainting)} repainting excluded`],
        ].map(([k, v, sub]) => (
          <div key={k} className="bg-panel px-4 py-3">
            <div className="text-[0.68rem] uppercase tracking-wider text-ink-faint">{k}</div>
            <div className="num mt-1 text-xl">{v}</div>
            <div className="text-xs text-ink-faint">{sub}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">By timeframe <span className="font-normal text-ink-faint">· backtests with 30+ trades</span></h2>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-[0.7rem] uppercase tracking-wider text-ink-faint">
              <tr>{["Timeframe", "Backtests", "Held up", "Median net %", "Avg win %", "Median max DD"].map((h, i) =>
                <th key={h} className={`px-3 py-2.5 ${i ? "text-right" : ""}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.tf} className="border-t border-line-soft">
                  <td className="px-3 py-2">{g.tf}</td>
                  <td className="num px-3 py-2 text-right">{int(g.n)}</td>
                  <td className="num px-3 py-2 text-right">{int(g.held)} <span className="text-ink-faint">({g.n ? num((100 * g.held) / g.n, 0) : 0}%)</span></td>
                  <td className={`num px-3 py-2 text-right ${tone(g.net)}`}>{pct(g.net, 1)}</td>
                  <td className="num px-3 py-2 text-right">{num(g.win, 1)}</td>
                  <td className="num px-3 py-2 text-right text-loss">{num(g.dd, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Top 10 by score</h2>
        <ol className="flex flex-col divide-y divide-line-soft rounded-xl border border-line">
          {top.map((r, i) => (
            <li key={r.id}>
              <button onClick={() => onOpen(r)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-panel">
                <span className="num w-5 text-ink-faint">{i + 1}</span>
                <span className={`num rounded px-1.5 py-0.5 text-xs font-semibold ${scoreTone(r.score)}`}>{r.score}</span>
                <span className="min-w-0 flex-1 truncate">{strategies[r.sid]?.title ?? r.sid}</span>
                <span className="text-xs text-ink-faint">{r.tf} · {SOURCE_LABEL[r.src]}</span>
                <span className={`num w-20 text-right ${tone(r.net)}`}>{pct(r.net, 1)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
