"""Top strategies across stocks: for each strategy x timeframe, its backtests on every stock of a watchlist combined into
one row (how many stocks it held up on, how many are Solid, median score / net / drawdown ...), ranked by consistency:
the Wilson lower bound of the share of stocks where it held up and is not rated Avoid (repaints, or loses once fills
are realistic), so 9 of 10 stocks beats 1 of 1 and a repainting strategy never tops the list.

Reads the per-backtest tables build_data.py writes (data/all/<tf>.*) and writes static files the Top strategies page
loads directly — no server function:
    public/data/top/<list>.<fills>.json      list: all | traded | ai-core | ...    fills: tv | realistic

    python scripts/build_top.py
"""
import gzip, json, math, re, statistics as st, sys, time
from array import array
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
ALL = ROOT / "data" / "all"
PUB = ROOT / "public" / "data"
OUT = PUB / "top"
TFS = ["5m", "15m", "1H", "Daily"]
SWAP = {"score", "held", "net", "dd", "trades", "win", "pf", "edge", "add6"}     # realistic value for fill-checked rows


def slug(name): return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "all"


def wilson_low(k, n, z=1.645):
    if not n: return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def load(tf):
    meta = json.loads(gzip.decompress((ALL / f"{tf}.meta.json.gz").read_bytes()))
    n = meta["n"]
    num, codes = array("d"), array("i")
    num.frombytes((ALL / f"{tf}.num.bin").read_bytes()); codes.frombytes((ALL / f"{tf}.str.bin").read_bytes())
    if sys.byteorder != "little": num.byteswap(); codes.byteswap()
    cols = {}
    for k, c in enumerate(meta["num"]):
        cols[c] = [None if v != v else v for v in num[k * n:(k + 1) * n]]
    for k, (c, d) in enumerate(meta["str"].items()):
        cols[c] = [d[x] if x >= 0 else None for x in codes[k * n:(k + 1) * n]]
    return n, cols


def verdict(held, fills, repaint, luck, win, pf):
    """verdictOf() in lib/columns.tsx"""
    if repaint == "repaints" or fills == "fails": return "avoid"
    ok = bool(held) and fills == "survives" and repaint == "clean" and luck == "unlikely" and not ((win or 0) >= 85 or (pf or 0) >= 5)
    return "solid" if ok else "caution"


def med(v):
    v = [x for x in v if x is not None]
    return round(st.median(v), 2) if v else None


def main():
    t0 = time.time()
    idx = json.loads((PUB / "symbols.json").read_text(encoding="utf-8"))
    strategies = json.loads((PUB / "strategies.json").read_text(encoding="utf-8"))
    lists = {"All": None, **{l: {s["symbol"] for s in idx["symbols"] if l in s["lists"]} for l in idx["lists"]}}
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"): f.unlink()
    # per (list, fills): (sid, src, tf) -> the per-stock rows
    groups = {(l, fl): defaultdict(list) for l in lists for fl in ("tv", "realistic")}
    for tf in TFS:
        if not (ALL / f"{tf}.meta.json.gz").exists(): continue
        n, c = load(tf)
        for i in range(n):
            sid = c["sid"][i]
            if (strategies.get(sid) or {}).get("dup_of"): continue          # duplicates of another strategy: hidden, as elsewhere
            checked = c["fills"][i] is not None
            for fl in ("tv", "realistic"):
                g = lambda k: c[f"r_{k}"][i] if fl == "realistic" and checked and k in SWAP and f"r_{k}" in c else c[k][i]
                row = {"sym": c["sym"][i], "score": g("score"), "held": g("held") == 1, "net": g("net"),
                       "dd": None if g("dd") is None else abs(g("dd")), "trades": g("trades"), "win": g("win"), "pf": g("pf"),
                       "edge": g("edge"), "add6": g("add6"), "acct": c["acct"][i], "acct_dd": c["acct_dd"][i], "rep": c["repaint"][i], "dir": c["dir"][i], "checked": checked,
                       "v": verdict(g("held") == 1, c["fills"][i], c["repaint"][i], c["luck"][i], g("win"), g("pf"))}
                for l, members in lists.items():
                    if members is None or row["sym"] in members:
                        groups[(l, fl)][(sid, c["src"][i], tf)].append(row)
        print(f"{tf}: {n} backtests", flush=True)

    cols = ["sid", "src", "tf", "dir", "stocks", "traded", "held", "good", "solid", "avoid", "cons", "score", "net", "dd", "win", "pf",
            "trades", "beat", "add6", "acct", "acct_dd", "acct_pos", "rep", "checked", "best"]
    for (l, fl), g in groups.items():
        rows = []
        for (sid, src, tf), rs in g.items():
            traded = [r for r in rs if r["trades"]]
            held = [r for r in rs if r["held"]]
            # held up, not Avoid, and — where the realistic re-run exists — the account at the script's own size ended up
            good = [r for r in held if r["v"] != "avoid" and (r["acct"] is None or r["acct"] > 0)]
            reps = {r["rep"] for r in rs}
            best = sorted(good, key=lambda r: -(r["score"] or 0))[:8]
            rows.append([sid, src, tf, rs[0]["dir"], len(rs), len(traded), len(held), len(good),
                         sum(r["v"] == "solid" for r in rs), sum(r["v"] == "avoid" for r in rs),
                         round(100 * wilson_low(len(good), len(rs)), 1),
                         med([r["score"] for r in traded]), med([r["net"] for r in traded]), med([r["dd"] for r in traded]),
                         med([r["win"] for r in traded]), med([r["pf"] for r in traded]), med([r["trades"] for r in traded]),
                         round(100 * sum((r["edge"] or 0) > 0 for r in traded) / len(traded), 1) if traded else None,
                         med([r["add6"] for r in traded]),
                         # the money view: account return / drawdown at the script's own position size (realistic re-runs)
                         med([r["acct"] for r in rs]), med([r["acct_dd"] for r in rs]),
                         (round(100 * sum((r["acct"] or 0) > 0 for r in rs if r["acct"] is not None) / sum(r["acct"] is not None for r in rs))
                          if any(r["acct"] is not None for r in rs) else None),
                         "repaints" if "repaints" in reps else "clean" if reps == {"clean"} else None,
                         sum(r["checked"] for r in rs),
                         [[r["sym"], r["score"], r["net"]] for r in best]])
        rows.sort(key=lambda r: (-r[cols.index("cons")], -(r[cols.index("score")] or 0)))
        doc = {"generated": time.strftime("%Y-%m-%d %H:%M"), "list": l, "fills": fl,
               "stocks": len(lists[l]) if lists[l] is not None else len(idx["symbols"]), "cols": cols, "rows": rows}
        (OUT / f"{slug(l)}.{fl}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    (OUT / "lists.json").write_text(json.dumps([{"name": l, "slug": slug(l)} for l in lists], separators=(",", ":")), encoding="utf-8")
    sizes = [p.stat().st_size for p in OUT.glob("*.json")]
    print(f"{len(sizes)} files, {sum(sizes) / 1e6:.1f} MB, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
