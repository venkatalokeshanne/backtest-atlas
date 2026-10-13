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
  /** net % over the trailing 1 / 3 / 6 months, counted back from `asof` (TradingView: last bar; TrendSpider: its run date) */
  m1: number | null; m3: number | null; m6: number | null; asof: string | null;
  /** Realistic fills (Foresight strict model + spread): "survives" | "fails"; null = not fill-checked */
  fills?: "survives" | "fails" | null;
  r_score?: number | null; r_held?: boolean | null; r_net?: number | null; r_dd?: number | null; r_trades?: number | null;
  r_win?: number | null; r_pf?: number | null; r_avg?: number | null; r_edge?: number | null;
  r_m1?: number | null; r_m3?: number | null; r_m6?: number | null; r_t1?: number | null; r_t3?: number | null; r_t6?: number | null;
  r_w1?: number | null; r_w3?: number | null; r_w6?: number | null; r_pf1?: number | null; r_pf3?: number | null; r_pf6?: number | null;
  r_breadth?: [number, number] | null; acct?: number | null; acct_dd?: number | null;
  luck?: "unlikely" | "possible" | "likely" | null; tested?: number | null;
  /** average of the max drawdown under each of the last 6 months (saved trades; null until archived) */
  add6?: number | null; r_add6?: number | null;
  /** set by view(): which numbers this row is showing */
  mode?: "realistic" | "tv";
};
export type Fills = "realistic" | "tv";
const SWAP = ["score", "held", "net", "dd", "trades", "win", "pf", "avg", "edge", "m1", "m3", "m6",
  "t1", "t3", "t6", "w1", "w3", "w6", "pf1", "pf3", "pf6", "breadth", "spark", "add6"] as const;
/** The row as shown: realistic-fill numbers when chosen and available, TradingView-fill numbers otherwise. */
export function view(r: Run, fills: Fills): Run {
  if (fills === "tv" || !r.fills) return { ...r, mode: "tv" };
  const o: any = { ...r, mode: "realistic" };
  for (const k of SWAP) o[k] = (r as any)[`r_${k}`];
  return o as Run;
}
/** From every saved trade: drawdowns for the trailing 1/3/6 months and each of the last 6 months (oldest first, as
 *  `recent.months`), the worst drawdown with its dates, where it stands now, year by year, longest streaks. */
export type Extras = {
  dd1: number; dd3: number; dd6: number; mdd: number[];
  worst: { dd: number; peak: string; trough: string; rec: string | null; n: number; days: number; rdays: number | null } | null;
  cur: { dd: number; since: string };
  years: [string, number, number, number, number][];   // year, trades, net %, max drawdown, win %
  streak: { win: number; loss: number };
};
export type PeriodStat = { n: number; net?: number; win?: number; pf?: number | null };
export type Window = { n?: number; avg?: number; pf?: number; win?: number; net?: number; dd?: number; edge?: number; bh?: number; from?: string };
export type RunDetail = {
  id: string; parts: Record<"consistency" | "breadth" | "edge" | "practicality" | "recent", number | null>;
  /** win rate >= 85% or PF >= 5: score multiplied by 0.6 until verified */
  fills_flag?: boolean;
  r_parts?: RunDetail["parts"] | null; r_recent?: RunDetail["recent"]; r_windows?: Record<string, Window> | null; r_fills_flag?: boolean | null;
  med: number | null; longs: number | null; shorts: number | null; bars_held: number | null;
  sharpe: number | null; sortino: number | null; tpm: number | null; to: string | null; bars: number | null;
  windows: Record<string, Window>;
  curve: { t: string[]; s: number[]; b: number[]; start: string } | null;
  /** figures from the saved trade list (TradingView fills / realistic fills), once the stock's trades are archived */
  x?: Extras | null; r_x?: Extras | null;
  /** the same backtest's curve with realistic fills, when stored */
  r_curve?: { t: string[]; s: number[]; b: number[]; start: string } | null;
  recent: { p1m: PeriodStat; p3m: PeriodStat; p6m: PeriodStat; months: (PeriodStat & { m: string })[] } | null;
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
/** The reports behind one stock's rows of one timeframe (one file per stock and timeframe). */
export async function loadDetails(symbol: string, tf: string): Promise<Map<string, RunDetail>> {
  const d = await getJSON<any>(`/data/symbol/${symbol}.${tf}.detail.json`);
  return new Map(decode<RunDetail>(d.cols, d.runs).map((r) => [r.id, r]));
}
/** The timeframe of a row id ("tv:<sid>:<tf>" / "ts:<name>:<tf>"). */
export const tfOfId = (id: string) => id.slice(id.lastIndexOf(":") + 1);

export type BacktestsPage = { total: number; unchecked: number; rows: (Run & { sym: string })[]; raws: (Run & { sym: string })[] };
