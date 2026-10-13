"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadIndex, type SymbolIndex } from "@/lib/data";

/** Top bar around every page: Explorer on the left, the symbol search, All backtests on the right. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<SymbolIndex | null>(null);
  useEffect(() => { loadIndex().then(setIndex).catch(() => {}); }, []);
  const path = usePathname();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ground/90 px-4 py-2.5 backdrop-blur sm:px-6">
        <NavIcon href="/symbols" label="Explore by symbol" active={path === "/symbols" || path.startsWith("/symbols/")}>
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" />
        </NavIcon>
        <div className="flex min-w-0 flex-1 justify-center"><SymbolSearch index={index} /></div>
        <NavIcon href="/backtests" label="All backtests" active={path === "/backtests"}>
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 9v11" />
        </NavIcon>
      </header>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function NavIcon({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} aria-current={active ? "page" : undefined}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${active ? "border-signal/50 bg-signal-soft text-signal" : "border-line text-ink-dim hover:text-ink"}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{children}</svg>
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
        className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-base sm:text-sm outline-none placeholder:text-ink-faint focus:border-signal/60" />
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
