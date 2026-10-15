"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { loadStrategies, SOURCE_LABEL, TIMEFRAMES, type Strategy } from "@/lib/data";
import { int, num, pct, scoreTone, tone } from "@/lib/format";
import { useStored } from "./TableTools";
import { Pills, Th } from "./SymbolView";

/** One strategy on one timeframe, its backtests on every stock of the watchlist combined (scripts/build_top.py). */
type Top = {
  sid: string; src: "tv" | "ts"; tf: string; dir: string | null;
  stocks: number; traded: number; held: number; good: number; solid: number; avoid: number; cons: number;
  score: number | null; net: number | null; dd: number | null; win: number | null; pf: number | null; trades: number | null;
  beat: number | null; add6: number | null; acct: number | null; acct_dd: number | null; acct_pos: number | null;
  rep: "clean" | "repaints" | null; checked: number;
  best: [sym: string, score: number | null, net: number | null][];
};
type TopFile = { generated: string; list: string; fills: string; stocks: number; cols: string[]; rows: any[][] };
type ListRef = { name: string; slug: string };

const cache = new Map<string, Promise<TopFile>>();
const loadTop = (slug: string, fills: string) => {
  const key = `${slug}.${fills}`;
  if (!cache.has(key)) cache.set(key, fetch(`/data/top/${key}.json`).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); }));
  return cache.get(key)!;
};
const DIR: Record<string, string> = { long: "Long only", short: "Short only", both: "Long & short" };
const PAGE = 50;

type Col = { key: keyof Top | "rank"; label: string; hint: string; right?: boolean };
const COLS: Col[] = [
  { key: "rank", label: "#", hint: "Rank in the current sort" },
  { key: "sid", label: "Strategy", hint: "The strategy, where it comes from and its trade direction" },
  { key: "tf", label: "TF", hint: "Timeframe" },
  { key: "cons", label: "Consistency", right: true,
    hint: "0–100: how surely it holds up across the watchlist's stocks — the lower bound (90% confidence) of the share of stocks where it held up and is not rated Avoid. 9 of 10 stocks ranks above 1 of 1" },
  { key: "good", label: "Held up", right: true, hint: "Stocks where it held up (profitable per trade early and recently, beat holding the stock) and is not rated Avoid, of the stocks tested" },
  { key: "solid", label: "Solid", right: true, hint: "Stocks where the backtest is rated Solid: held up, survives realistic fills, no repaint, unlikely to be luck, normal win rate" },
  { key: "score", label: "Score", right: true, hint: "Median Backtest Score over the stocks it traded on" },
  { key: "net", label: "Net %", right: true, hint: "Median net % over the stocks it traded on" },
  { key: "dd", label: "DrawDown", right: true, hint: "Median maximum drawdown over the stocks it traded on" },
  { key: "add6", label: "Avg Monthly DD", right: true, hint: "Median of the average monthly drawdown over the last 6 months" },
  { key: "acct", label: "Account %", right: true,
    hint: "The money view: median account return over the whole test at the script's own position size (realistic fills), and the share of stocks where the account ended up. Net % adds up per-trade returns as if every trade used the same money; this does not" },
  { key: "acct_dd", label: "Account DD", right: true, hint: "Median account drawdown at the script's own position size (realistic fills), open trades included" },
  { key: "win", label: "Win %", right: true, hint: "Median win rate (a trade = one position: partial exits and scale-ins merged)" },
  { key: "pf", label: "PF", right: true, hint: "Median profit factor" },
  { key: "trades", label: "Trades", right: true, hint: "Median number of trades per stock" },
  { key: "beat", label: "Beat B&H", right: true, hint: "Share of stocks where it beat simply holding the stock" },
];

/** The best strategies across stocks: one row per strategy and timeframe, combining its backtests on every stock of the
 *  chosen watchlist, ranked by how consistently it holds up. Static files, filtered and sorted in the browser. */
export default function TopStrategiesView() {
  const [strategies, setStrategies] = useState<Record<string, Strategy>>({});
  const [lists, setLists] = useState<ListRef[]>([]);
  const [list, setList] = useStored<string>("atlas.top.list", "all");
  const [tf, setTf] = useStored<string>("atlas.top.tf", "");
  const [src, setSrc] = useStored<string>("atlas.top.src", "");
  const [realistic, setRealistic] = useStored<boolean>("atlas.realistic", false);
  const [showRepaint, setShowRepaint] = useStored<boolean>("atlas.top.repaint", false);
  const [minStocks, setMinStocks] = useStored<number>("atlas.top.min", 3);
  const [sort, setSort] = useStored<string>("atlas.top.sort", "cons");
  const [dir, setDir] = useStored<1 | -1>("atlas.top.dir", -1);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string>("");
  const [file, setFile] = useState<TopFile | null>(null);
  const [error, setError] = useState("");
  const fills = realistic ? "realistic" : "tv";
  const slug = lists.some((l) => l.slug === list) ? list : "all";

  useEffect(() => {
    loadStrategies().then(setStrategies);
    fetch("/data/top/lists.json").then((r) => r.json()).then(setLists).catch(() => setLists([{ name: "All", slug: "all" }]));
  }, []);
  useEffect(() => {
    let live = true;
    loadTop(slug, fills).then((f) => { if (live) { setFile(f); setError(""); } }).catch((e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [slug, fills]);
  useEffect(() => setPage(1), [slug, fills, tf, src, showRepaint, minStocks, q, sort, dir]);

  const rows = useMemo<Top[]>(() => {
    if (!file) return [];
    const c = file.cols;
    return file.rows.map((r) => Object.fromEntries(c.map((k, j) => [k, r[j]])) as Top);
  }, [file]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = rows.filter((r) => (!tf || r.tf === tf) && (!src || r.src === src) && (showRepaint || r.rep !== "repaints")
      && r.stocks >= Math.min(minStocks, file?.stocks ?? 1) && (!s || (strategies[r.sid]?.title ?? r.sid).toLowerCase().includes(s)));
    if (sort !== "cons" || dir !== -1) {
      const val = (r: Top) => sort === "sid" ? (strategies[r.sid]?.title ?? r.sid).toLowerCase() : sort === "tf" ? TIMEFRAMES.indexOf(r.tf as any) : (r as any)[sort];
      out.sort((a, b) => {
        const av = val(a), bv = val(b);
        if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return out;
  }, [rows, tf, src, showRepaint, minStocks, q, sort, dir, strategies, file]);
  const sortBy = (k: string) => {
    if (k === "rank") { setSort("cons"); setDir(-1); return; }
    if (sort === k) setDir(dir === 1 ? -1 : 1);
    else { setSort(k); setDir(k === "sid" || k === "tf" || k === "dd" || k === "add6" ? 1 : -1); }
  };
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const listName = lists.find((l) => l.slug === slug)?.name ?? "All";

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Top strategies</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-dim">
          Each strategy on each timeframe, judged across all the stocks of a watchlist instead of one stock at a time.
          Ranked by consistency: a strategy that holds up on most stocks is less likely to be a lucky fit to one chart.
        </p>
      </header>

      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-[4.6rem] pl-1 text-sm text-ink-faint">Watchlist</span>
          <div className="flex flex-wrap gap-1">
            {lists.map((l) => (
              <button key={l.slug} onClick={() => setList(l.slug)}
                className={`rounded-md border px-2.5 py-1 text-sm ${slug === l.slug ? "border-signal/50 bg-signal-soft text-signal" : "border-line text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>
                {l.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pills value={tf} onChange={setTf} options={[["", "All TF"], ...TIMEFRAMES.map((t) => [t, t] as [string, string])]} />
          <Pills value={src} onChange={setSrc} options={[["", "All sources"], ["tv", "TradingView"], ["ts", "TrendSpider"]]} />
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1 text-sm text-ink-dim"
            title="Off: TradingView's fills. On: the backtests re-run with realistic fills (exits from the next bar, stop before target, spread)">
            <input id="top-realistic" type="checkbox" role="switch" checked={realistic} onChange={(e) => setRealistic(e.target.checked)} className="sr-only" />
            <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${realistic ? "bg-signal" : "bg-panel-2 ring-1 ring-line"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ground transition-all ${realistic ? "left-[0.85rem]" : "left-0.5"}`} />
            </span>
            Realistic fills
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-dim" title="Strategies whose trades changed when re-run with closed bars only (they used future data)">
            <input id="top-repaint" type="checkbox" checked={showRepaint} onChange={(e) => setShowRepaint(e.target.checked)} className="accent-[var(--color-signal)]" />
            Show repainting
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-dim" title="Hide strategies tested on fewer stocks than this">
            Min stocks
            <select id="top-min" value={minStocks} onChange={(e) => setMinStocks(Number(e.target.value))}
              className="rounded-md border border-line bg-ground px-1.5 py-1 text-sm outline-none">
              {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <input id="top-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a strategy"
            className="min-w-0 flex-1 rounded-md border border-line bg-ground px-2.5 py-1 text-base sm:text-sm outline-none focus:border-signal/60" />
        </div>
      </div>

      {error && <p className="text-sm text-loss">Could not load the rankings ({error}). Try again in a moment.</p>}
      {file && (
        <p className="-mt-2 text-xs text-ink-faint">
          {listName}: {int(file.stocks)} stocks · {int(shown.length)} strategy × timeframe rows ·
          {realistic ? " realistic fills where re-run (TradingView fills otherwise)" : " TradingView's fills"} · medians over the stocks each one traded on.
          Click a row for the stocks it does best on.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-panel text-left text-[0.7rem] uppercase tracking-wider text-ink-faint">
            <tr>{COLS.map((c) => <Th key={c.key} k={c.key} label={c.label} sort={sort} dir={dir} on={sortBy} right={c.right} hint={c.hint} />)}</tr>
          </thead>
          <tbody>
            {!file && !error && Array.from({ length: 10 }).map((_, i) => (
              <tr key={i}><td colSpan={COLS.length} className="px-3 py-2"><div className="h-5 animate-pulse rounded bg-panel-2" /></td></tr>
            ))}
            {shown.slice((page - 1) * PAGE, page * PAGE).map((r, k) => {
              const key = `${r.src}:${r.sid}:${r.tf}`;
              const isOpen = open === key;
              const title = strategies[r.sid]?.title ?? r.sid;
              return (
                <Fragment key={key}>
                  <tr onClick={() => setOpen(isOpen ? "" : key)} aria-expanded={isOpen}
                    className={`cursor-pointer border-t border-line-soft ${isOpen ? "bg-signal-soft/60" : "hover:bg-panel"}`}>
                    <td className="num px-3 py-2 text-ink-faint">{(page - 1) * PAGE + k + 1}</td>
                    <td className="max-w-[24rem] px-3 py-2">
                      <div className="truncate" title={title}>{title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-ink-faint">
                        <span>{SOURCE_LABEL[r.src]}</span>
                        {r.dir && <span>· {DIR[r.dir] ?? r.dir}</span>}
                        {r.rep === "repaints" && <span className="rounded bg-loss/15 px-1.5 font-semibold text-loss" title="Trades changed when re-run with closed bars only">Repaints</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-dim">{r.tf}</td>
                    <td className="num px-3 py-2 text-right"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${scoreTone(r.cons)}`}>{num(r.cons, 0)}</span></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right">
                      <span className="text-ink">{int(r.good)}</span><span className="text-ink-faint"> / {int(r.stocks)}</span>
                      {r.avoid > 0 && <span className="ml-1 text-[0.7rem] text-loss" title="Stocks where the backtest is rated Avoid (repaints, or loses with realistic fills)">({r.avoid} avoid)</span>}
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-dim">{r.solid ? int(r.solid) : "—"}</td>
                    <td className="num px-3 py-2 text-right"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${scoreTone(r.score)}`}>{r.score == null ? "—" : num(r.score, 0)}</span></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right"><span className={tone(r.net)}>{pct(r.net, 1)}</span></td>
                    <td className="num px-3 py-2 text-right text-loss">{num(r.dd, 1)}</td>
                    <td className="num px-3 py-2 text-right text-loss">{num(r.add6, 1)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right">
                      <span className={tone(r.acct)}>{pct(r.acct, 1)}</span>
                      {r.acct_pos != null && <span className="ml-1 text-[0.7rem] text-ink-faint" title="Share of stocks where the account ended up">{num(r.acct_pos, 0)}% up</span>}
                    </td>
                    <td className="num px-3 py-2 text-right text-loss">{num(r.acct_dd, 1)}</td>
                    <td className="num px-3 py-2 text-right">{num(r.win, 1)}</td>
                    <td className="num px-3 py-2 text-right">{num(r.pf)}</td>
                    <td className="num px-3 py-2 text-right">{int(r.trades)}</td>
                    <td className="num px-3 py-2 text-right">{r.beat == null ? "—" : `${num(r.beat, 0)}%`}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-line-soft bg-panel/60">
                      <td />
                      <td colSpan={COLS.length - 1} className="px-3 py-3">
                        <div className="mb-2 text-xs text-ink-faint">
                          Best stocks for it on {r.tf} (held up, not Avoid; by Backtest Score){realistic && r.checked < r.stocks ? ` · ${r.checked} of ${r.stocks} re-run with realistic fills` : ""}
                        </div>
                        {r.best.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {r.best.map(([sym, sc, net]) => (
                              <Link key={sym} href={`/symbols/${sym}`} onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm hover:border-signal/60">
                                <span className="num font-medium">{sym}</span>
                                <span className={`num rounded px-1 text-xs ${scoreTone(sc)}`}>{sc == null ? "—" : num(sc, 0)}</span>
                                <span className={`num text-xs ${tone(net)}`}>{pct(net, 1)}</span>
                              </Link>
                            ))}
                          </div>
                        ) : <p className="text-sm text-ink-dim">It did not hold up on any stock of this watchlist.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {file && shown.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-3 py-10 text-center text-ink-dim">No strategies match these settings.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {file && shown.length > PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm text-ink-dim">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">←</button>
          <span className="num">{int(page)} / {int(pages)}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">→</button>
        </div>
      )}
      <p className="text-xs text-ink-faint">
        Strategies were tested on watchlists picked today, mostly stocks that rose, which flatters long-only strategies.
        A high rank is a reason to look closer, not a recommendation.
      </p>
    </div>
  );
}
