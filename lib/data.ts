// Static data built by scripts/build_data.py, served from /public/data and read by the browser.

export type Source = "tv" | "ts";
export const SOURCE_LABEL: Record<Source, string> = { tv: "TradingView", ts: "TrendSpider" };
export const TIMEFRAMES = ["5m", "15m", "1H", "Daily"] as const;

export type SymbolSummary = {
  symbol: string; name: string; exchange: string; type: string;
  last: { close: number; chg_pct: number; date: string } | null;
  lists: string[]; strategies: number; backtests: number; held: number;
  best: { sid: string; tf: string; score: number; src: Source } | null;
};
export type SymbolIndex = { generated: string; lists: string[]; symbols: SymbolSummary[] };

export type Run = {
  id: string; src: Source; sid: string; tf: string; score: number | null; held: boolean;
  repaint: "repaints" | "vectors_present" | "clean" | null; breadth: [number, number];
  net: number | null; dd: number | null; trades: number | null; win: number | null; pf: number | null;
  avg: number | null; edge: number | null; bh: number | null; from: string | null;
};
export type Window = { n?: number; avg?: number; pf?: number; win?: number; net?: number; dd?: number; edge?: number; bh?: number; from?: string };
export type RunDetail = {
  id: string; parts: Record<"consistency" | "breadth" | "edge" | "practicality", number>;
  med: number | null; longs: number | null; shorts: number | null; bars_held: number | null;
  sharpe: number | null; sortino: number | null; tpm: number | null; to: string | null; bars: number | null;
  windows: Record<string, Window>;
  curve: { t: string[]; s: number[]; b: number[]; start: string } | null;
};
export type SymbolData = {
  symbol: string; name: string; exchange: string; type: string;
  last: SymbolSummary["last"]; lists: string[];
  stats: { backtests: number; strategies: number; tv: number; ts: number; held: number; held_strategies: number; beat_bh_pct: number | null;
    median_net: number | null; avg_win: number | null; median_dd: number | null; repainting: number };
  runs: Run[];
};
export type Strategy = { title: string; author: string | null; url: string | null; src: Source; dup_of: string | null;
  repaint: Record<string, string>; family?: string; setup?: string };

function decode<T>(cols: string[], rows: any[][]): T[] {
  return rows.map((r) => { const o: any = {}; cols.forEach((c, i) => (o[c] = r[i])); return o as T; });
}

const cache = new Map<string, Promise<any>>();
function getJSON<T>(url: string): Promise<T> {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }));
  return cache.get(url)!;
}

export const loadIndex = () => getJSON<SymbolIndex>("/data/symbols.json");
export const loadStrategies = () => getJSON<Record<string, Strategy>>("/data/strategies.json");
export async function loadSymbol(symbol: string): Promise<SymbolData> {
  const d = await getJSON<any>(`/data/symbol/${symbol}.json`);
  return { ...d, runs: decode<Run>(d.cols, d.runs) };
}
export async function loadDetails(symbol: string): Promise<Map<string, RunDetail>> {
  const d = await getJSON<any>(`/data/symbol/${symbol}.detail.json`);
  return new Map(decode<RunDetail>(d.cols, d.runs).map((r) => [r.id, r]));
}
