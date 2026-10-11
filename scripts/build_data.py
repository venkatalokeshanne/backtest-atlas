"""Build the site's static data from every backtest we have:

  * TradingView Pine strategies run as published by Foresight (backtest-results-dashboard/data/exports/pine_*.json)
  * TrendSpider strategy runs (backtest-results-dashboard/data/exports/results.json, depths 1000-4000 bars)

Writes public/data/symbols.json (the "Explore by symbol" index), public/data/strategies.json and
public/data/symbol/<TICKER>.json (every backtest on that symbol, with its score and report).

Backtest Score (0-100) = mean of four parts, each 0-100:
  Consistency  share of the windows it was judged on that made money per trade
               (TradingView: first 70%, last 30%, last 1000/2000/3000/4000 bars; TrendSpider: the 4 depths)
  Breadth      the same strategy and timeframe across all our tickers: share that held up, marked down when
               there are few (lower end of the 90% Wilson interval)
  Edge         profit factor (1 -> 0, 2+ -> 100), halved when it did not beat simply holding the stock
  Practicality enough trades to mean something (100+) and a drawdown that is livable
Repainting strategies (Foresight's replay check) get no score and are flagged.
Run: python scripts/build_data.py"""
import json, math, glob, statistics as st, collections, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
DASH = Path(r"C:\Users\annev\workspace\backtest-results-dashboard")
SCREEN = Path(r"C:\Users\annev\workspace\pine_screen")
DEPTHS = (1000, 2000, 3000, 4000)
TS_TF = {"5m": "5m", "15m": "15m", "1H": "1H", "Daily": "Daily"}
TABLE_COLS = ["id", "src", "sid", "tf", "score", "held", "repaint", "breadth", "net", "dd", "trades", "win", "pf", "avg",
              "edge", "bh", "from", "m1", "m3", "m6", "asof", "t1", "t3", "t6", "w1", "w3", "w6", "pf1", "pf3", "pf6",
              "sharpe", "sortino", "bars_held", "tpm", "spark", "dir"]
PERIOD_TF = {"5m": "5m", "15m": "15m", "1h": "1H", "daily": "Daily"}


def load_periods():
    """Recent performance from the trade lists (pine_screen/periods.py): (ticker, tf, strategy) -> stats."""
    out = {}
    for f in glob.glob(str(SCREEN / "periods" / "*" / "*.jsonl")):
        for line in open(f, encoding="utf-8"):
            try: x = json.loads(line)
            except Exception: continue
            if "error" not in x and "p1m" in x:
                out[(x["ticker"], PERIOD_TF[x["tf"]], x["strategy"])] = x
    return out


def wilson_low(k, n, z=1.645):
    if not n: return 0.0
    p = k / n; d = 1 + z * z / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d


def clamp(v, lo=0.0, hi=100.0): return max(lo, min(hi, v))
def rnd(v, d=2): return None if v is None else round(v, d)
def compact(d): return {k: v for k, v in d.items() if v is not None}


def spark(c, n=24):
    """A tiny equity line for the table: up to n points of the stored curve."""
    if not c or not c.get("s"): return None
    s = c["s"]; step = max(1, len(s) // n)
    pts = s[::step]
    if pts[-1] != s[-1]: pts.append(s[-1])
    return [round(v, 1) for v in pts]


def practicality(trades, dd):
    t = min(1.0, (trades or 0) / 100)
    d = max(0.0, 1 - abs(dd or 0) / 150)
    return 100 * t * d


def edge_part(pf, beat):
    if pf is None: return 0.0
    return clamp((pf - 1) * 100) * (1.0 if beat else 0.5)


# ---------------------------------------------------------------- TradingView (Foresight) rows
def pine_rows():
    meta = json.loads((DASH / "data/exports/pine_meta.json").read_text(encoding="utf-8"))
    cols = meta["columns"]; strategies = meta["strategies"]
    rows = []
    for f in sorted(glob.glob(str(DASH / "data/exports/pine_results_*.json"))):
        for v in json.loads(Path(f).read_text(encoding="utf-8"))["rows"]:
            rows.append(dict(zip(cols, v)))
    return rows, strategies


def pine_held(r):
    g = lambda k: r.get(k) or 0
    return (g("is_trades") >= 10 and g("oos_trades") >= 5 and g("is_avg_trade") > 0 and g("oos_avg_trade") > 0
            and g("oos_profit_factor") > 1 and g("is_edge_trade") > 0 and g("oos_edge_trade") > 0)


# ---------------------------------------------------------------- TrendSpider rows
def ts_rows():
    raw = json.loads((DASH / "data/exports/results.json").read_text(encoding="utf-8"))
    cols = raw["columns"]
    cls = json.loads((DASH / "config/strategy_classification.json").read_text(encoding="utf-8"))["categories"]
    by = collections.defaultdict(dict)                       # (strategy, ticker, tf) -> depth -> row
    for v in raw["rows"]:
        r = dict(zip(cols, v))
        if not r.get("trade_count") or (r.get("net_profit_pct") or 0) > 10000: continue
        by[(r["strategy_name"], r["ticker"], TS_TF.get(r["timeframe"], r["timeframe"]))][r["depth"]] = r
    return by, cls


def main():
    t0 = time.time()
    names = json.loads((SCREEN / "symbols.json").read_text(encoding="utf-8")) if (SCREEN / "symbols.json").exists() else {}
    curves = json.loads((SCREEN / "curves.json").read_text(encoding="utf-8")) if (SCREEN / "curves.json").exists() else {}
    prows, pstrat = pine_rows()
    periods = load_periods()
    tsby, tscls = ts_rows()

    # breadth: per strategy x timeframe, share of tickers held up (min 30 trades), Wilson low
    groups = collections.defaultdict(list)
    for r in prows:
        if (r["trades"] or 0) >= 30: groups[("tv", r["strategy_id"], r["timeframe"])].append(pine_held(r))
    ts_last = {}
    for (name, tk, tf), d in tsby.items():
        deep = d[max(d)]
        ts_last[(name, tk, tf)] = deep
        if (deep.get("trade_count") or 0) >= 10:
            groups[("ts", name, tf)].append((deep.get("net_profit_pct") or 0) > (deep.get("asset_perf") or 0)
                                            and (deep.get("net_profit_pct") or 0) > 0)
    breadth = {k: (100 * wilson_low(sum(v), len(v)), sum(v), len(v)) for k, v in groups.items()}

    per_symbol = collections.defaultdict(list)
    strategies = {}
    # ---- TradingView runs
    for r in prows:
        sid, tf, tk = r["strategy_id"], r["timeframe"], r["ticker"]
        s = pstrat.get(sid, {})
        rep = (s.get("repaint") or {}).get(tf, {}).get("verdict")
        wins = [r.get("is_avg_trade"), r.get("oos_avg_trade")] + [r.get(f"d{d}_avg_trade") for d in DEPTHS
                                                                 if (r.get(f"d{d}_trades") or 0) >= 5]
        wins = [w for w in wins if w is not None]
        cons = 100 * sum(1 for w in wins if w > 0) / len(wins) if wins else 0
        b = breadth.get(("tv", sid, tf), (0, 0, 0))
        beat = (r.get("edge_trade") or 0) > 0
        parts = {"consistency": cons, "breadth": b[0], "edge": edge_part(r.get("profit_factor"), beat),
                 "practicality": practicality(r.get("trades"), r.get("trade_max_dd"))}
        score = None if rep == "repaints" else round(st.fmean(parts.values()))
        key = f"tv:{sid}:{tf}"
        pr = periods.get((tk, tf, sid))
        per_symbol[tk].append({
            "m1": pr["p1m"].get("net", 0.0) if pr else None, "m3": pr["p3m"].get("net", 0.0) if pr else None,
            "m6": pr["p6m"].get("net", 0.0) if pr else None, "asof": pr["end"] if pr else None,
            "recent": {k: pr[k] for k in ("p1m", "p3m", "p6m", "months")} if pr else None,
            **{f"t{k}": (pr[f"p{k}m"].get("n") if pr else None) for k in (1, 3, 6)},
            **{f"w{k}": (pr[f"p{k}m"].get("win") if pr else None) for k in (1, 3, 6)},
            **{f"pf{k}": (pr[f"p{k}m"].get("pf") if pr else None) for k in (1, 3, 6)},
            "spark": spark(curves.get(f"{tk}|{key}")),
            "dir": ("both" if (r.get("longs") or 0) and (r.get("shorts") or 0) else "long" if (r.get("longs") or 0) else "short" if (r.get("shorts") or 0) else None),
            "id": key, "src": "tv", "sid": sid, "tf": tf, "score": score,
            "parts": {k: round(v) for k, v in parts.items()}, "held": pine_held(r), "repaint": rep,
            "breadth": [b[1], b[2]],
            "net": rnd(r.get("net_profit_pct")), "dd": rnd(r.get("trade_max_dd")), "trades": r.get("trades"),
            "win": rnd(r.get("win_rate"), 1), "pf": rnd(r.get("profit_factor")), "avg": rnd(r.get("avg_trade"), 3),
            "med": rnd(r.get("median_trade"), 3), "edge": rnd(r.get("edge_trade"), 3), "bh": rnd(r.get("buyhold_pct"), 1),
            "longs": r.get("longs"), "shorts": r.get("shorts"), "bars_held": rnd(r.get("avg_bars"), 1),
            "sharpe": rnd(r.get("sharpe")), "sortino": rnd(r.get("sortino")), "tpm": rnd(r.get("trades_per_month"), 1),
            "from": (r.get("from") or "")[:10], "to": (r.get("to") or "")[:10], "bars": r.get("bars"),
            "windows": {k: compact(v) for k, v in {
                "first70": {"n": r.get("is_trades"), "avg": rnd(r.get("is_avg_trade"), 3), "pf": rnd(r.get("is_profit_factor")),
                            "win": rnd(r.get("is_win_rate"), 1), "edge": rnd(r.get("is_edge_trade"), 3), "net": rnd(r.get("is_net_pct"))},
                "last30": {"n": r.get("oos_trades"), "avg": rnd(r.get("oos_avg_trade"), 3), "pf": rnd(r.get("oos_profit_factor")),
                           "win": rnd(r.get("oos_win_rate"), 1), "edge": rnd(r.get("oos_edge_trade"), 3), "net": rnd(r.get("oos_net_pct")),
                           "dd": rnd(r.get("oos_max_dd")), "from": r.get("oos_from")},
                **{str(d): {"n": r.get(f"d{d}_trades"), "avg": rnd(r.get(f"d{d}_avg_trade"), 3), "pf": rnd(r.get(f"d{d}_profit_factor")),
                            "win": rnd(r.get(f"d{d}_win_rate"), 1), "net": rnd(r.get(f"d{d}_net_pct")), "dd": rnd(r.get(f"d{d}_max_dd")),
                            "from": r.get(f"d{d}_from")} for d in DEPTHS if r.get(f"d{d}_trades") is not None},
            }.items()},
            "curve": curves.get(f"{tk}|{key}"),
        })
        if sid not in strategies:
            strategies[sid] = {"title": s.get("title") or sid, "author": s.get("author"), "url": s.get("url"), "src": "tv",
                               "dup_of": s.get("dup_of"),
                               "repaint": {k: v.get("verdict") for k, v in (s.get("repaint") or {}).items()}}
    # ---- TrendSpider runs (headline = the deepest window; every depth in the report)
    for (name, tk, tf), d in tsby.items():
        deep = ts_last[(name, tk, tf)]
        sid = "ts-" + "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
        nets = [x.get("net_profit_pct") for x in d.values() if x.get("net_profit_pct") is not None]
        cons = 100 * sum(1 for n in nets if n > 0) / len(nets) if nets else 0
        b = breadth.get(("ts", name, tf), (0, 0, 0))
        win = (deep.get("win_rate") or 0) / 100
        aw, al = deep.get("avg_winner"), deep.get("avg_loser")
        pf = (win * aw) / ((1 - win) * abs(al)) if aw is not None and al and win < 1 else None
        beat = (deep.get("net_profit_pct") or 0) > (deep.get("asset_perf") or 0)
        parts = {"consistency": cons, "breadth": b[0], "edge": edge_part(pf, beat),
                 "practicality": practicality(deep.get("trade_count"), deep.get("max_drawdown"))}
        key = f"ts:{sid}:{tf}"
        rec_d = d[max(dp for dp, x in d.items())]
        per_symbol[tk].append({
            # TrendSpider's own figures, as of the day that batch ran (not today)
            "m1": rnd(rec_d.get("net_perf_1mo")), "m3": rnd(rec_d.get("net_perf_3mo")), "m6": rnd(rec_d.get("net_perf_6mo")),
            "asof": (rec_d.get("timestamp") or "")[:10] or None,
            "recent": None, "t1": None, "t3": None, "t6": None, "w1": None, "w3": None, "w6": None,
            "pf1": None, "pf3": None, "pf6": None, "spark": None,
            "dir": {"LONG": "long", "SHORT": "short"}.get((deep.get("direction") or "").upper(), "both" if deep.get("direction") else None),
            "id": key, "src": "ts", "sid": sid, "tf": tf, "score": round(st.fmean(parts.values())),
            "parts": {k: round(v) for k, v in parts.items()},
            "held": cons == 100 and beat and (deep.get("net_profit_pct") or 0) > 0, "repaint": None, "breadth": [b[1], b[2]],
            "net": rnd(deep.get("net_profit_pct")), "dd": rnd(deep.get("max_drawdown")), "trades": deep.get("trade_count"),
            "win": rnd(deep.get("win_rate"), 1), "pf": rnd(pf), "avg": rnd(deep.get("avg_trade"), 3), "med": None,
            "edge": rnd((deep.get("net_profit_pct") or 0) - (deep.get("asset_perf") or 0)), "bh": rnd(deep.get("asset_perf"), 1),
            "longs": None, "shorts": None, "bars_held": rnd(deep.get("avg_length"), 1), "sharpe": rnd(deep.get("sharpe")),
            "sortino": rnd(deep.get("sortino")), "tpm": rnd(deep.get("trades_per_month"), 1),
            "from": None, "to": None, "bars": max(d),
            "windows": {str(dp): {"n": x.get("trade_count"), "avg": rnd(x.get("avg_trade"), 3), "win": rnd(x.get("win_rate"), 1),
                                  "net": rnd(x.get("net_profit_pct")), "dd": rnd(x.get("max_drawdown")), "bh": rnd(x.get("asset_perf"), 1)}
                        for dp, x in sorted(d.items())},
            "curve": None,
        })
        if sid not in strategies:
            c = tscls.get(name, {})
            strategies[sid] = {"title": name, "author": None, "url": None, "src": "ts", "dup_of": None, "repaint": {},
                               "family": c.get("family"), "setup": c.get("setup")}

    # ---- per-symbol files and the index
    wl = json.loads((DASH / "config/watchlists.json").read_text(encoding="utf-8"))["watchlists"]
    lists = {w["name"]: w["tickers"] for w in wl}
    (OUT / "symbol").mkdir(parents=True, exist_ok=True)
    index = []
    for tk, runs in sorted(per_symbol.items()):
        runs.sort(key=lambda x: (x["score"] is None, -(x["score"] or 0)))
        scored = [x for x in runs if x["score"] is not None]
        last = None
        csv = SCREEN / "data" / "daily" / f"{tk}.csv"
        if csv.exists():
            lines = csv.read_text(encoding="utf-8").strip().splitlines()
            a, b = lines[-2].split(","), lines[-1].split(",")
            last = {"close": float(b[6]), "chg_pct": round(100 * (float(b[6]) / float(a[6]) - 1), 2), "date": b[1]}
        nets = [x["net"] for x in scored if x["net"] is not None]
        stats = {"backtests": len(runs), "strategies": len({x["sid"] for x in runs}),
                 "tv": sum(1 for x in runs if x["src"] == "tv"), "ts": sum(1 for x in runs if x["src"] == "ts"),
                 "held": sum(1 for x in scored if x["held"]),                       # backtests (strategy x timeframe)
                 "held_strategies": len({x["sid"] for x in scored if x["held"]}),     # distinct strategies
                 "beat_bh_pct": round(100 * sum(1 for x in scored if (x["edge"] or 0) > 0) / len(scored), 1) if scored else None,
                 "median_net": rnd(st.median(nets)) if nets else None,
                 "avg_win": rnd(st.fmean([x["win"] for x in scored if x["win"] is not None]), 1) if scored else None,
                 "median_dd": rnd(st.median([x["dd"] for x in scored if x["dd"] is not None])) if scored else None,
                 "repainting": sum(1 for x in runs if x["repaint"] == "repaints")}
        best = scored[0] if scored else None
        info = names.get(tk, {})
        # Two files per symbol, rows as arrays under one column list, nothing dropped:
        #   <T>.json         what the table needs (loaded with the page)
        #   <T>.detail.json  the report behind each row (windows, score parts, curve...), loaded on demand
        cols = [c for c in TABLE_COLS if c in runs[0]]
        dcols = [c for c in runs[0] if c not in cols or c == "id"]
        doc = {"symbol": tk, "name": info.get("name", tk), "exchange": info.get("exchange", ""), "type": info.get("type", ""),
               "last": last, "stats": stats, "lists": [n for n, t in lists.items() if tk in t],
               "cols": cols, "runs": [[x.get(c) for c in cols] for x in runs]}
        (OUT / "symbol" / f"{tk}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        (OUT / "symbol" / f"{tk}.detail.json").write_text(json.dumps(
            {"cols": dcols, "runs": [[x.get(c) for c in dcols] for x in runs]}, separators=(",", ":")), encoding="utf-8")
        index.append({"symbol": tk, "name": doc["name"], "exchange": doc["exchange"], "type": doc["type"], "last": last,
                      "lists": doc["lists"], "strategies": stats["strategies"], "backtests": stats["backtests"],
                      "held": stats["held_strategies"], "best": {"sid": best["sid"], "tf": best["tf"], "score": best["score"], "src": best["src"]} if best else None})
    (OUT / "symbols.json").write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "lists": list(lists),
                                                 "symbols": index}, separators=(",", ":")), encoding="utf-8")
    (OUT / "strategies.json").write_text(json.dumps(strategies, separators=(",", ":")), encoding="utf-8")
    sizes = [p.stat().st_size for p in (OUT / "symbol").glob("*.json") if not p.name.endswith(".detail.json")]
    print(f"{len(index)} symbols, {sum(len(v) for v in per_symbol.values())} backtests, {len(strategies)} strategies; "
          f"symbol files {min(sizes)/1e6:.2f}-{max(sizes)/1e6:.2f} MB, total {sum(sizes)/1e6:.0f} MB; {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
