// GET /api/backtests?tf=&src=&held=1&rep=1&checked=1&verdict=&fills=realistic&q=&sort=score&dir=-1&filters=[...]&page=1&size=30
// One page of the All backtests table (filtered and sorted on the server). &format=csv returns up to CSV_LIMIT rows.
import { NextResponse } from "next/server";
import { allRows, page, strategiesForCsv, type Query } from "@/lib/backtests.server";
import { COLUMNS, type Filter } from "@/lib/columns";
import { TIMEFRAMES } from "@/lib/data";

export const dynamic = "force-dynamic";
const CSV_LIMIT = 10000;          // a function's response is capped at a few MB
const CACHE = "public, max-age=300, s-maxage=31536000";

function query(sp: URLSearchParams): Query {
  let filters: Filter[] = [];
  try { filters = JSON.parse(sp.get("filters") || "[]"); } catch {}
  const tf = sp.get("tf") ?? "";
  return {
    tf: (TIMEFRAMES as readonly string[]).includes(tf) ? tf : "",
    src: ["tv", "ts"].includes(sp.get("src") ?? "") ? sp.get("src")! : "",
    heldOnly: sp.get("held") === "1", showRepaint: sp.get("rep") === "1", onlyChecked: sp.get("checked") === "1",
    verdict: ["solid", "caution", "avoid"].includes(sp.get("verdict") ?? "") ? sp.get("verdict")! : "",
    fills: sp.get("fills") === "realistic" ? "realistic" : "tv",
    q: (sp.get("q") ?? "").slice(0, 80), sort: sp.get("sort") || "score", dir: sp.get("dir") === "1" ? 1 : -1,
    filters: Array.isArray(filters) ? filters.slice(0, 12) : [],
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = query(sp);
  if (sp.get("format") === "csv") {
    const { total, rows } = allRows(q, CSV_LIMIT);
    const exp = COLUMNS.filter((c) => c.key !== "spark");
    const esc = (v: any) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const strategies = strategiesForCsv();
    const head = ["Stock", ...exp.map((c) => c.label), "Repaint check", "Recent figures as of"].map(esc).join(",");
    const body = rows.map((r: any) => [r.sym, ...exp.map((c) => c.get(r, strategies)), r.repaint, r.asof].map(esc).join(","));
    const note = total > CSV_LIMIT ? [`# first ${CSV_LIMIT} of ${total} rows in the current sort order; narrow the filters for the rest`] : [];
    return new NextResponse([...note, head, ...body].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="all_backtests.csv"', "Cache-Control": CACHE },
    });
  }
  const size = Math.min(100, Math.max(1, Number(sp.get("size")) || 30));
  const pageNo = Math.max(1, Number(sp.get("page")) || 1);
  // the data only changes with a new deployment (which empties Vercel's cache), so any answer can be cached:
  // the browser keeps it 5 minutes, Vercel's network until the next deployment
  return NextResponse.json(page(q, pageNo, size), { headers: { "Cache-Control": CACHE } });
}
