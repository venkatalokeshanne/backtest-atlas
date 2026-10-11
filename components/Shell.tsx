"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadIndex, type SymbolIndex } from "@/lib/data";

/** Sidebar + top bar with a symbol search, around every page. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<SymbolIndex | null>(null);
  const [open, setOpen] = useState(false);       // mobile sidebar
  useEffect(() => { loadIndex().then(setIndex).catch(() => {}); }, []);
  const path = usePathname();
  const params = useSearchParams();
  const activeList = path === "/symbols" ? params.get("list") ?? "" : null;

  const nav = (
    <nav className="flex flex-col gap-6 px-3 py-5 text-sm">
      <Link href="/symbols" className="flex items-center gap-2.5 px-2" onClick={() => setOpen(false)}>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-signal-soft text-signal">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" />
          </svg>
        </span>
        <span className="font-semibold tracking-tight">Backtest Atlas</span>
      </Link>
      <div>
        <div className="px-2 pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Discover</div>
        <SideLink href="/symbols" active={activeList === ""} onClick={() => setOpen(false)}>Explore by symbol</SideLink>
        <div className="ml-3 mt-1 flex flex-col border-l border-line pl-2">
          {(index?.lists ?? []).map((l) => (
            <SideLink key={l} href={`/symbols?list=${encodeURIComponent(l)}`} active={activeList === l} onClick={() => setOpen(false)} small>
              {l}
            </SideLink>
          ))}
        </div>
        <span className="mt-1 flex cursor-default items-center justify-between rounded-md px-2 py-1.5 text-ink-faint">
          Top backtests <span className="rounded bg-panel-2 px-1.5 text-[0.62rem] uppercase tracking-wider">soon</span>
        </span>
        <span className="flex cursor-default items-center justify-between rounded-md px-2 py-1.5 text-ink-faint">
          Strategies <span className="rounded bg-panel-2 px-1.5 text-[0.62rem] uppercase tracking-wider">soon</span>
        </span>
      </div>
      <p className="mt-auto px-2 text-xs leading-relaxed text-ink-faint">
        Every result is a historical backtest, not a forecast or advice.
        {index ? ` Data as of ${index.generated}.` : ""}
      </p>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel lg:flex">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-64 flex-col overflow-y-auto border-r border-line bg-panel" onClick={(e) => e.stopPropagation()}>{nav}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ground/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button className="rounded-md border border-line p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <SymbolSearch index={index} />
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function SideLink({ href, active, children, small, onClick }: { href: string; active: boolean; children: React.ReactNode; small?: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick}
      className={`block rounded-md px-2 ${small ? "py-1 text-[0.82rem]" : "py-1.5"} ${active ? "bg-signal-soft text-signal" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>
      {children}
    </Link>
  );
}

function SymbolSearch({ index }: { index: SymbolIndex | null }) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const router = useRouter();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !index) return [];
    return index.symbols.filter((x) => x.symbol.toLowerCase().startsWith(s) || x.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, index]);
  const go = (sym: string) => { setQ(""); router.push(`/symbols/${sym}`); };
  return (
    <div className="relative w-full max-w-md">
      <input id="symbol-search" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0].symbol); }}
        placeholder="Search a symbol — INFQ, NVDA, Apple…" aria-label="Search a symbol"
        className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-signal/60" />
      {focus && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
          {hits.map((h) => (
            <li key={h.symbol}>
              <button onMouseDown={() => go(h.symbol)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-panel-2">
                <span className="num w-14 font-semibold">{h.symbol}</span>
                <span className="truncate text-ink-dim">{h.name}</span>
                <span className="ml-auto text-xs text-ink-faint">{h.strategies} strategies</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
