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

/** Labels shown under a strategy's name, beside its source. Order = importance. */
export type Tag = { label: string; tone: "gain" | "loss" | "warn" | "signal" | "muted"; hint: string };
export function tagsOf(r: Run): Tag[] {
  const x = r as any, t: Tag[] = [];
  if (r.held) t.push({ label: "Held up", tone: "gain", hint: "Made money per trade early and recently, and beat holding the stock" });
  if (r.repaint === "repaints") t.push({ label: "Repaints", tone: "loss", hint: "Trades changed when re-run with closed bars only: the backtest used future data" });
  else if (r.repaint === "vectors_present") t.push({ label: "Live differs", tone: "warn", hint: "History matched with closed bars, but parts of the script behave differently on the live bar" });
  else if (r.repaint === "clean") t.push({ label: "No repaint", tone: "muted", hint: "Passed Foresight's replay check" });
  if ((r.win ?? 0) >= 85 || (r.pf ?? 0) >= 5)
    t.push({ label: "Check fills", tone: "warn", hint: "Win rate ≥ 85% or profit factor ≥ 5: often the tester's optimistic fills inside a bar, not a real edge" });
  if ((x.t1 ?? 0) > 0) t.push({ label: "Active", tone: "signal", hint: "Closed at least one trade in the last month" });
  if (x.dir === "long") t.push({ label: "Long only", tone: "muted", hint: "Only buys" });
  else if (x.dir === "short") t.push({ label: "Short only", tone: "muted", hint: "Only sells short" });
  else if (x.dir === "both") t.push({ label: "Long & short", tone: "muted", hint: "Trades both directions" });
  return t;
}
const TAG_TONE: Record<Tag["tone"], string> = {
  gain: "bg-gain/15 text-gain", loss: "bg-loss/15 text-loss", warn: "bg-warn/15 text-warn",
  signal: "bg-signal/15 text-signal", muted: "bg-panel-2 text-ink-dim",
};
export function TagChips({ r }: { r: Run }) {
  return (
    <>
      {tagsOf(r).map((t) => (
        <span key={t.label} title={t.hint} className={`whitespace-nowrap rounded px-1.5 py-px text-[0.65rem] font-medium ${TAG_TONE[t.tone]}`}>{t.label}</span>
      ))}
    </>
  );
}
const signed = (v: number | null, d = 1) => <span className={tone(v)}>{pct(v, d)}</span>;

export const COLUMNS: Col[] = [
  { key: "strategy", label: "Strategy", kind: "text", fixed: true, get: (r, s) => s[r.sid]?.title ?? r.sid },
  { key: "tags", label: "Tags", kind: "text", get: (r) => tagsOf(r).map((t) => t.label).join(", "),
    hint: "Shown under the strategy name; filter with e.g. Tags has Held up" },
  { key: "tf", label: "Timeframe", kind: "text", defaultOn: true, get: (r) => r.tf },
  { key: "source", label: "Source", kind: "text", get: (r) => SOURCE_LABEL[r.src] },
  { key: "score", label: "Backtest Score", kind: "number", defaultOn: true, get: (r) => r.score,
    render: (r) => <span className={`num rounded px-1.5 py-0.5 text-xs font-semibold ${scoreTone(r.score)}`}>{r.score ?? "—"}</span>,
    hint: "0–100: consistency 20%, breadth across stocks 25%, edge 20%, practicality 15%, recent 6 months 20% (TradingView); ×0.6 when Check fills" },
  { key: "spark", label: "Net % (graph)", kind: "number", get: () => null, render: (r) => <Spark v={(r as any).spark} />,
    hint: "Running sum of per-trade net %; stored for each stock's top TradingView backtests" },
  { key: "net", label: "Net %", kind: "number", defaultOn: true, get: (r) => n(r.net), render: (r) => signed(r.net) },
  { key: "win", label: "Win Rate %", kind: "number", defaultOn: true, get: (r) => n(r.win), render: (r) => num(r.win, 1) },
  { key: "pf", label: "Profit Factor", kind: "number", defaultOn: true, get: (r) => n(r.pf), render: (r) => num(r.pf) },
  { key: "trades", label: "Trades", kind: "number", defaultOn: true, get: (r) => n(r.trades), render: (r) => int(r.trades) },
  { key: "dd", label: "DrawDown", kind: "number", defaultOn: true, get: (r) => (r.dd == null ? null : Math.abs(r.dd)),
    render: (r) => <span className="text-loss">{r.dd == null ? "—" : num(Math.abs(r.dd), 1)}</span>,
    hint: "TradingView: points of the running trade sum; TrendSpider: % of equity" },
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
  { key: "held", label: "Held Up", kind: "text", get: (r) => (r.held ? "yes" : "no"),
    render: (r) => (r.held ? <span className="text-gain">✓</span> : <span className="text-ink-faint">—</span>),
    hint: "Profitable per trade early and recently, and beat holding the stock" },
  { key: "from", label: "Data From", kind: "text", get: (r) => r.from ?? "" },
];
// "tags" is a filter/CSV field; in the table the chips under the name already show them
export const COLUMN = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.defaultOn || c.fixed).map((c) => c.key);
export const TF_ORDER = TIMEFRAMES as readonly string[];

/** Filter rows like "Where Trades ≥ 30 and Net % (Last 6 months) ≥ 0". */
export type Filter = { join: "and" | "or"; key: string; op: ">=" | "<=" | "is" | "contains"; value: string };
export const DEFAULT_FILTERS: Filter[] = [{ join: "and", key: "trades", op: ">=", value: "30" }];

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
