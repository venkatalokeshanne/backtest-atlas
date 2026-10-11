"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadDetails, loadStrategies, loadSymbol, SOURCE_LABEL, TIMEFRAMES, type Run, type RunDetail, type Strategy, type SymbolData } from "@/lib/data";
import { int, num, pct, tone } from "@/lib/format";
import { COLUMN, COLUMNS, DEFAULT_COLUMNS, DEFAULT_FILTERS, matches, TF_ORDER, type Filter } from "@/lib/columns";
import { ColumnsButton, FiltersButton, useStored } from "./TableTools";
import ReportPanel from "./ReportPanel";
import SymbolAnalytics from "./SymbolAnalytics";

const PAGE_SIZES = [20, 30, 50, 100];

export default function SymbolView({ symbol }: { symbol: string }) {
  const [data, setData] = useState<SymbolData | null>(null);
  const [strategies, setStrategies] = useState<Record<string, Strategy>>({});
  const [details, setDetails] = useState<Map<string, RunDetail> | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"strategies" | "analytics">("strategies");
  const [tf, setTf] = useState("");
  const [src, setSrc] = useState<"" | "tv" | "ts">("");
  const [heldOnly, setHeldOnly] = useStored<boolean>("atlas.heldOnly", false);
  const [showRepaint, setShowRepaint] = useStored<boolean>("atlas.showRepaint", false);
  const [q, setQ] = useState("");
  // table settings, remembered in this browser
  const [filters, setFilters] = useStored<Filter[]>("atlas.filters", DEFAULT_FILTERS);
  const [visible, setVisible] = useStored<string[]>("atlas.columns", DEFAULT_COLUMNS);
  const [pageSize, setPageSize] = useStored<number>("atlas.pagesize", 30);
  const [sort, setSort] = useState("score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Run | null>(null);

  useEffect(() => {
    setData(null); setDetails(null); setSelected(null);
    loadSymbol(symbol).then(setData).catch((e) => setError(String(e)));
    loadStrategies().then(setStrategies);
  }, [symbol]);
  // the report data is larger: fetch it once a row is opened
  useEffect(() => { if (selected && !details) loadDetails(symbol).then(setDetails); }, [selected, details, symbol]);
  useEffect(() => setPage(1), [tf, src, heldOnly, showRepaint, q, sort, dir, filters, pageSize]);

  const title = (r: Run) => strategies[r.sid]?.title ?? r.sid;
  const cols = useMemo(() => COLUMNS.filter((c) => c.fixed || visible.includes(c.key)), [visible]);
  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const out = data.runs.filter((r) =>
      (!tf || r.tf === tf) && (!src || r.src === src) && (!heldOnly || r.held) &&
      (showRepaint || r.repaint !== "repaints") && !strategies[r.sid]?.dup_of &&
      (!s || title(r).toLowerCase().includes(s)) && matches(r, strategies, filters));
    const col = COLUMN[sort];
    const val = (r: Run): any => {
      if (sort === "tf") return TF_ORDER.indexOf(r.tf);
      const v = col?.get(r, strategies);
      return typeof v === "string" ? v.toLowerCase() : v;
    };
    return out.sort((a, b) => {
      const av = val(a), bv = val(b);
      if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [data, tf, src, heldOnly, showRepaint, q, sort, dir, strategies, filters]);   // eslint-disable-line react-hooks/exhaustive-deps

  function sortBy(k: string) {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(COLUMN[k]?.kind === "text" ? 1 : -1); }
  }
  function downloadCsv() {
    const exp = COLUMNS.filter((c) => c.key !== "spark");
    const esc = (v: any) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const body = rows.map((r) => [...exp.map((c) => c.get(r, strategies)), r.repaint, r.asof].map(esc).join(","));
    const head = [...exp.map((c) => c.label), "Repaint check", "Recent figures as of"].map(esc).join(",");
    const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `${symbol}_backtests.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-loss">Could not load {symbol}: {error}</p>;
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <nav className="text-sm text-ink-faint" aria-label="Breadcrumb">
        <Link href="/symbols" className="hover:text-ink">Symbols</Link> <span className="px-1">/</span>
        <span className="text-ink-dim">{data ? `${data.name} (${data.exchange ? data.exchange + ":" : ""}${symbol})` : symbol}</span>
      </nav>

      <header className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{data?.name ?? symbol}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(data?.lists ?? []).map((l) => (
              <Link key={l} href={`/symbols?list=${encodeURIComponent(l)}`} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-dim hover:text-ink">{l}</Link>
            ))}
          </div>
        </div>
        {data?.last && (
          <div className="flex items-baseline gap-2">
            <span className="num text-3xl">{num(data.last.close)}</span>
            <span className={`num text-sm ${tone(data.last.chg_pct)}`}>{pct(data.last.chg_pct)}</span>
            <span className="text-xs text-ink-faint">close {data.last.date}</span>
          </div>
        )}
      </header>

      <div className="flex gap-1 self-start rounded-lg border border-line bg-panel p-1">
        {(["strategies", "analytics"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${tab === t ? "bg-panel-2 text-ink" : "text-ink-dim hover:text-ink"}`}>
            {t === "strategies" ? `Strategies${data ? ` (${int(rows.length)})` : ""}` : "Analytics"}
          </button>
        ))}
      </div>

      {tab === "analytics" && data && <SymbolAnalytics data={data} strategies={strategies} onOpen={(r) => { setTab("strategies"); setSelected(r); }} />}

      {tab === "strategies" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-2.5">
              <Pills value={tf} onChange={setTf} options={[["", "All TF"], ...TIMEFRAMES.map((t) => [t, t] as [string, string])]} />
              <Pills value={src} onChange={(v) => setSrc(v as any)} options={[["", "All sources"], ["tv", "TradingView"], ["ts", "TrendSpider"]]} />
              <FiltersButton filters={filters} onChange={setFilters} heldOnly={heldOnly} onHeldOnly={setHeldOnly}
                showRepaint={showRepaint} onShowRepaint={setShowRepaint} />
              <ColumnsButton visible={visible} onChange={setVisible} />
              <input id="strategy-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a strategy"
                className="min-w-0 flex-1 rounded-md border border-line bg-ground px-2.5 py-1 text-base sm:text-sm outline-none focus:border-signal/60" />
              <button onClick={downloadCsv} className="rounded-md border border-line px-2.5 py-1 text-sm text-ink-dim hover:text-ink" title="Download these rows as CSV">CSV</button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-panel text-left text-[0.7rem] uppercase tracking-wider text-ink-faint">
                  <tr>
                    {cols.map((c) => (
                      <Th key={c.key} k={c.key} label={c.key === "tf" ? "TF" : c.label} sort={sort} dir={dir} on={sortBy}
                        right={c.kind === "number"} hint={c.hint} sortable={c.key !== "spark"} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!data && Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}><td colSpan={cols.length} className="px-3 py-2"><div className="h-5 animate-pulse rounded bg-panel-2" /></td></tr>
                  ))}
                  {shown.map((r) => (
                    <tr key={r.id} onClick={() => setSelected(r)}
                      className={`cursor-pointer border-t border-line-soft ${selected?.id === r.id ? "bg-signal-soft/60" : "hover:bg-panel"}`}>
                      {cols.map((c) => c.key === "strategy" ? (
                        <td key={c.key} className="max-w-[22rem] px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{title(r)}</span>
                            {r.held && <span title="Held up: profitable per trade early and recently, beat holding" className="text-gain">✓</span>}
                            {r.repaint === "repaints" && <span className="rounded bg-loss/15 px-1 text-[0.62rem] font-semibold text-loss">REPAINTS</span>}
                          </div>
                          <div className="text-[0.7rem] text-ink-faint">{SOURCE_LABEL[r.src]}</div>
                        </td>
                      ) : (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.kind === "number" ? "num text-right" : "text-ink-dim"}`}>
                          {c.render ? c.render(r, strategies) : String(c.get(r, strategies) ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data && shown.length === 0 && (
                    <tr><td colSpan={cols.length} className="px-3 py-10 text-center text-ink-dim">No backtests match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && (
              <div className="flex items-center justify-between text-sm text-ink-dim">
                <span>{int(rows.length)} backtests · duplicates hidden</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5">Rows
                    <select id="page-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                      className="rounded-md border border-line bg-panel px-1.5 py-1 text-sm outline-none">
                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">←</button>
                  <span className="num">{page} / {pages}</span>
                  <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">→</button>
                </div>
              </div>
            )}
          </section>

          <ReportPanel run={selected} detail={selected ? details?.get(selected.id) ?? null : null} loading={!!selected && !details}
            strategy={selected ? strategies[selected.sid] : undefined} symbol={symbol} name={data?.name ?? symbol}
            onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}

function Pills({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line">
      {options.map(([v, l]) => (
        <button key={v || "all"} onClick={() => onChange(v)}
          className={`px-2.5 py-1 text-sm ${value === v ? "bg-signal-soft text-signal" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>{l}</button>
      ))}
    </div>
  );
}

function Th({ k, label, sort, dir, on, right, hint, sortable = true }: { k: string; label: string; sort: string; dir: 1 | -1; on: (k: string) => void; right?: boolean; hint?: string; sortable?: boolean }) {
  const active = sort === k;
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${right ? "text-right" : ""}`} title={hint}
      aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}>
      {sortable ? (
        <button onClick={() => on(k)} className={`uppercase tracking-wider ${active ? "text-signal" : "hover:text-ink"}`}>
          {label}{active ? (dir === 1 ? " ↑" : " ↓") : ""}
        </button>
      ) : <span className="uppercase tracking-wider">{label}</span>}
    </th>
  );
}
