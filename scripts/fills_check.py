"""Realistic-fill check for the most consistent Traded-watchlist finalists.

Each finalist (ticker x timeframe x strategy) is re-run under three Foresight broker models:
  tv           TradingView's fills (what the site shows)
  strict       exits from the next bar on, stop wins when a bar touches stop and target, close-based trailing,
               1-tick (1 cent) spread
  adversarial  strict + 1 tick of random adverse slippage on every fill
and the same per-trade net % statistics (overall and the last 6 months by month) are recorded for each.
Output: fills_check.json. Nothing here touches the website or pushes anything."""
import json, re, statistics as st, sys, time
from pathlib import Path
from multiprocessing import Process
import runner, periods

ROOT = runner.ROOT
SITE = Path(r"C:\Users\annev\workspace\backtest-atlas\public\data")
TFDIR = {"5m": "5m", "15m": "15m", "1H": "1h", "Daily": "daily"}
MODELS = [("tv", {"model": "tv"}), ("strict", {"model": "strict", "spread_ticks": 1}),
          ("adversarial", {"model": "adversarial", "spread_ticks": 1, "adv_slippage_ticks": 1})]


def finalists():
    """Same criteria as the consistency analysis: 30+ trades, held up, no repaint, no Check fills, every window
    profitable, last 1/3/6 months positive, all 6 months profitable with 3+ trades in each."""
    traded = open(ROOT / "traded.txt").read().strip().split(",")
    strat = json.loads((SITE / "strategies.json").read_text(encoding="utf-8"))
    out = []
    for tk in traded:
        t = json.loads((SITE / "symbol" / f"{tk}.json").read_text(encoding="utf-8")); ci = {c: i for i, c in enumerate(t["cols"])}
        det = json.loads((SITE / "symbol" / f"{tk}.detail.json").read_text(encoding="utf-8")); di = {c: i for i, c in enumerate(det["cols"])}
        detail = {r[di["id"]]: r for r in det["runs"]}
        for r in t["runs"]:
            g = lambda k: r[ci[k]]
            if g("src") != "tv" or g("score") is None or (g("trades") or 0) < 30 or not g("held"): continue
            if g("repaint") == "repaints" or strat.get(g("sid"), {}).get("dup_of"): continue
            d = detail[g("id")]
            if d[di["fills_flag"]] or not d[di["recent"]]: continue
            rec = d[di["recent"]]
            if min((m.get("n") or 0) for m in rec["months"]) < 3: continue
            if not all((m.get("net") or 0) > 0 for m in rec["months"]): continue
            ws = [w.get("avg") for w in d[di["windows"]].values() if w.get("avg") is not None and (w.get("n") or 0) >= 5]
            if len(ws) < 4 or not all(v > 0 for v in ws): continue
            if not ((g("m1") or 0) > 0 and (g("m3") or 0) > 0 and (g("m6") or 0) > 0): continue
            out.append({"ticker": tk, "tf": g("tf"), "sid": g("sid"), "strategy": strat[g("sid")]["title"], "score": g("score")})
    return out


def stats(fs, handle, csv_dates, nbars):
    trades, off = [], 0
    while True:
        r = fs.call("get_trades", {"handle": handle, "offset": off, "limit": 1000}, timeout=180)
        if not isinstance(r, dict) or not r.get("trades"): break
        trades += r["trades"]; off += r["count"]
        if off >= r.get("total", 0): break
    rets = []
    for t in trades:
        den = (t.get("entry_price") or 0) * abs(t.get("size") or 0)
        if den > 0 and t.get("exit_bar") is not None: rets.append(100 * t["pl"] / den)
    if not rets: return {"n": 0}
    pos = [x for x in rets if x > 0]; neg = [-x for x in rets if x <= 0]
    out = {"n": len(rets), "net": round(sum(rets), 2), "win": round(100 * len(pos) / len(rets), 1),
           "pf": round(sum(pos) / sum(neg), 3) if sum(neg) > 0 else None, "avg": round(st.fmean(rets), 4)}
    out.update(periods.period_stats(trades, csv_dates))
    return out


def work(wid, port, jobs, outfile):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    files = {Path(p).name.split("-")[0].split(".")[0]: Path(p).name for p in runner.STRATS}
    res = []
    by = {}
    for j in jobs: by.setdefault((j["ticker"], j["tf"]), []).append(j)
    for (tk, tf), js in by.items():
        csv = ROOT / "data" / TFDIR[tf] / f"{tk}.csv"
        dates = [l.split(",")[1] for l in open(csv)][1:]
        for name, args in MODELS:
            eng.start()
            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
            eng.fs.call("set_broker_model", args, timeout=120)
            for j in js:
                try:
                    h = eng.fs.call("start_run", {"script_path": str(sdir / files[j["sid"]]), "detail": "full"}, timeout=300)
                    s = stats(eng.fs, h["handle"], dates, len(dates)) if isinstance(h, dict) and h.get("handle") else {"error": str(h)[:150]}
                    if isinstance(h, dict) and h.get("handle"): eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
                except Exception as e:
                    s = {"error": f"{type(e).__name__}"}; eng.start()
                    eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
                    eng.fs.call("set_broker_model", args, timeout=120)
                j.setdefault("models", {})[name] = s
        res += js
        Path(outfile).write_text(json.dumps(res), encoding="utf-8")
    eng.stop()


if __name__ == "__main__":
    F = finalists(); print(len(F), "finalists", flush=True)
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    groups = {}
    for f in F: groups.setdefault((f["ticker"], f["tf"]), []).append(f)
    keys = sorted(groups)
    ps = []
    for i in range(nw):
        mine = [f for k in keys[i::nw] for f in groups[k]]
        ps.append(Process(target=work, args=(i, 17810 + i, mine, str(ROOT / f"fills_w{i}.json"))))
    for p in ps: p.start(); time.sleep(2)
    for p in ps: p.join()
    allr = []
    for i in range(nw):
        f = ROOT / f"fills_w{i}.json"
        if f.exists(): allr += json.loads(f.read_text(encoding="utf-8"))
    (ROOT / "fills_check.json").write_text(json.dumps(allr, indent=0), encoding="utf-8")
    print("FILLS DONE", len(allr), flush=True)
