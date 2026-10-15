import { SOURCE_LABEL, TIMEFRAMES, type Run, type Strategy } from "./data";
import { int, num, pct, scoreTone, tone } from "./format";

/** Every column the backtest table can show, filter on and export. One definition per column. */
export type Col = {
  key: string;
  label: string;
  kind: "number" | "text";
  get: (r: Run, s: Record<string, Strategy>) => number | string | null;
  render?: (r: Run, s: Record<string, Strategy>) => React.ReactNode;
  defaultOn?: boolean;
  /** Columns that are always shown and can't be switched off */
  fixed?: boolean;
  hint?: string;
};

const n = (v: number | null | undefined) => (v === undefined ? null : v);

/** One trust verdict per backtest, built from the checks below; the checks themselves show in the report panel. */
export type Verdict = "solid" | "caution" | "avoid";
export type Check = { label: string; state: "pass" | "warn" | "fail" | "unknown"; hint: string };
export function checksOf(r: Run): Check[] {
  const c: Check[] = [];
  c.push(r.held ? { label: "Held up", state: "pass", hint: "Made money per trade early and recently, and beat holding the stock" }
    : { label: "Did not hold up", state: "warn", hint: "Lost money per trade early or recently, or did not beat holding the stock" });
  c.push(r.fills === "survives" ? { label: "Survives realistic fills", state: "pass", hint: "Still profitable overall and over the last 6 months with realistic fills (exits from the next bar, stop before target, close-based trailing, spread), and the account at the script's own position size ended up" }
    : r.fills === "fails" ? { label: "Fails realistic fills", state: "fail", hint: "Loses money (overall, over the last 6 months, or in the account at the script's own position size) once fills are realistic" }
    : { label: "Not fill-checked", state: "unknown", hint: r.src === "ts" ? "TrendSpider results come from its own tester and cannot be re-run with realistic fills" : "No realistic-fill re-run for this backtest" });
  c.push(r.repaint === "clean" ? { label: "No repaint", state: "pass", hint: "Same trades when re-run with closed bars only, and nothing that behaves differently live" }
    : r.repaint === "repaints" ? { label: "Repaints", state: "fail", hint: "Trades changed when re-run with closed bars only: the backtest used future data" }
    : r.repaint === "vectors_present" ? { label: "Live differs", state: "warn", hint: "History matched with closed bars, but parts of the script behave differently on the live bar" }
    : { label: "Repaint not checked", state: "unknown", hint: r.src === "ts" ? "TrendSpider scripts are not replay-checked" : "This script could not be replay-checked with the data we hold" });
  c.push(r.luck === "unlikely" ? { label: "Unlikely to be luck", state: "pass", hint: `Edge this size is unlikely to be chance even though ${r.tested ?? "many"} strategies were tried on this stock and timeframe` }
    : r.luck === "likely" ? { label: "Could be luck", state: "warn", hint: `With ${r.tested ?? "many"} strategies tried on this stock and timeframe, a result this size could come from chance alone` }
    : r.luck === "possible" ? { label: "Possibly luck", state: "warn", hint: "Some chance this result comes from luck, given how many strategies were tried" }
    : { label: "Luck not tested", state: "unknown", hint: "Too few trades, or no realistic-fill re-run to test" });
  c.push((r.win ?? 0) >= 85 || (r.pf ?? 0) >= 5
    ? { label: "Too good to be true", state: "warn", hint: "Win rate ≥ 85% or profit factor ≥ 5: often the tester's optimistic fills inside a bar, not a real edge" }
    : { label: "Normal win rate and profit factor", state: "pass", hint: "Win rate below 85% and profit factor below 5" });
  return c;
}
export function verdictOf(r: Run): Verdict {
  if (r.repaint === "repaints" || r.fills === "fails") return "avoid";
  return checksOf(r).every((c) => c.state === "pass") ? "solid" : "caution";
}
export const VERDICT_INFO: Record<Verdict, { label: string; cls: string; hint: string }> = {
  solid: { label: "Solid", cls: "bg-gain/15 text-gain", hint: "Held up, survives realistic fills, no repaint, unlikely to be luck, normal win rate and profit factor" },
  caution: { label: "Caution", cls: "bg-warn/15 text-warn", hint: "No hard failure, but at least one check is weak or could not be run" },
  avoid: { label: "Avoid", cls: "bg-loss/15 text-loss", hint: "Repaints, or loses money once fills are realistic" },
};
const MARK: Record<Check["state"], string> = { pass: "✓", warn: "!", fail: "✗", unknown: "?" };
export const CHECK_CLS: Record<Check["state"], string> = { pass: "text-gain", warn: "text-warn", fail: "text-loss", unknown: "text-ink-faint" };
export const checkMark = (st: Check["state"]) => MARK[st];
export function VerdictBadge({ r }: { r: Run }) {
  const v = VERDICT_INFO[verdictOf(r)];
  const list = checksOf(r).map((c) => `${MARK[c.state]} ${c.label}`).join("\n");
  return <span title={`${v.label}: ${v.hint}\n\n${list}`} className={`whitespace-nowrap rounded px-1.5 py-px text-[0.65rem] font-semibold ${v.cls}`}>{v.label}</span>;
}
const DIR: Record<string, string> = { long: "Long only", short: "Short only", both: "Long & short" };
const signed = (v: number | null, d = 1) => <span className={tone(v)}>{pct(v, d)}</span>;

export const COLUMNS: Col[] = [
  { key: "strategy", label: "Strategy", kind: "text", fixed: true, get: (r, s) => s[r.sid]?.title ?? r.sid },
  { key: "verdict", label: "Verdict", kind: "text", get: (r) => VERDICT_INFO[verdictOf(r)].label,
    hint: "Shown under the strategy name: Solid, Caution or Avoid. Open a row to see the checks behind it" },
  { key: "tf", label: "Timeframe", kind: "text", defaultOn: true, get: (r) => r.tf },
  { key: "dir", label: "Direction", kind: "text", defaultOn: true, get: (r) => DIR[(r as any).dir] ?? "" },
  { key: "source", label: "Source", kind: "text", get: (r) => SOURCE_LABEL[r.src] },
  { key: "score", label: "Backtest Score", kind: "number", defaultOn: true, get: (r) => r.score,
    render: (r) => <span className={`num rounded px-1.5 py-0.5 text-xs font-semibold ${scoreTone(r.score)}`}>{r.score ?? "—"}</span>,
    hint: "0–100: consistency 20%, breadth across stocks 25%, edge 20%, practicality 15%, recent 6 months 20% (TradingView); ×0.6 when Check fills" },
  { key: "spark", label: "Net % (graph)", kind: "number", get: () => null, render: (r) => <Spark v={(r as any).spark} />,
    hint: "Running sum of per-trade net %; stored for each stock's top TradingView backtests" },
  { key: "net", label: "Net %", kind: "number", defaultOn: true, get: (r) => n(r.net), render: (r) => signed(r.net),
    hint: "TradingView: sum of the per-trade net % returns (commission in, not compounded). A trade is one position, from entry until flat: partial take-profits are part of it and scale-ins form one campaign, its return = P&L / capital entered" },
  { key: "win", label: "Win Rate %", kind: "number", defaultOn: true, get: (r) => n(r.win), render: (r) => num(r.win, 1), hint: "Share of trades (positions) that made money. A trade is one position, from entry until flat: partial take-profits are part of it and scale-ins form one campaign, its return = P&L / capital entered" },
  { key: "pf", label: "Profit Factor", kind: "number", defaultOn: true, get: (r) => n(r.pf), render: (r) => num(r.pf) },
  { key: "trades", label: "Trades", kind: "number", defaultOn: true, get: (r) => n(r.trades), render: (r) => int(r.trades), hint: "A trade is one position, from entry until flat: partial take-profits are part of it and scale-ins form one campaign, its return = P&L / capital entered" },
  { key: "dd", label: "DrawDown", kind: "number", defaultOn: true, get: (r) => (r.dd == null ? null : Math.abs(r.dd)),
    render: (r) => <span className="text-loss">{r.dd == null ? "—" : num(Math.abs(r.dd), 1)}</span>,
    hint: "TradingView: points of the running trade sum; TrendSpider: % of equity" },
  { key: "add6", label: "Avg Monthly DD (6 months)", kind: "number", defaultOn: true, get: (r) => n(r.add6),
    render: (r) => <span className="text-loss">{r.add6 == null ? "—" : num(r.add6, 1)}</span>,
    hint: "Average of the largest fall under each of the last 6 months (a month with no trades counts as 0). Empty until the stock's trades are archived" },
  { key: "m1", label: "Net % (Last month)", kind: "number", defaultOn: true, get: (r) => n(r.m1), render: (r) => signed(r.m1) },
  { key: "m3", label: "Net % (Last 3 months)", kind: "number", defaultOn: true, get: (r) => n(r.m3), render: (r) => signed(r.m3) },
  { key: "m6", label: "Net % (Last 6 months)", kind: "number", defaultOn: true, get: (r) => n(r.m6), render: (r) => signed(r.m6) },
  { key: "t1", label: "Trades (Last month)", kind: "number", get: (r) => n((r as any).t1), render: (r) => int((r as any).t1) },
  { key: "t3", label: "Trades (Last 3 months)", kind: "number", get: (r) => n((r as any).t3), render: (r) => int((r as any).t3) },
  { key: "t6", label: "Trades (Last 6 months)", kind: "number", get: (r) => n((r as any).t6), render: (r) => int((r as any).t6) },
  { key: "w1", label: "Win Rate % (Last month)", kind: "number", get: (r) => n((r as any).w1), render: (r) => num((r as any).w1, 1) },
  { key: "w3", label: "Win Rate % (Last 3 months)", kind: "number", get: (r) => n((r as any).w3), render: (r) => num((r as any).w3, 1) },
  { key: "w6", label: "Win Rate % (Last 6 months)", kind: "number", get: (r) => n((r as any).w6), render: (r) => num((r as any).w6, 1) },
  { key: "pf1", label: "Profit Factor (Last month)", kind: "number", get: (r) => n((r as any).pf1), render: (r) => num((r as any).pf1) },
  { key: "pf3", label: "Profit Factor (Last 3 months)", kind: "number", get: (r) => n((r as any).pf3), render: (r) => num((r as any).pf3) },
  { key: "pf6", label: "Profit Factor (Last 6 months)", kind: "number", get: (r) => n((r as any).pf6), render: (r) => num((r as any).pf6) },
  { key: "edge", label: "vs Buy & Hold", kind: "number", get: (r) => n(r.edge), render: (r) => signed(r.edge, r.src === "ts" ? 1 : 2),
    hint: "TradingView: per-trade % beyond holding the stock for the same time; TrendSpider: net % minus buy & hold" },
  { key: "bh", label: "Buy & Hold %", kind: "number", get: (r) => n(r.bh), render: (r) => signed(r.bh) },
  { key: "avg", label: "Avg Trade %", kind: "number", get: (r) => n(r.avg), render: (r) => signed(r.avg, 2) },
  { key: "sharpe", label: "Sharpe Ratio", kind: "number", get: (r) => n((r as any).sharpe), render: (r) => num((r as any).sharpe) },
  { key: "sortino", label: "Sortino Ratio", kind: "number", get: (r) => n((r as any).sortino), render: (r) => num((r as any).sortino) },
  { key: "bars_held", label: "Avg Bars Per Trade", kind: "number", get: (r) => n((r as any).bars_held), render: (r) => num((r as any).bars_held, 1) },
  { key: "tpm", label: "Trades / Month", kind: "number", get: (r) => n((r as any).tpm), render: (r) => num((r as any).tpm, 1) },
  { key: "acct", label: "Account Return % (script sizing)", kind: "number", get: (r) => n(r.acct), render: (r) => signed(r.acct ?? null),
    hint: "Realistic fills, one account, the script's own position sizing: not comparable between scripts that size differently" },
  { key: "held", label: "Held Up", kind: "text", get: (r) => (r.held ? "yes" : "no"),
    render: (r) => (r.held ? <span className="text-gain">✓</span> : <span className="text-ink-faint">—</span>),
    hint: "Profitable per trade early and recently, and beat holding the stock" },
  { key: "from", label: "Data From", kind: "text", get: (r) => r.from ?? "" },
];
// "verdict" is a filter/CSV field; in the table the badge under the name already shows it
export const COLUMN = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.defaultOn || c.fixed).map((c) => c.key);
export const TF_ORDER = TIMEFRAMES as readonly string[];

/** Filter rows like "Where Trades ≥ 30 and Net % (Last 6 months) ≥ 0". */
export type Filter = { join: "and" | "or"; key: string; op: ">=" | "<=" | "is" | "contains"; value: string };
export const DEFAULT_FILTERS: Filter[] = [{ join: "and", key: "trades", op: ">=", value: "30" }];

/** One-click starting points. Filter rows combine left to right, so the timeframe "or" comes first:
 *  (5m or 15m) and trades >= 100 and last month, 3 and 6 months not negative. */
export type Preset = { label: string; hint: string; realistic: boolean; verdict: "" | Verdict; tf: string; filters: Filter[]; sort: string; dir: 1 | -1 };
export const PRESETS: Record<string, Preset> = {
  day: {
    label: "Day trading", realistic: true, verdict: "solid", tf: "", sort: "score", dir: -1,
    hint: "5m or 15m, realistic fills, Solid verdict, at least 100 trades, last month / 3 / 6 months not negative, best score first",
    filters: [
      { join: "and", key: "tf", op: "is", value: "5m" },
      { join: "or", key: "tf", op: "is", value: "15m" },
      { join: "and", key: "trades", op: ">=", value: "100" },
      { join: "and", key: "m1", op: ">=", value: "0" },
      { join: "and", key: "m3", op: ">=", value: "0" },
      { join: "and", key: "m6", op: ">=", value: "0" },
    ],
  },
};

export function matches(r: Run, s: Record<string, Strategy>, filters: Filter[]): boolean {
  let out: boolean | null = null;
  for (const f of filters) {
    const col = COLUMN[f.key];
    if (!col || f.value.trim() === "") continue;                 // incomplete rows don't filter
    const v = col.get(r, s);
    let ok: boolean;
    if (col.kind === "number") {
      const x = Number(f.value);
      ok = v !== null && v !== "" && !Number.isNaN(x) && (f.op === "<=" ? Number(v) <= x : Number(v) >= x);
    } else {
      const a = String(v ?? "").toLowerCase(), b = f.value.trim().toLowerCase();
      ok = f.op === "is" ? a === b : a.includes(b);
    }
    out = out === null ? ok : f.join === "or" ? out || ok : out && ok;
  }
  return out ?? true;
}

function Spark({ v }: { v?: number[] | null }) {
  if (!v || v.length < 2) return <span className="text-ink-faint">—</span>;
  const w = 72, h = 22, lo = Math.min(0, ...v), hi = Math.max(0, ...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * w},${h - ((y - lo) / span) * h}`).join(" ");
  const zero = h - ((0 - lo) / span) * h;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle" aria-hidden="true">
      <line x1="0" x2={w} y1={zero} y2={zero} stroke="var(--color-line)" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={v[v.length - 1] >= 0 ? "var(--color-gain)" : "var(--color-loss)"} strokeWidth="1.5" />
    </svg>
  );
}
