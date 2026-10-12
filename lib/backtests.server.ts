// Server side of the All backtests page: every backtest of every stock, filtered, sorted and paged here so the browser
// only ever receives one page of rows. Data: data/all/<tf>.* (scripts/build_data.py write_columnar), one array per column.
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
const NAN_ARR = new Float64Array(0);
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
  const file = (f: string) => fs.readFileSync(path.join(DATA, `${tf}.${f}`));
  const d = JSON.parse(zlib.gunzipSync(file("meta.json.gz")).toString("utf-8"));
  const n: number = d.n;
  // typed arrays need aligned memory; big file reads are, but copy if not
  const aligned = (b: Buffer, k: number) => (b.byteOffset % k === 0 ? b : Buffer.from(b));
  const nb = aligned(file("num.bin"), 8), sb = aligned(file("str.bin"), 4);
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

/** A cursor over table t; realistic = read r_* numbers for fill-checked rows (same rule as view() in data.ts).
 *  Every column gets its own small reader, resolved once, so reading a field is one array lookup. */
function reader(t: Table, c: string): (i: number) => any {
  const a = t.num[c];
  if (a) return BOOL.has(c) ? (i) => { const v = a[i]; return v !== v ? null : v === 1; } : (i) => { const v = a[i]; return v !== v ? null : v; };
  const s = t.str[c];
  if (s) { const { dict, codes } = s; return (i) => { const k = codes[i]; return k < 0 ? null : dict[k]; }; }
  const l = t.list[c];
  if (l) return (i) => l[i] ?? null;
  const sp = t.sparse[c];
  if (sp) return (i) => sp[i] ?? null;
  return () => undefined;
}
function cursor(t: Table, realistic: boolean): Cursor {
  const fillsC = t.str.fills.codes, src = reader(t, "src"), sid = reader(t, "sid");
  const proto: any = {};
  for (const c of t.keys) {
    let get: (this: Cursor) => any;
    if (c === "id") get = function () { return `${src(this.i)}:${sid(this.i)}:${t.tf}`; };
    else if (c === "mode") get = function () { return realistic && fillsC[this.i] >= 0 ? "realistic" : "tv"; };
    else {
      const base = reader(t, c);
      if (realistic && SWAP.includes(c)) {
        const alt = reader(t, `r_${c}`);
        get = function () { return fillsC[this.i] >= 0 ? alt(this.i) : base(this.i); };
      } else get = function () { return base(this.i); };
    }
    Object.defineProperty(proto, c, { enumerable: true, get });
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
  const ht: number[] = [], hi: number[] = [], keys: any[] = [], nkeys: number[] = [], checkedFlags: number[] = [];
  // a numeric column is read straight from its array (the realistic value for fill-checked rows), else via the column's getter
  const direct = q.sort !== "tf" && q.sort !== "sym" && col?.kind === "number" && DIRECT.has(q.sort);
  tfs.forEach((tf, ti) => {
    const t = table(tf), r = cursor(t, realistic);
    const filt = compileFilters(t, r, q.filters, realistic, S);
    const sortArr = direct ? t.num[q.sort] : null, sortReal = direct && SWAP.includes(q.sort) ? t.num[`r_${q.sort}`] : null;
    const sortAbs = q.sort === "dd";
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
      if (filt && !filt(i, checked)) continue;
      ht.push(ti); hi.push(i);
      checkedFlags.push(checked ? 1 : 0);
      if (direct) {
        const x = (realistic && checked && sortReal ? sortReal : sortArr ?? NAN_ARR)[i];
        nkeys.push(x !== x ? NaN : sortAbs ? Math.abs(x) : x);
      } else {
        let v: any = q.sort === "tf" ? TF_ORDER.indexOf(tf) : q.sort === "sym" ? r.sym : col?.get(r, S);
        if (typeof v === "string") v = v.toLowerCase();
        keys.push(v);
      }
    }
  });
  const m = hi.length, dir = q.dir;
  const idx = new Uint32Array(m);
  for (let k = 0; k < m; k++) idx[k] = k;
  const cf = Uint8Array.from(checkedFlags);
  // realistic fills: fill-checked backtests first, as on the stock page; empty values last; then the column, either way
  if (direct) {
    const nk = Float64Array.from(nkeys);
    idx.sort((a, b) => {
      if (realistic && cf[a] !== cf[b]) return cf[b] - cf[a];
      const av = nk[a], bv = nk[b], an = av !== av, bn = bv !== bv;
      if (an !== bn) return an ? 1 : -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  } else {
    idx.sort((a, b) => {
      if (realistic && cf[a] !== cf[b]) return cf[b] - cf[a];
      const av = keys[a], bv = keys[b];
      if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }
  const hits: Hit[] = new Array(m);
  let unchecked = 0;
  for (let k = 0; k < m; k++) { const j = idx[k]; hits[k] = { t: ht[j], i: hi[j] }; unchecked += cf[k] ? 0 : 1; }
  const res: Result = { hits, unchecked, tfs };
  resultCache.set(key, res);
  if (resultCache.size > 40) resultCache.delete(resultCache.keys().next().value!);
  return res;
}

/** The filter rows as one test per row, the same logic as matches() in columns.tsx; numeric columns read their array
 *  directly (the realistic value for fill-checked rows), anything else goes through matches() on the cursor. */
function compileFilters(t: Table, r: Cursor, filters: Filter[], realistic: boolean, S: Record<string, Strategy>) {
  const parts: { join: "and" | "or"; test: (i: number, checked: boolean) => boolean }[] = [];
  for (const f of filters) {
    const col = COLUMN[f.key];
    if (!col || f.value.trim() === "") continue;
    let test: (i: number, checked: boolean) => boolean;
    if (col.kind === "number" && DIRECT.has(f.key) && t.num[f.key]) {
      const x = Number(f.value), le = f.op === "<=", a = t.num[f.key], ra = realistic && SWAP.includes(f.key) ? t.num[`r_${f.key}`] : null;
      const abs = f.key === "dd";
      test = (i, checked) => {
        let v = ra && checked ? ra[i] : a[i];
        if (v !== v || x !== x) return false;
        if (abs) v = Math.abs(v);
        return le ? v <= x : v >= x;
      };
    } else {
      const one = [{ ...f, join: "and" as const }];
      test = () => matches(r, S, one);
    }
    parts.push({ join: f.join, test });
  }
  if (!parts.length) return null;
  return (i: number, checked: boolean) => {
    let out = parts[0].test(i, checked);
    for (let k = 1; k < parts.length; k++) out = parts[k].join === "or" ? out || parts[k].test(i, checked) : out && parts[k].test(i, checked);
    return out;
  };
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
