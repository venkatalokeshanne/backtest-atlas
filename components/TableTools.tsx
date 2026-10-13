"use client";

import { useEffect, useRef, useState } from "react";
import { COLUMN, COLUMNS, DEFAULT_COLUMNS, DEFAULT_FILTERS, type Filter, PRESETS, type Preset } from "@/lib/columns";

/** Popover shell: opens under its button, closes on outside click or Escape. */
function Popover({ label, badge, children }: { label: React.ReactNode; badge?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // open towards the side with room: from the button's left edge, or from its right edge near the screen's right side
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAlignRight(r.left + 480 > window.innerWidth - 16);
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${open ? "border-signal/50 bg-signal-soft text-signal" : "border-line text-ink-dim hover:text-ink"}`}>
        {label}
        {badge ? <span className="num rounded bg-signal/20 px-1.5 text-xs text-signal">{badge}</span> : null}
      </button>
      {open && (
        <div className={`fixed inset-x-3 top-24 z-40 rounded-xl border border-line bg-panel p-3 shadow-2xl sm:absolute sm:inset-x-auto ${alignRight ? "sm:right-0" : "sm:left-0"} sm:top-full sm:mt-1.5 sm:w-[30rem] sm:max-w-[calc(100vw-2rem)]`}>
          {children}
        </div>
      )}
    </div>
  );
}

const selectCls = "rounded-md border border-line bg-ground px-2 py-1.5 text-sm outline-none focus:border-signal/60";

export function FiltersButton({ filters, onChange, heldOnly, onHeldOnly, showRepaint, onShowRepaint, source, onSource, onlyChecked, onOnlyChecked, realistic, onRealistic, verdict, onVerdict, activePreset, onPreset }: {
  filters: Filter[]; onChange: (f: Filter[]) => void;
  heldOnly: boolean; onHeldOnly: (v: boolean) => void; showRepaint: boolean; onShowRepaint: (v: boolean) => void;
  source: string; onSource: (v: string) => void; onlyChecked: boolean; onOnlyChecked: (v: boolean) => void;
  realistic: boolean; onRealistic: (v: boolean) => void; verdict: string; onVerdict: (v: string) => void;
  /** the preset now in force ("" = none) and the switch */
  activePreset?: string; onPreset?: (key: string) => void;
}) {
  const active = filters.filter((f) => f.value.trim() !== "").length + (heldOnly ? 1 : 0) + (showRepaint ? 1 : 0) + (source ? 1 : 0)
    + (onlyChecked ? 1 : 0) + (realistic ? 1 : 0) + (verdict ? 1 : 0);
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Popover badge={active} label={<><FunnelIcon /> Filters</>}>
      <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Filters</div>
      {onPreset && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="w-[4.3rem] pl-1 text-ink-faint">Presets</span>
          {Object.entries(PRESETS).map(([k, p]) => {
            const on = activePreset === k;
            return (
              <button key={k} onClick={() => onPreset(k)} aria-pressed={on}
                title={on ? "On: click to switch off and get your previous settings back" : p.hint}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium ${on
                  ? "border-signal bg-signal text-ground" : "border-line text-ink-dim hover:border-signal/60 hover:text-ink"}`}>
                <span aria-hidden="true" className={`grid h-3.5 w-3.5 place-items-center rounded-sm border text-[0.6rem] leading-none ${on ? "border-ground" : "border-ink-faint"}`}>{on ? "✓" : ""}</span>
                {p.label}{on ? " · on" : ""}
              </button>
            );
          })}
          <span className="text-xs text-ink-faint">{activePreset ? "click again to switch off and restore your settings" : "sets the filters below; change anything after"}</span>
        </div>
      )}
      <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line-soft bg-ground px-3 py-2"
        title="Off: numbers as TradingView's Strategy Tester shows them. On: the same backtests re-run with realistic fills (exits from the next bar, stop before target, trailing on closes, spread).">
        <span className="text-sm">
          <span className="text-ink">Realistic fills</span>
          <span className="block text-xs text-ink-faint">{realistic ? "Re-run with realistic exits and spread" : "Off: TradingView's fills, as before"}</span>
        </span>
        <input id="realistic-fills" type="checkbox" role="switch" checked={realistic} onChange={(e) => onRealistic(e.target.checked)} className="sr-only" />
        <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${realistic ? "bg-signal" : "bg-panel-2 ring-1 ring-line"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-ground transition-all ${realistic ? "left-[1.1rem]" : "left-0.5"}`} />
        </span>
      </label>
      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm text-ink-dim">
        <span className="w-[4.3rem] pl-1 text-ink-faint">Verdict</span>
        <div className="flex overflow-hidden rounded-md border border-line">
          {[["", "All"], ["solid", "Solid"], ["caution", "Caution"], ["avoid", "Avoid"]].map(([v, l]) => (
            <button key={v || "all"} onClick={() => onVerdict(v)}
              className={`px-2.5 py-1 text-sm ${verdict === v ? "bg-signal-soft text-signal" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm text-ink-dim">
        <span className="w-[4.3rem] pl-1 text-ink-faint">Source</span>
        <div className="flex overflow-hidden rounded-md border border-line">
          {[["", "All"], ["tv", "TradingView"], ["ts", "TrendSpider"]].map(([v, l]) => (
            <button key={v || "all"} onClick={() => onSource(v)}
              className={`px-2.5 py-1 text-sm ${source === v ? "bg-signal-soft text-signal" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 border-b border-line-soft pb-3 text-sm text-ink-dim">
        <label className="flex items-center gap-2" title="Profitable per trade early and recently, and beat holding the stock">
          <input id="held-only" type="checkbox" checked={heldOnly} onChange={(e) => onHeldOnly(e.target.checked)} className="accent-[var(--color-signal)]" />
          Held up only
        </label>
        <label className="flex items-center gap-2" title="Backtests whose trades changed when re-run with closed bars only (they used future data)">
          <input id="show-repaint" type="checkbox" checked={showRepaint} onChange={(e) => onShowRepaint(e.target.checked)} className="accent-[var(--color-signal)]" />
          Show repainting
        </label>
        <label className="flex items-center gap-2" title="Only backtests re-run with realistic fills (TrendSpider results never are)">
          <input id="only-checked" type="checkbox" checked={onlyChecked} onChange={(e) => onOnlyChecked(e.target.checked)} className="accent-[var(--color-signal)]" />
          Only fill-checked
        </label>
      </div>
      <div className="flex flex-col gap-2">
        {filters.map((f, i) => {
          const col = COLUMN[f.key];
          return (
            <div key={i} className="grid grid-cols-[4.3rem_minmax(0,1fr)_4.4rem_5.5rem_1.6rem] items-center gap-1.5">
              {i === 0 ? <span className="pl-1 text-sm text-ink-faint">Where</span> : (
                <select aria-label="Join" value={f.join} onChange={(e) => set(i, { join: e.target.value as Filter["join"] })} className={selectCls}>
                  <option value="and">and</option><option value="or">or</option>
                </select>
              )}
              <select aria-label="Field" value={f.key} className={selectCls}
                onChange={(e) => { const c = COLUMN[e.target.value]; set(i, { key: e.target.value, op: c.kind === "number" ? ">=" : "contains", value: "" }); }}>
                {COLUMNS.filter((c) => c.key !== "spark").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select aria-label="Condition" value={f.op} onChange={(e) => set(i, { op: e.target.value as Filter["op"] })} className={selectCls}>
                {col?.kind === "number"
                  ? <><option value=">=">≥</option><option value="<=">≤</option></>
                  : <><option value="contains">has</option><option value="is">is</option></>}
              </select>
              <input aria-label="Value" value={f.value} inputMode={col?.kind === "number" ? "decimal" : "text"}
                onChange={(e) => set(i, { value: e.target.value })} className={`${selectCls} num min-w-0`} />
              <button aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}
                className="grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-panel-2 hover:text-ink">✕</button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => onChange([...filters, { join: "and", key: "net", op: ">=", value: "" }])}
          className="text-sm text-signal hover:underline">+ Add filter</button>
        <button onClick={() => { onChange(DEFAULT_FILTERS); onHeldOnly(false); onShowRepaint(false); onSource(""); onOnlyChecked(false); onRealistic(false); onVerdict(""); }} className="text-xs text-ink-faint hover:text-ink">Reset</button>
      </div>
    </Popover>
  );
}

export function ColumnsButton({ visible, onChange }: { visible: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(visible.includes(k) ? visible.filter((x) => x !== k)
    : COLUMNS.map((c) => c.key).filter((x) => x === k || visible.includes(x)));     // keep the registry order
  return (
    <Popover label={<><ColumnsIcon /> Columns</>}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Columns</span>
        <button onClick={() => onChange(DEFAULT_COLUMNS)} className="text-xs text-ink-faint hover:text-ink">Reset</button>
      </div>
      <ul className="max-h-[22rem] overflow-y-auto pr-1">
        {COLUMNS.filter((c) => !c.fixed).map((c) => {
          const on = visible.includes(c.key);
          return (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-panel-2" title={c.hint}>
                <span className={on ? "text-ink" : "text-ink-dim"}>{c.label}</span>
                <input type="checkbox" role="switch" checked={on} onChange={() => toggle(c.key)} className="peer sr-only" />
                <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-signal" : "bg-panel-2 ring-1 ring-line"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-ground transition-all ${on ? "left-[1.1rem]" : "left-0.5"}`} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

function FunnelIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>;
}
function ColumnsIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>;
}

/** Per-viewer memory for table settings; works without storage (private windows etc.). */
/** Columns added after people had saved their own choice: shown to them once, when the saved choice is read. */
const NEW_COLUMNS: [flag: string, col: string][] = [["atlas.dirAdded", "dir"], ["atlas.add6Added", "add6"]];

/** The table's visible columns, remembered in this browser, with newly added columns switched on once. */
export function useColumns(initial: string[]): [string[], (v: string[]) => void] {
  const [v, setV] = useState<string[]>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem("atlas.columns");
      if (!s) { NEW_COLUMNS.forEach(([flag]) => localStorage.setItem(flag, "true")); return; }
      let cols: string[] = JSON.parse(s);
      for (const [flag, col] of NEW_COLUMNS) {
        if (localStorage.getItem(flag)) continue;
        if (!cols.includes(col)) cols = [...cols, col];
        localStorage.setItem(flag, "true");
      }
      localStorage.setItem("atlas.columns", JSON.stringify(cols));
      setV(cols);
    } catch {}
  }, []);
  const set = (x: string[]) => { setV(x); try { localStorage.setItem("atlas.columns", JSON.stringify(x)); } catch {} };
  return [v, set];
}

/** The table settings a preset sets (and puts back when it is switched off). */
export type TableSettings = {
  realistic: boolean; verdict: string; tf: string; filters: Filter[]; sort: string; dir: 1 | -1;
  src: string; heldOnly: boolean; showRepaint: boolean; onlyChecked: boolean;
};
const presetSettings = (p: Preset): TableSettings => ({
  realistic: p.realistic, verdict: p.verdict, tf: p.tf, filters: p.filters, sort: p.sort, dir: p.dir,
  src: "", heldOnly: false, showRepaint: false, onlyChecked: false,
});
const sameFilters = (a: Filter[], b: Filter[]) =>
  JSON.stringify(a.filter((f) => f.value.trim() !== "")) === JSON.stringify(b.filter((f) => f.value.trim() !== ""));
const sameSettings = (a: TableSettings, b: TableSettings) =>
  a.realistic === b.realistic && a.verdict === b.verdict && a.tf === b.tf && sameFilters(a.filters, b.filters) && a.sort === b.sort &&
  a.dir === b.dir && a.src === b.src && a.heldOnly === b.heldOnly && a.showRepaint === b.showRepaint && a.onlyChecked === b.onlyChecked;

/** Presets as on/off switches: on = the table matches the preset exactly; switching on remembers the settings it
 *  replaced, switching off puts them back. Changing anything afterwards simply leaves the preset off. */
export function usePresets(current: TableSettings, apply: (s: TableSettings) => void) {
  const [before, setBefore] = useStored<TableSettings | null>("atlas.presetBefore", null);
  const active = Object.keys(PRESETS).find((k) => sameSettings(current, presetSettings(PRESETS[k]))) ?? "";
  const toggle = (key: string) => {
    if (active === key) { apply(before ?? { ...presetSettings(PRESETS[key]), realistic: false, verdict: "", tf: "", filters: DEFAULT_FILTERS }); setBefore(null); }
    else { if (!active) setBefore(current); apply(presetSettings(PRESETS[key])); }
  };
  return { active, toggle };
}

export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch {}
  }, [key]);
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch {} };
  return [v, set];
}
