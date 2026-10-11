"use client";

import { useEffect } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCE_LABEL, type Run, type RunDetail, type Strategy } from "@/lib/data";
import { int, num, pct, scoreTone, tone } from "@/lib/format";

const PARTS: { k: keyof RunDetail["parts"]; label: string; hint: string }[] = [
  { k: "consistency", label: "Consistency", hint: "Share of the windows it was judged on (early, recent, last 1000–4000 bars) that made money per trade" },
  { k: "breadth", label: "Breadth", hint: "Same strategy and timeframe across all stocks: share that held up, marked down when few" },
  { k: "edge", label: "Edge", hint: "Profit factor (1 → 0, 2+ → 100), halved when it did not beat holding the stock" },
  { k: "practicality", label: "Practicality", hint: "Enough trades (100+) and a livable drawdown" },
];
const WINDOW_LABEL: Record<string, string> = { first70: "First 70% of history", last30: "Last 30% of history",
  "1000": "Last 1000 bars", "2000": "Last 2000 bars", "3000": "Last 3000 bars", "4000": "Last 4000 bars" };
const WINDOW_ORDER = ["first70", "last30", "4000", "3000", "2000", "1000"];
const VERDICT: Record<string, [string, string, string]> = {
  repaints: ["Repaints", "text-loss", "Re-run with only closed bars, the trades changed: the backtest used data that wasn't available yet. Not tradable as shown."],
  vectors_present: ["Live differs", "text-warn", "History matched with closed bars, but parts of the script behave differently on the live bar."],
  clean: ["Clean", "text-gain", "No repainting found in the replay check."],
};

export default function ReportPanel({ run, detail, loading, strategy, symbol, name, onClose }: {
  run: Run | null; detail: RunDetail | null; loading: boolean; strategy?: Strategy; symbol: string; name: string; onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  if (!run) {
    return (
      <aside className="hidden h-fit flex-col items-center gap-2 rounded-xl border border-dashed border-line p-10 text-center xl:flex">
        <div className="text-sm font-medium">No backtest selected</div>
        <p className="text-sm text-ink-faint">Pick a row to see its full report: equity curve, score, and how it did early vs recently.</p>
      </aside>
    );
  }
  const title = strategy?.title ?? run.sid;
  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="num grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-panel-2 text-xs font-semibold">{symbol.slice(0, 4)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-snug">{title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded border border-line px-1.5 py-0.5 text-ink-dim">{run.tf}</span>
            <span className={`num rounded px-1.5 py-0.5 font-semibold ${scoreTone(run.score)}`}>{run.score ?? "no score"}</span>
            <span className="rounded border border-line px-1.5 py-0.5 text-ink-dim">{SOURCE_LABEL[run.src]}</span>
            {run.held && <span className="rounded bg-gain/15 px-1.5 py-0.5 text-gain">Held up</span>}
            {run.repaint && <span className={`rounded bg-panel-2 px-1.5 py-0.5 ${VERDICT[run.repaint][1]}`}>{VERDICT[run.repaint][0]}</span>}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim hover:text-ink" aria-label="Close report">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <Tile label="Net %" value={pct(run.net, 1)} cls={tone(run.net)} sub={run.bh != null ? `Buy & hold ${pct(run.bh, 1)}` : undefined} />
        <Tile label="Profit factor" value={num(run.pf)} sub={`Win rate ${num(run.win, 1)}%`} />
        <Tile label="Max drawdown" value={run.dd == null ? "—" : `${num(Math.abs(run.dd), 1)}`} cls="text-loss"
          sub={run.src === "tv" ? "points of the trade sum" : "% of equity"} />
        <Tile label="Trades" value={int(run.trades)} sub={detail?.longs != null ? `${int(detail.longs)} long · ${int(detail.shorts)} short` : undefined} />
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Growth vs buy &amp; hold</h3>
        {loading ? <div className="h-48 animate-pulse rounded-lg bg-panel-2" />
          : detail?.curve ? <Curve c={detail.curve} />
          : <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-faint">
              {run.src === "ts" ? "TrendSpider exports carry no trade list, so there is no curve for this backtest."
                : "Curves are stored for each stock's top-scoring TradingView backtests; this one is not among them."}
            </p>}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Backtest score</h3>
        {detail ? (
          <div className="flex flex-col gap-2">
            {PARTS.map((p) => (
              <div key={p.k} title={p.hint}>
                <div className="flex justify-between text-sm"><span className="text-ink-dim">{p.label}</span><span className="num">{detail.parts[p.k]}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-panel-2"><div className="h-full rounded bg-signal" style={{ width: `${detail.parts[p.k]}%` }} /></div>
              </div>
            ))}
            <p className="text-xs text-ink-faint">
              Breadth: held up on <span className="num">{run.breadth[0]}</span> of <span className="num">{run.breadth[1]}</span> stocks with this strategy and timeframe.
            </p>
          </div>
        ) : <div className="h-24 animate-pulse rounded-lg bg-panel-2" />}
      </section>

      <Recent run={run} detail={detail} />

      {detail && Object.keys(detail.windows).length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Early vs recent</h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel text-[0.68rem] uppercase tracking-wider text-ink-faint">
                <tr><th className="px-2.5 py-2 text-left">Window</th><th className="px-2.5 py-2 text-right">Trades</th>
                  <th className="px-2.5 py-2 text-right">Avg trade</th><th className="px-2.5 py-2 text-right">Win %</th>
                  <th className="px-2.5 py-2 text-right">Net %</th></tr>
              </thead>
              <tbody>
                {Object.entries(detail.windows)
                  .sort(([a], [b]) => WINDOW_ORDER.indexOf(a) - WINDOW_ORDER.indexOf(b))
                  .map(([k, w]) => (
                  <tr key={k} className="border-t border-line-soft">
                    <td className="px-2.5 py-1.5 text-ink-dim">{WINDOW_LABEL[k] ?? `Last ${k} bars`}{w.from ? <span className="block text-[0.68rem] text-ink-faint">from {w.from}</span> : null}</td>
                    <td className="num px-2.5 py-1.5 text-right">{int(w.n)}</td>
                    <td className={`num px-2.5 py-1.5 text-right ${tone(w.avg)}`}>{pct(w.avg, 2)}</td>
                    <td className="num px-2.5 py-1.5 text-right">{num(w.win, 1)}</td>
                    <td className={`num px-2.5 py-1.5 text-right ${tone(w.net)}`}>{pct(w.net, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Performance</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {[
              ["Avg trade", pct(run.avg, 2)], ["Median trade", pct(detail.med, 2)],
              ["Beat holding by", run.edge == null ? "—" : pct(run.edge, 2)], ["Trades / month", num(detail.tpm, 1)],
              ["Avg bars held", num(detail.bars_held, 1)], ["Sharpe", num(detail.sharpe)],
              ["Sortino", num(detail.sortino)], ["Bars tested", int(detail.bars)],
              ["From", run.from ?? "—"], ["To", detail.to ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line-soft pb-1"><dt className="text-ink-dim">{k}</dt><dd className="num">{v}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Strategy</h3>
        <p className="text-ink-dim">
          {strategy?.author ? <>by <span className="text-ink">{strategy.author}</span> · </> : null}
          {run.src === "tv" ? "TradingView script, run unchanged with its own settings by Foresight" : `TrendSpider strategy${strategy?.family ? ` · ${strategy.family}` : ""}`}
        </p>
        {run.repaint && <p className={`text-xs ${VERDICT[run.repaint][1]}`}>{VERDICT[run.repaint][2]}</p>}
        {strategy?.url && (
          <a href={strategy.url} target="_blank" rel="noreferrer" className="self-start rounded-md border border-line px-3 py-1.5 text-signal hover:bg-panel-2">
            Open on TradingView ↗
          </a>
        )}
        <p className="text-xs leading-relaxed text-ink-faint">
          Per-trade returns include commission; no spread or slippage is charged, so live results will be worse. {name} is shown
          for research only — a backtest is not a prediction and this is not advice.
        </p>
      </section>
    </div>
  );

  return (
    <>
      <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-line bg-panel p-4 xl:block">{body}</aside>
      <div className="fixed inset-0 z-40 flex items-end bg-black/60 xl:hidden" onClick={onClose} role="dialog" aria-modal="true">
        <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>{body}</div>
      </div>
    </>
  );
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTH[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Trailing 1 / 3 / 6 months and each of the last 6 calendar months (the current one is month-to-date). */
function Recent({ run, detail }: { run: Run; detail: RunDetail | null }) {
  const r = detail?.recent;
  if (!r && run.m1 == null && run.m3 == null && run.m6 == null) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Recent performance</h3>
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-faint">Not computed for this backtest yet.</p>
      </section>
    );
  }
  const rows: [string, { n?: number; net?: number | null; win?: number; pf?: number | null }][] = r
    ? [["Last month", r.p1m], ["Last 3 months", r.p3m], ["Last 6 months", r.p6m]]
    : [["Last month", { net: run.m1 }], ["Last 3 months", { net: run.m3 }], ["Last 6 months", { net: run.m6 }]];
  const months = r?.months ?? [];
  const max = Math.max(1, ...months.map((m) => Math.abs(m.net ?? 0)));
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        Recent performance <span className="normal-case tracking-normal">· to {run.asof ?? "—"}</span>
      </h3>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel text-[0.68rem] uppercase tracking-wider text-ink-faint">
            <tr><th className="px-2.5 py-2 text-left">Period</th><th className="px-2.5 py-2 text-right">Trades</th>
              <th className="px-2.5 py-2 text-right">Net %</th><th className="px-2.5 py-2 text-right">Win %</th>
              <th className="px-2.5 py-2 text-right">PF</th></tr>
          </thead>
          <tbody>
            {rows.map(([k, p]) => (
              <tr key={k} className="border-t border-line-soft">
                <td className="px-2.5 py-1.5 text-ink-dim">{k}</td>
                <td className="num px-2.5 py-1.5 text-right">{p.n == null ? "—" : int(p.n)}</td>
                <td className={`num px-2.5 py-1.5 text-right ${tone(p.net ?? null)}`}>{p.n === 0 ? "0.0%" : pct(p.net ?? null, 1)}</td>
                <td className="num px-2.5 py-1.5 text-right">{num(p.win ?? null, 1)}</td>
                <td className="num px-2.5 py-1.5 text-right">{num(p.pf ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {months.length > 0 ? (
        <div className="mt-3">
          <div className="grid grid-cols-6 items-end gap-1.5" style={{ height: 110 }} aria-label="Net % by month">
            {months.map((m) => {
              const v = m.net ?? 0, h = Math.max(2, (Math.abs(v) / max) * 46);
              return (
                <div key={m.m} className="flex h-full flex-col items-center justify-center" title={`${monthLabel(m.m)}: ${pct(v, 1)} · ${m.n} trades${m.win != null ? ` · ${num(m.win, 0)}% wins` : ""}`}>
                  <div className="flex h-1/2 w-full items-end justify-center">
                    {v > 0 && <div className="w-full max-w-7 rounded-t bg-gain/80" style={{ height: h }} />}
                  </div>
                  <div className="h-px w-full bg-line" />
                  <div className="flex h-1/2 w-full items-start justify-center">
                    {v < 0 && <div className="w-full max-w-7 rounded-b bg-loss/80" style={{ height: h }} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 grid grid-cols-6 gap-1.5 text-center">
            {months.map((m, i) => (
              <div key={m.m} className="flex flex-col">
                <span className="text-[0.68rem] text-ink-faint">{monthLabel(m.m)}{i === months.length - 1 ? "*" : ""}</span>
                <span className={`num text-xs ${tone(m.net ?? null)}`}>{m.n ? pct(m.net ?? 0, 1) : "—"}</span>
                <span className="num text-[0.65rem] text-ink-faint">{int(m.n)} tr</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[0.7rem] text-ink-faint">Closed trades only, counted in the month they closed (a trade held for months lands entirely in its exit month). Sum of per-trade net %. *Month to date.</p>
        </div>
      ) : (
        run.src === "ts" && <p className="mt-2 text-xs text-ink-faint">TrendSpider's own figures as of its run on {run.asof}; it reports no month-by-month breakdown.</p>
      )}
    </section>
  );
}

function Tile({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="text-[0.68rem] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`num mt-0.5 text-xl ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}

function Curve({ c }: { c: NonNullable<RunDetail["curve"]> }) {
  const rows = c.t.map((t, i) => ({ t: t.slice(0, 10), s: c.s[i], b: c.b[i] }));
  return (
    <div className="h-52 rounded-lg border border-line bg-ground p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
          <XAxis dataKey="t" tick={{ fill: "var(--color-ink-faint)", fontSize: 10 }} minTickGap={40} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "var(--color-ink-faint)", fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={52} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "var(--color-panel)", border: "1px solid var(--color-line)", fontSize: 12 }}
            formatter={(v: any, n: any) => [`${Number(v).toFixed(1)}%`, n === "s" ? "Strategy (sum of trades)" : "Buy & hold"]} />
          <Line type="monotone" dataKey="b" stroke="var(--color-ink-faint)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="s" stroke="var(--color-signal)" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
