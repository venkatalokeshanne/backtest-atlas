// Server side of the All backtests page: every backtest of every stock, filtered, sorted and paged here so the browser
// only ever receives one page of rows. Data: data/all/<tf>.json.gz (scripts/build_data.py), one array per column.
// Rows are read through a reusable "cursor" object whose getters point at row i, so the same column, filter and
// verdict code as the stock page runs on 300,000+ rows without building an object per row.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { COLUMN, matches, TF_ORDER, verdictOf, type Filter, type Verdict } from "./columns";
import { TIMEFRAMES, type Fills, type Run, type Strategy } from "./data";

type Table = {
  tf: string; n: number;
  /** per row, computed once: duplicate strategy, lowercased title + stock for the search box, verdict per fills */
  dup: Uint8Array; text: string[]; verdict: Partial<Record<Fills, Int8Array>>;
  num: Record<string, Float64Array>; str: Record<string, { dict: string[]; codes: Int32Array }>;
  list: Record<string, ([number, number] | null)[]>; sparse: Record<string, Record<string, number[]>>;
  keys: string[];
};
type Cursor = Run & { i: number; sym: string };

const DATA = path.join(process.cwd(), "data", "all");
const BOOL = new Set(["held", "r_held"]);
const SWAP = ["score", "held", "net", "dd", "trades", "win", "pf", "avg", "edge", "m1", "m3", "m6",
  "t1", "t3", "t6", "w1", "w3", "w6", "pf1", "pf3", "pf6", "breadth", "spark"];

const tables = new Map<string, Table>();
/** Columns whose sort value is just the stored number (the column's get() returns it unchanged, dd as its absolute value). */
const DIRECT = new Set(["score", "net", "dd", "trades", "win", "pf", "avg", "edge", "bh", "m1", "m3", "m6", "t1", "t3", "t6",
  "w1", "w3", "w6", "pf1", "pf3", "pf6", "sharpe", "sortino", "bars_held", "tpm", "acct"]);
const VERDICTS: Verdict[] = ["solid", "caution", "avoid"];
/** Every row's verdict under the given fills, computed once per table. */
function verdicts(t: Table, fills: Fills): Int8Array {
  if (!t.verdict[fills]) {
    const v = new Int8Array(t.n), r = cursor(t, fills === "realistic");
    for (let i = 0; i < t.n; i++) { r.i = i; v[i] = VERDICTS.indexOf(verdictOf(r)); }
    t.verdict[fills] = v;
  }
  return t.verdict[fills]!;
}
function table(tf: string): Table {
  let t = tables.get(tf);
  if (t) return t;
  // numbers and text codes are stored as raw arrays (scripts/build_data.py write_columnar): no parsing, just views
  const gz = (f: string) => zlib.gunzipSync(fs.readFileSync(path.join(DATA, `${tf}.${f}`)));
  const d = JSON.parse(gz("meta.json.gz").toString("utf-8"));
  const n: number = d.n;
  const nb = gz("num.bin.gz"), sb = gz("str.bin.gz");
  const numAll = new Float64Array(nb.buffer, nb.byteOffset, nb.byteLength / 8);
  const strAll = new Int32Array(sb.buffer, sb.byteOffset, sb.byteLength / 4);
  const num: Table["num"] = {}, str: Table["str"] = {};
  (d.num as string[]).forEach((c, k) => (num[c] = numAll.subarray(k * n, (k + 1) * n)));
  Object.entries<string[]>(d.str).forEach(([c, dict], k) => (str[c] = { dict, codes: strAll.subarray(k * n, (k + 1) * n) }));
  const S = strategies();
  const sid = str.sid, sym = str.sym;
  const dupBySid = sid.dict.map((x) => (S[x]?.dup_of ? 1 : 0));
  const titleBySid = sid.dict.map((x) => (S[x]?.title ?? x).toLowerCase());
  const dup = new Uint8Array(n), text: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    dup[i] = dupBySid[sid.codes[i]];
    text[i] = `${titleBySid[sid.codes[i]]}|${sym.dict[sym.codes[i]].toLowerCase()}`;
  }
  t = { tf, n, num, str, list: d.list, sparse: d.sparse, dup, text, verdict: {},
        keys: [...Object.keys(num), ...Object.keys(str), ...Object.keys(d.list), ...Object.keys(d.sparse), "id", "mode"] };
  tables.set(tf, t);
  return t;
}

/** A cursor over table t; realistic = read r_* numbers for fill-checked rows (same rule as view() in data.ts). */
function cursor(t: Table, realistic: boolean): Cursor {
  const raw = (c: string, i: number): any => {
    if (c in t.num) { const v = t.num[c][i]; return Number.isNaN(v) ? null : BOOL.has(c) ? v === 1 : v; }
    if (c in t.str) { const k = t.str[c].codes[i]; return k < 0 ? null : t.str[c].dict[k]; }
    if (c in t.list) return t.list[c][i] ?? null;
    if (c in t.sparse) return t.sparse[c][i] ?? null;
    return undefined;
  };
  const checked = (i: number) => t.str.fills.codes[i] >= 0;
  const proto: any = {};
  for (const c of t.keys) {
    Object.defineProperty(proto, c, {
      enumerable: true,
      get(this: Cursor) {
        if (c === "id") return `${raw("src", this.i)}:${raw("sid", this.i)}:${t.tf}`;
        if (c === "mode") return realistic && checked(this.i) ? "realistic" : "tv";
        if (realistic && SWAP.includes(c) && checked(this.i)) return raw(`r_${c}`, this.i);
        return raw(c, this.i);
      },
    });
  }
  const cur = Object.create(proto) as Cursor;
  cur.i = 0;
  return cur;
}
/** A plain copy of the row the cursor points at (for the page of rows sent to the browser). */
function plain(cur: Cursor, keys: string[]): Run & { sym: string } {
  const o: any = {};
  for (const k of keys) o[k] = (cur as any)[k];
  return o;
}

let strategiesCache: Record<string, Strategy> | null = null;
function strategies(): Record<string, Strategy> {
  if (!strategiesCache) strategiesCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "strategies.json"), "utf-8"));
  return strategiesCache!;
}

export const strategiesForCsv = strategies;

export type Query = {
  tf: string; src: string; heldOnly: boolean; showRepaint: boolean; onlyChecked: boolean; verdict: string;
  fills: Fills; q: string; sort: string; dir: 1 | -1; filters: Filter[];
};
type Hit = { t: number; i: number };
type Result = { hits: Hit[]; unchecked: number; tfs: string[] };

// recent queries' sorted results, so paging and re-opening a view does not filter and sort again
const resultCache = new Map<string, Result>();

function run(q: Query): Result {
  const key = JSON.stringify(q);
  const hit = resultCache.get(key);
  if (hit) { resultCache.delete(key); resultCache.set(key, hit); return hit; }
  const S = strategies();
  const tfs = q.tf ? [q.tf] : [...TIMEFRAMES];
  const realistic = q.fills === "realistic";
  const s = q.q.trim().toLowerCase();
  const col = COLUMN[q.sort];
  const hits: Hit[] = [], keys: any[] = [], checkedFlags: boolean[] = [];
  // a numeric column is read straight from its array (the realistic value for fill-checked rows), else via the column's getter
  const direct = q.sort !== "tf" && q.sort !== "sym" && col?.kind === "number" && DIRECT.has(q.sort);
  tfs.forEach((tf, ti) => {
    const t = table(tf), r = cursor(t, realistic);
    // the cheap tests run on the raw codes first; the cursor is only read for rows still in
    const fillsC = t.str.fills.codes, srcC = t.str.src.codes, repC = t.str.repaint.codes;
    const srcWant = q.src ? t.str.src.dict.indexOf(q.src) : -2, repCode = t.str.repaint.dict.indexOf("repaints");
    const held = t.num[realistic ? "r_held" : "held"], heldTv = t.num.held;
    const vWant = q.verdict ? VERDICTS.indexOf(q.verdict as Verdict) : -1, vArr = q.verdict ? verdicts(t, q.fills) : null;
    for (let i = 0; i < t.n; i++) {
      const checked = fillsC[i] >= 0;
      if (q.onlyChecked && !checked) continue;
      if (srcWant !== -2 && srcC[i] !== srcWant) continue;
      if (q.heldOnly && ((realistic && checked ? held[i] : heldTv[i]) !== 1)) continue;
      if (!q.showRepaint && repC[i] === repCode) continue;
      if (t.dup[i]) continue;
      if (vArr && vArr[i] !== vWant) continue;
      if (s && !t.text[i].includes(s)) continue;
      r.i = i;
      if (q.filters.length && !matches(r, S, q.filters)) continue;
      hits.push({ t: ti, i });
      checkedFlags.push(checked);
      let v: any;
      if (direct) {
        const a = realistic && checked && SWAP.includes(q.sort) ? t.num[`r_${q.sort}`] : t.num[q.sort];
        const x = a ? a[i] : NaN;
        v = Number.isNaN(x) ? null : q.sort === "dd" ? Math.abs(x) : x;
      } else {
        v = q.sort === "tf" ? TF_ORDER.indexOf(tf) : q.sort === "sym" ? r.sym : col?.get(r, S);
        if (typeof v === "string") v = v.toLowerCase();
      }
      keys.push(v);
    }
  });
  const idx = hits.map((_, k) => k);
  idx.sort((a, b) => {
    // realistic fills: fill-checked backtests first, as on the stock page
    if (realistic && checkedFlags[a] !== checkedFlags[b]) return checkedFlags[a] ? -1 : 1;
    const av = keys[a], bv = keys[b];
    if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
    return av < bv ? -q.dir : av > bv ? q.dir : 0;
  });
  const res: Result = { hits: idx.map((k) => hits[k]), unchecked: checkedFlags.filter((x) => !x).length, tfs };
  resultCache.set(key, res);
  if (resultCache.size > 40) resultCache.delete(resultCache.keys().next().value!);
  return res;
}

/** One page: the rows as shown (chosen fills) and as stored (both fills, for the report's comparison). */
export function page(q: Query, pageNo: number, size: number) {
  const res = run(q);
  const from = (pageNo - 1) * size;
  const rows = [], raws = [];
  for (const h of res.hits.slice(from, from + size)) {
    const t = table(res.tfs[h.t]);
    const v = cursor(t, q.fills === "realistic"), r = cursor(t, false);
    v.i = h.i; r.i = h.i;
    rows.push(plain(v, t.keys));
    if (q.fills === "realistic") raws.push(plain(r, t.keys));      // with TradingView fills the row is already the stored one
  }
  return { total: res.hits.length, unchecked: res.unchecked, rows, raws };
}

/** Up to `limit` rows for the CSV download. */
export function allRows(q: Query, limit: number) {
  const res = run(q);
  const curs = res.tfs.map((tf) => cursor(table(tf), q.fills === "realistic"));
  return { total: res.hits.length, rows: res.hits.slice(0, limit).map((h) => {
    const v = curs[h.t]; v.i = h.i; return plain(v, table(res.tfs[h.t]).keys);
  }) };
}
