"""Build the site's static data from every backtest we have:

  * TradingView Pine strategies run as published by Foresight (backtest-results-dashboard/data/exports/pine_*.json)
  * TrendSpider strategy runs (backtest-results-dashboard/data/exports/results.json, depths 1000-4000 bars)

Writes public/data/symbols.json (the "Explore by symbol" index), public/data/strategies.json and
public/data/symbol/<TICKER>.json (every backtest on that symbol, with its score and report).

Backtest Score v2 (0-100) = weighted mean of five parts, each 0-100 (TrendSpider: the first four, renormalised):
  Consistency  share of the windows it was judged on that made money per trade
               (TradingView: first 70%, last 30%, last 1000/2000/3000/4000 bars; TrendSpider: the 4 depths)
  Breadth      the same strategy and timeframe across all our tickers: share that held up, marked down when
               there are few (lower end of the 90% Wilson interval)
  Edge         profit factor (1 -> 0, 2+ -> 100), halved when it did not beat simply holding the stock
  Practicality enough trades to mean something (100+) and a drawdown that is livable          (15%)
  Recent       TradingView only: last 6 calendar months (share profitable), last-6-month PF, last 3 / 1 months
                                                                                              (20%)
  Consistency 20%, Breadth 25%, Edge 20% (x a trade-count confidence factor: 200+ trades = full).
  Win rate >= 85% or PF >= 5 ("Check fills"): the score x 0.6 until verified with realistic fills.
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
              "sharpe", "sortino", "bars_held", "tpm", "spark", "dir",
              # realistic fills (Foresight strict broker model + price-scaled spread); None until re-run
              "fills", "r_score", "r_held", "r_net", "r_dd", "r_trades", "r_win", "r_pf", "r_avg", "r_edge",
              "r_m1", "r_m3", "r_m6", "r_t1", "r_t3", "r_t6", "r_w1", "r_w3", "r_w6", "r_pf1", "r_pf3", "r_pf6",
              "r_breadth", "acct", "acct_dd", "luck", "tested"]
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


def load_strict():
    """Realistic-fill re-runs (pine_screen/strict_runner.py): (ticker, tf, strategy) -> record."""
    out = {}
    for f in glob.glob(str(SCREEN / "strict" / "*" / "*.jsonl")):
        for line in open(f, encoding="utf-8"):
            try: x = json.loads(line)
            except Exception: continue
            if "error" not in x: out[(x["ticker"], PERIOD_TF[x["tf"]], x["strategy"])] = x
    return out


def drift_per_bar(x):
    bh, bars = x.get("buyhold_return_pct"), x.get("bars")
    if bh is None or not bars or bh <= -1: return None
    return 100 * ((1 + bh) ** (1 / bars) - 1)


def edge_over_drift(avg, hold_bars, x):
    """Per-trade % beyond holding the stock for the same time and direction (same rule as the dashboard export)."""
    d = drift_per_bar(x)
    n = (x.get("t_long") or 0) + (x.get("t_short") or 0)
    if avg is None or d is None or not hold_bars or not n: return None
    return avg - d * hold_bars * ((x.get("t_long") or 0) - (x.get("t_short") or 0)) / n


def strict_row(x):
    """A realistic-fill record in the same shape as the TradingView export rows, so it is scored identically."""
    if not x.get("t_n"): return None
    r = {"trades": x.get("t_n"), "win_rate": x.get("t_win"), "avg_trade": x.get("t_avg"), "median_trade": x.get("t_med"),
         "profit_factor": x.get("t_pf"), "net_profit_pct": x.get("t_net"),
         "trade_max_dd": None if x.get("t_dd") is None else -x["t_dd"],
         "is_trades": x.get("is_n"), "is_avg_trade": x.get("is_avg"), "is_profit_factor": x.get("is_pf"), "is_win_rate": x.get("is_win"),
         "oos_trades": x.get("oos_n"), "oos_avg_trade": x.get("oos_avg"), "oos_profit_factor": x.get("oos_pf"), "oos_win_rate": x.get("oos_win"),
         "edge_trade": edge_over_drift(x.get("t_avg"), x.get("t_bars"), x),
         "is_edge_trade": edge_over_drift(x.get("is_avg"), x.get("is_bars"), x),
         "oos_edge_trade": edge_over_drift(x.get("oos_avg"), x.get("oos_bars"), x),
         "avgwin": x.get("t_avgwin"), "avgloss": x.get("t_avgloss"),
         "acct": None if x.get("total_return_pct") is None else 100 * x["total_return_pct"],
         "acct_dd": None if x.get("mdd") is None else 100 * x["mdd"]}
    for d in DEPTHS:
        r[f"d{d}_trades"] = x.get(f"d{d}_n"); r[f"d{d}_avg_trade"] = x.get(f"d{d}_avg")
    return r


def luck_label(n, avg, win, avgwin, avgloss, tested):
    """How likely a per-trade edge this size is just luck, given how many strategies were tried on the same stock and
    timeframe (Bonferroni). Per-trade spread estimated from win rate and average win / loss."""
    if not n or n < 10 or avg is None or win is None or avgwin is None or avgloss is None: return None
    w = win / 100
    var = w * avgwin ** 2 + (1 - w) * avgloss ** 2 - avg ** 2
    if var <= 0: return None
    t = avg / math.sqrt(var / n)
    p = 0.5 * math.erfc(t / math.sqrt(2))                     # one-sided
    padj = min(1.0, p * max(tested, 1))
    return "unlikely" if padj < 0.05 else "possible" if padj < 0.5 else "likely"


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


# Score v2 weights. TradingView backtests have a fifth part, Recent; TrendSpider's recent figures are weeks old
# and have no monthly breakdown, so it is scored on the other four, renormalised to the same total.
WEIGHTS = {"consistency": 0.20, "breadth": 0.25, "edge": 0.20, "practicality": 0.15, "recent": 0.20}
CHECK_FILLS_FACTOR = 0.6         # win rate >= 85% or PF >= 5: usually optimistic fills inside a bar, not an edge


def confidence(trades):
    """How much the trade count proves: 200+ trades = full weight, 50 = half. Applied to Edge."""
    return min(1.0, math.sqrt(max(trades or 0, 0) / 200))


def recent_part(pr):
    """0-100 from the last 6 months (TradingView only). None when not computed.
    50% monthly consistency: share of traded months that were profitable, pulled to neutral below 4 traded months
    35% last-6-months strength: profit factor (1 -> 0, 2+ -> 100), scaled down below 30 trades
    15% last 3 months and last month: profitable or not, each weighted by its trade count (10+ = full)"""
    if not pr: return None
    traded = [m for m in pr["months"] if m.get("n")]
    k = len(traded)
    pos = sum(1 for m in traded if (m.get("net") or 0) > 0)
    monthly = 100 * (pos + 0.5 * max(0, 4 - k)) / max(k, 4)
    p6 = pr["p6m"]
    if not p6.get("n"):
        six = 0.0
    else:
        pf6 = p6.get("pf")
        base = 100.0 if pf6 is None and (p6.get("net") or 0) > 0 else clamp(((pf6 or 0) - 1) * 100)
        six = base * min(1.0, p6["n"] / 30)
    def sig(x):
        n = x.get("n") or 0
        if not n: return 50.0
        return 50 + (50 if (x.get("net") or 0) > 0 else -50) * min(1.0, n / 10)
    short = (sig(pr["p3m"]) + sig(pr["p1m"])) / 2
    return 0.5 * monthly + 0.35 * six + 0.15 * short


def total_score(parts, win, pf):
    w = {k: v for k, v in WEIGHTS.items() if parts.get(k) is not None}
    base = sum(parts[k] * w[k] for k in w) / sum(w.values())
    flagged = (win or 0) >= 85 or (pf or 0) >= 5
    return round(base * (CHECK_FILLS_FACTOR if flagged else 1.0)), flagged


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


def realistic(r, x, b, rep, tested):
    """Score and headline figures under realistic fills, computed exactly like the TradingView-fill ones."""
    empty = {k: None for k in ("fills", "r_score", "r_held", "r_net", "r_dd", "r_trades", "r_win", "r_pf", "r_avg", "r_edge",
                               "r_m1", "r_m3", "r_m6", "r_t1", "r_t3", "r_t6", "r_w1", "r_w3", "r_w6", "r_pf1", "r_pf3",
                               "r_pf6", "r_breadth", "acct", "acct_dd", "luck", "r_parts", "r_recent", "r_windows", "r_fills_flag")}
    empty["tested"] = tested
    if not r: return empty
    wins = [r.get("is_avg_trade"), r.get("oos_avg_trade")] + [r.get(f"d{d}_avg_trade") for d in DEPTHS
                                                             if (r.get(f"d{d}_trades") or 0) >= 5]
    wins = [w for w in wins if w is not None]
    cons = 100 * sum(1 for w in wins if w > 0) / len(wins) if wins else 0
    beat = (r.get("edge_trade") or 0) > 0
    pr = x if x and "p1m" in x else None
    parts = {"consistency": cons, "breadth": b[0],
             "edge": edge_part(r.get("profit_factor"), beat) * confidence(r.get("trades")),
             "practicality": practicality(r.get("trades"), r.get("trade_max_dd")), "recent": recent_part(pr)}
    score, flagged = total_score(parts, r.get("win_rate"), r.get("profit_factor"))
    if rep == "repaints": score = None
    net, pf = r.get("net_profit_pct"), r.get("profit_factor")
    six = pr["p6m"] if pr else {}
    survives = (pf or 0) > 1 and (net or 0) > 0 and (not six.get("n") or (six.get("net") or 0) > 0)
    out = dict(empty)
    out.update({
        "fills": "survives" if survives else "fails", "r_score": score, "r_held": pine_held(r),
        "r_net": rnd(net), "r_dd": rnd(r.get("trade_max_dd")), "r_trades": r.get("trades"), "r_win": rnd(r.get("win_rate"), 1),
        "r_pf": rnd(pf), "r_avg": rnd(r.get("avg_trade"), 3), "r_edge": rnd(r.get("edge_trade"), 3),
        "r_breadth": [b[1], b[2]], "acct": rnd(r.get("acct"), 1), "acct_dd": rnd(r.get("acct_dd"), 1),
        "luck": luck_label(r.get("trades"), r.get("avg_trade"), r.get("win_rate"), r.get("avgwin"), r.get("avgloss"), tested),
        "r_parts": {k: (None if v is None else round(v)) for k, v in parts.items()}, "r_fills_flag": flagged,
        "r_recent": {k: pr[k] for k in ("p1m", "p3m", "p6m", "months")} if pr else None,
        "r_windows": {"first70": compact({"n": r.get("is_trades"), "avg": rnd(r.get("is_avg_trade"), 3), "pf": rnd(r.get("is_profit_factor"))}),
                      "last30": compact({"n": r.get("oos_trades"), "avg": rnd(r.get("oos_avg_trade"), 3), "pf": rnd(r.get("oos_profit_factor"))})},
    })
    if pr:
        for k in (1, 3, 6):
            p = pr[f"p{k}m"]
            out[f"r_m{k}"] = p.get("net", 0.0); out[f"r_t{k}"] = p.get("n"); out[f"r_w{k}"] = p.get("win"); out[f"r_pf{k}"] = p.get("pf")
    return out


def main():
    t0 = time.time()
    names = json.loads((SCREEN / "symbols.json").read_text(encoding="utf-8")) if (SCREEN / "symbols.json").exists() else {}
    curves = json.loads((SCREEN / "curves.json").read_text(encoding="utf-8")) if (SCREEN / "curves.json").exists() else {}
    prows, pstrat = pine_rows()
    periods = load_periods()
    strict = load_strict()
    srows = {k: strict_row(v) for k, v in strict.items()}
    srows = {k: v for k, v in srows.items() if v}
    tested = collections.Counter((r["ticker"], r["timeframe"]) for r in prows)
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
    for (tk, tf, sid), r in srows.items():
        if (r["trades"] or 0) >= 30: groups[("rf", sid, tf)].append(pine_held(r))
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
        key = f"tv:{sid}:{tf}"
        pr = periods.get((tk, tf, sid))
        parts = {"consistency": cons, "breadth": b[0],
                 "edge": edge_part(r.get("profit_factor"), beat) * confidence(r.get("trades")),
                 "practicality": practicality(r.get("trades"), r.get("trade_max_dd")), "recent": recent_part(pr)}
        score, flagged = total_score(parts, r.get("win_rate"), r.get("profit_factor"))
        if rep == "repaints": score = None
        rf = realistic(srows.get((tk, tf, sid)), strict.get((tk, tf, sid)), breadth.get(("rf", sid, tf), (0, 0, 0)),
                       rep, tested[(tk, tf)])
        per_symbol[tk].append({
            **rf,
            "m1": pr["p1m"].get("net", 0.0) if pr else None, "m3": pr["p3m"].get("net", 0.0) if pr else None,
            "m6": pr["p6m"].get("net", 0.0) if pr else None, "asof": pr["end"] if pr else None,
            "recent": {k: pr[k] for k in ("p1m", "p3m", "p6m", "months")} if pr else None,
            **{f"t{k}": (pr[f"p{k}m"].get("n") if pr else None) for k in (1, 3, 6)},
            **{f"w{k}": (pr[f"p{k}m"].get("win") if pr else None) for k in (1, 3, 6)},
            **{f"pf{k}": (pr[f"p{k}m"].get("pf") if pr else None) for k in (1, 3, 6)},
            "spark": spark(curves.get(f"{tk}|{key}")),
            "dir": ("both" if (r.get("longs") or 0) and (r.get("shorts") or 0) else "long" if (r.get("longs") or 0) else "short" if (r.get("shorts") or 0) else None),
            "id": key, "src": "tv", "sid": sid, "tf": tf, "score": score,
            "parts": {k: (None if v is None else round(v)) for k, v in parts.items()}, "fills_flag": flagged,
            "held": pine_held(r), "repaint": rep,
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
        parts = {"consistency": cons, "breadth": b[0], "edge": edge_part(pf, beat) * confidence(deep.get("trade_count")),
                 "practicality": practicality(deep.get("trade_count"), deep.get("max_drawdown")), "recent": None}
        ts_score, flagged = total_score(parts, deep.get("win_rate"), pf)
        key = f"ts:{sid}:{tf}"
        rec_d = d[max(dp for dp, x in d.items())]
        per_symbol[tk].append({
            # TrendSpider's own figures, as of the day that batch ran (not today)
            "m1": rnd(rec_d.get("net_perf_1mo")), "m3": rnd(rec_d.get("net_perf_3mo")), "m6": rnd(rec_d.get("net_perf_6mo")),
            "asof": (rec_d.get("timestamp") or "")[:10] or None,
            "recent": None, "t1": None, "t3": None, "t6": None, "w1": None, "w3": None, "w6": None,
            "pf1": None, "pf3": None, "pf6": None, "spark": None,
            "dir": {"LONG": "long", "SHORT": "short"}.get((deep.get("direction") or "").upper(), "both" if deep.get("direction") else None),
            **{k: None for k in ("fills", "r_score", "r_held", "r_net", "r_dd", "r_trades", "r_win", "r_pf", "r_avg", "r_edge",
                                 "r_m1", "r_m3", "r_m6", "r_t1", "r_t3", "r_t6", "r_w1", "r_w3", "r_w6", "r_pf1", "r_pf3",
                                 "r_pf6", "r_breadth", "acct", "acct_dd", "luck", "tested", "r_parts", "r_recent",
                                 "r_windows", "r_fills_flag")},
            "id": key, "src": "ts", "sid": sid, "tf": tf, "score": ts_score,
            "parts": {k: (None if v is None else round(v)) for k, v in parts.items()}, "fills_flag": flagged,
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
        # the original view (TradingView fills) is the default ranking; realistic fills are a switch on the stock page
        eff = lambda x: x["score"]
        runs.sort(key=lambda x: (eff(x) is None, -(eff(x) or 0)))
        scored = [x for x in runs if eff(x) is not None]
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
                 "held_strategies": len({x["sid"] for x in scored if x["held"]}),
                 "fill_checked": sum(1 for x in runs if x.get("fills")),
                 "survives_fills": sum(1 for x in runs if x.get("fills") == "survives"),
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
                      "held": stats["held_strategies"], "best": {"sid": best["sid"], "tf": best["tf"], "score": eff(best), "src": best["src"],
                               "fills": best.get("fills")} if best else None,
                      "survives": stats["survives_fills"], "checked": stats["fill_checked"]})
    (OUT / "symbols.json").write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "lists": list(lists),
                                                 "symbols": index}, separators=(",", ":")), encoding="utf-8")
    (OUT / "strategies.json").write_text(json.dumps(strategies, separators=(",", ":")), encoding="utf-8")
    sizes = [p.stat().st_size for p in (OUT / "symbol").glob("*.json") if not p.name.endswith(".detail.json")]
    print(f"{len(index)} symbols, {sum(len(v) for v in per_symbol.values())} backtests, {len(strategies)} strategies; "
          f"symbol files {min(sizes)/1e6:.2f}-{max(sizes)/1e6:.2f} MB, total {sum(sizes)/1e6:.0f} MB; {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
