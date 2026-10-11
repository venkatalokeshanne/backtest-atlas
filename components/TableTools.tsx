"use client";

import { useEffect, useRef, useState } from "react";
import { COLUMN, COLUMNS, DEFAULT_COLUMNS, DEFAULT_FILTERS, type Filter } from "@/lib/columns";

/** Popover shell: opens under its button, closes on outside click or Escape. */
function Popover({ label, badge, children }: { label: React.ReactNode; badge?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${open ? "border-signal/50 bg-signal-soft text-signal" : "border-line text-ink-dim hover:text-ink"}`}>
        {label}
        {badge ? <span className="num rounded bg-signal/20 px-1.5 text-xs text-signal">{badge}</span> : null}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-24 z-40 rounded-xl border border-line bg-panel p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-[30rem]">
          {children}
        </div>
      )}
    </div>
  );
}

const selectCls = "rounded-md border border-line bg-ground px-2 py-1.5 text-sm outline-none focus:border-signal/60";

export function FiltersButton({ filters, onChange }: { filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const active = filters.filter((f) => f.value.trim() !== "").length;
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Popover badge={active} label={<><FunnelIcon /> Filters</>}>
      <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Filters</div>
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
        <button onClick={() => onChange(DEFAULT_FILTERS)} className="text-xs text-ink-faint hover:text-ink">Reset</button>
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
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch {}
  }, [key]);
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch {} };
  return [v, set];
}
