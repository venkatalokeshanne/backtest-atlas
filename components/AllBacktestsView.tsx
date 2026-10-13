"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadDetails, loadIndex, loadStrategies, SOURCE_LABEL, TIMEFRAMES, type BacktestsPage, type Fills, type Run, type RunDetail, type Strategy } from "@/lib/data";
import { int } from "@/lib/format";
import { COLUMN, COLUMNS, DEFAULT_COLUMNS, DEFAULT_FILTERS, VerdictBadge, type Col, type Filter, type Verdict } from "@/lib/columns";
import { ColumnsButton, FiltersButton, useColumns, usePresets, useStored, type TableSettings } from "./TableTools";
import ReportPanel from "./ReportPanel";
import { Pills, Th } from "./SymbolView";

const PAGE_SIZES = [20, 30, 50, 100];
type Row = Run & { sym: string };
const STOCK: Col = { key: "sym", label: "Stock", kind: "text", fixed: true, get: (r) => (r as Row).sym };

/** Every backtest of every stock in one table. The server filters, sorts and pages (/api/backtests), so the browser
 *  only receives the rows on screen; the settings are the same ones the stock pages use and remember. */
export default function AllBacktestsView() {
  const [strategies, setStrategies] = useState<Record<string, Strategy>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [tf, setTf] = useStored<string>("atlas.tf", "");
  const [realisticOn, setRealisticOn] = useStored<boolean>("atlas.realistic", false);
  const fills: Fills = realisticOn ? "realistic" : "tv";
  const [onlyChecked, setOnlyChecked] = useStored<boolean>("atlas.onlyChecked", false);
  const [src, setSrc] = useStored<"" | "tv" | "ts">("atlas.source", "");
  const [heldOnly, setHeldOnly] = useStored<boolean>("atlas.heldOnly", false);
  const [verdict, setVerdict] = useStored<"" | Verdict>("atlas.verdict", "");
  const [showRepaint, setShowRepaint] = useStored<boolean>("atlas.showRepaint", false);
  const [storedFilters, setFilters] = useStored<Filter[]>("atlas.filters", DEFAULT_FILTERS);
  const filters = useMemo(() => storedFilters.filter((f) => COLUMN[f.key]), [storedFilters]);
  const [visible, setVisible] = useColumns(DEFAULT_COLUMNS);
  const [pageSize, setPageSize] = useStored<number>("atlas.pagesize", 30);
  const [sort, setSort] = useStored<string>("atlas.sort", "score");
  const [dir, setDir] = useStored<1 | -1>("atlas.dir", -1);
  const presets = usePresets(
    { realistic: realisticOn, verdict, tf, filters, sort, dir, src, heldOnly, showRepaint, onlyChecked },
    (s: TableSettings) => {
      setRealisticOn(s.realistic); setVerdict(s.verdict as "" | Verdict); setTf(s.tf); setFilters(s.filters); setSort(s.sort); setDir(s.dir);
      setSrc(s.src as "" | "tv" | "ts"); setHeldOnly(s.heldOnly); setShowRepaint(s.showRepaint); setOnlyChecked(s.onlyChecked);
    });
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BacktestsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ row: Row; raw: Row } | null>(null);
  const [detail, setDetail] = useState<{ id: string; detail: RunDetail | null } | null>(null);

  useEffect(() => {
    loadStrategies().then(setStrategies);
    loadIndex().then((ix) => setNames(Object.fromEntries(ix.symbols.map((s) => [s.symbol, s.name]))));
  }, []);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [tf, src, heldOnly, showRepaint, qDebounced, sort, dir, filters, pageSize, fills, onlyChecked, verdict]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ tf, src, verdict, fills, q: qDebounced, sort, dir: String(dir) });
    if (heldOnly) p.set("held", "1");
    if (showRepaint) p.set("rep", "1");
    if (onlyChecked) p.set("checked", "1");
    const active = filters.filter((f) => f.value.trim() !== "");
    if (active.length) p.set("filters", JSON.stringify(active));
    return p;
  }, [tf, src, verdict, fills, qDebounced, sort, dir, heldOnly, showRepaint, onlyChecked, filters]);

  // one request per change; a newer request cancels the older one, and the old rows stay on screen until it answers
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setLoading(true);
    const p = new URLSearchParams(params); p.set("page", String(page)); p.set("size", String(pageSize));
    fetch(`/api/backtests?${p}`, { signal: c.signal })
      .then((r) => { if (!r.ok) throw new Error(`server answered ${r.status}`); return r.json(); })
      .then((d: BacktestsPage) => {
        setData(d); setError(""); setLoading(false);
        // fetch the next page ahead (the browser keeps it), so → is instant
        if (page * pageSize < d.total) { const n = new URLSearchParams(p); n.set("page", String(page + 1)); fetch(`/api/backtests?${n}`).catch(() => {}); }
      })
      .catch((e) => { if (e.name !== "AbortError") { setError(String(e.message ?? e)); setLoading(false); } });
    return () => c.abort();
  }, [params, page, pageSize]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    const { row } = selected;
    loadDetails(row.sym, row.tf).then((m) => live && setDetail({ id: `${row.sym}|${row.id}`, detail: m.get(row.id) ?? null }));
    return () => { live = false; };
  }, [selected]);

  const cols = useMemo(() => {
    const c = COLUMNS.filter((x) => x.fixed || visible.includes(x.key));
    return [c[0], STOCK, ...c.slice(1)];
  }, [visible]);
  const title = (r: Run) => strategies[r.sid]?.title ?? r.sid;
  function sortBy(k: string) {
    if (sort === k) setDir(dir === 1 ? -1 : 1);
    else { setSort(k); setDir(k === "sym" || COLUMN[k]?.kind === "text" ? 1 : -1); }
  }
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selKey = selected ? `${selected.row.sym}|${selected.row.id}` : "";

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">All backtests</h1>
        <p className="mt-1 text-sm text-ink-dim">Every strategy on every stock, in one table: the same filters, columns and report as the stock pages.</p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-2.5">
            <Pills value={tf} onChange={setTf} options={[["", "All TF"], ...TIMEFRAMES.map((t) => [t, t] as [string, string])]} />
            <FiltersButton filters={filters} onChange={setFilters} heldOnly={heldOnly} onHeldOnly={setHeldOnly}
              showRepaint={showRepaint} onShowRepaint={setShowRepaint} source={src} onSource={(v) => setSrc(v as "" | "tv" | "ts")}
              onlyChecked={onlyChecked} onOnlyChecked={setOnlyChecked} realistic={realisticOn} onRealistic={setRealisticOn}
              verdict={verdict} onVerdict={(v) => setVerdict(v as "" | Verdict)}
                activePreset={presets.active} onPreset={presets.toggle} />
            <ColumnsButton visible={visible} onChange={setVisible} />
            <input id="all-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a strategy or stock"
              className="min-w-0 flex-1 rounded-md border border-line bg-ground px-2.5 py-1 text-base sm:text-sm outline-none focus:border-signal/60" />
            <a href={`/api/backtests?${params}&format=csv`} className="rounded-md border border-line px-2.5 py-1 text-sm text-ink-dim hover:text-ink"
              title="Download these rows as CSV (first 10,000 in the current order)">CSV</a>
          </div>

          {fills === "realistic" && data && data.unchecked > 0 && (
            <p className="text-xs text-ink-faint">
              Fill-checked backtests come first. {int(data.unchecked)} below them are not fill-checked
              (TrendSpider, or not re-run) and still show TradingView-fill numbers.
            </p>
          )}
          {error && <p className="text-sm text-loss">Could not load the backtests ({error}). Try again in a moment.</p>}
          <div className={`overflow-x-auto rounded-xl border border-line transition-opacity ${loading && data ? "opacity-60" : ""}`} aria-busy={loading}>
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
                {data?.rows.map((r, k) => {
                  const key = `${r.sym}|${r.id}`;
                  return (
                    <tr key={key} onClick={() => setSelected({ row: r, raw: data.raws[k] ?? r })}
                      className={`cursor-pointer border-t border-line-soft ${selKey === key ? "bg-signal-soft/60" : "hover:bg-panel"}`}>
                      {cols.map((c) => c.key === "strategy" ? (
                        <td key={c.key} className="max-w-[22rem] px-3 py-2">
                          <div className="truncate">{title(r)}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span className="text-[0.7rem] text-ink-faint">{SOURCE_LABEL[r.src]}</span>
                            <VerdictBadge r={r} />
                          </div>
                        </td>
                      ) : c.key === "sym" ? (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2">
                          <Link href={`/symbols/${r.sym}`} onClick={(e) => e.stopPropagation()} title={names[r.sym]}
                            className="num font-medium text-ink hover:text-signal">{r.sym}</Link>
                        </td>
                      ) : (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.kind === "number" ? "num text-right" : "text-ink-dim"}`}>
                          {c.render ? c.render(r, strategies) : String(c.get(r, strategies) ?? "—")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {data && !loading && data.rows.length === 0 && (
                  <tr><td colSpan={cols.length} className="px-3 py-10 text-center text-ink-dim">No backtests match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data && (
            <div className="flex items-center justify-between text-sm text-ink-dim">
              <span>{int(total)} backtests</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5">Rows
                  <select id="page-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                    className="rounded-md border border-line bg-panel px-1.5 py-1 text-sm outline-none">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">←</button>
                <span className="num whitespace-nowrap">{int(page)} / {int(pages)}</span>
                <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-line px-2.5 py-1 disabled:opacity-40">→</button>
              </div>
            </div>
          )}
        </section>

        <ReportPanel run={selected?.row ?? null} raw={selected?.raw ?? null}
          detail={selected && detail?.id === selKey ? detail.detail : null} loading={!!selected && detail?.id !== selKey}
          strategy={selected ? strategies[selected.row.sid] : undefined}
          symbol={selected?.row.sym ?? ""} name={selected ? names[selected.row.sym] ?? selected.row.sym : ""}
          onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
