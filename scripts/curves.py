"""Equity curves for the site's report panel: the top TradingView backtests per symbol (by Backtest Score), re-run in
Foresight to get the trade list, turned into the running sum of per-trade net % (the same yardstick as the site's
Net %) by exit date, next to buy & hold of the stock over the same bars. Up to 80 points per curve.
Output: curves.json {"<TICKER>|tv:<sid>:<tf>": {"t": [...dates], "s": [...strategy %], "b": [...buy & hold %]}}"""
import json, sys, time, glob
from pathlib import Path
from multiprocessing import Process
import runner

ROOT = runner.ROOT
SITE = Path(r"C:\Users\annev\workspace\backtest-atlas\public\data\symbol")
TFDIR = {"Daily": "daily", "1H": "1h", "15m": "15m", "5m": "5m"}
TOP = int(sys.argv[2]) if len(sys.argv) > 2 else 40
POINTS = 80


def jobs():
    out = {}
    for f in sorted(SITE.glob("*.json")):
        if f.name.endswith(".detail.json"): continue
        d = json.loads(f.read_text(encoding="utf-8")); ci = {c: i for i, c in enumerate(d["cols"])}
        tv = [r for r in d["runs"] if r[ci["src"]] == "tv" and r[ci["score"]] is not None][:TOP]
        for r in tv: out.setdefault((d["symbol"], r[ci["tf"]]), []).append(r[ci["sid"]])
    return sorted(out.items())


def curve_for(fs, handle, dates, closes):
    trades, off = [], 0
    while True:
        r = fs.call("get_trades", {"handle": handle, "offset": off, "limit": 1000}, timeout=180)
        if not isinstance(r, dict) or not r.get("trades"): break
        trades += r["trades"]; off += r["count"]
        if off >= r.get("total", 0): break
    pts = []
    for t in trades:
        den = (t.get("entry_price") or 0) * abs(t.get("size") or 0)
        if den > 0 and t.get("exit_bar") is not None: pts.append((t["exit_bar"], 100 * t["pl"] / den))
    if not pts: return None
    pts.sort(); cum = 0.0; series = []
    for b, r in pts: cum += r; series.append((b, cum))
    first = max(0, min(t["entry_bar"] for t in trades))
    step = max(1, len(series) // POINTS)
    keep = series[::step] + ([series[-1]] if series[-1] not in series[::step] else [])
    base = closes[first]
    return {"t": [dates[b] for b, _ in keep], "s": [round(v, 2) for _, v in keep],
            "b": [round(100 * (closes[b] / base - 1), 2) for b, _ in keep], "start": dates[first]}


def work(wid, port, todo):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    files = {Path(p).name.split("-")[0].split(".")[0]: Path(p).name for p in runner.STRATS}
    out = {}
    for n, ((tk, tf), sids) in enumerate(todo):
        if n and n % 6 == 0: eng.start()
        csv = ROOT / "data" / TFDIR[tf] / f"{tk}.csv"
        lines = open(csv).read().splitlines()[1:]
        dates = [l.split(",")[1] + " " + l.split(",")[2][:5] for l in lines]; closes = [float(l.split(",")[6]) for l in lines]
        try:
            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
        except Exception:
            eng.start(); continue
        for sid in sids:
            key = f"{tk}|tv:{sid}:{tf}"
            try:
                h = eng.fs.call("start_run", {"script_path": str(sdir / files[sid])}, timeout=300)
                if isinstance(h, dict) and h.get("handle"):
                    c = curve_for(eng.fs, h["handle"], dates, closes)
                    if c: out[key] = c
                    eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
            except Exception:
                eng.start()
                eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
        (ROOT / f"curves_w{wid}.json").write_text(json.dumps(out), encoding="utf-8")
    eng.stop()


if __name__ == "__main__":
    if sys.argv[1:2] == ["merge"]:
        allc = {}
        for f in glob.glob(str(ROOT / "curves_w*.json")): allc.update(json.loads(Path(f).read_text(encoding="utf-8")))
        (ROOT / "curves.json").write_text(json.dumps(allc, separators=(",", ":")), encoding="utf-8")
        print(len(allc), "curves ->", ROOT / "curves.json"); sys.exit()
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    J = jobs(); print(len(J), "datasets,", sum(len(s) for _, s in J), "curves", flush=True)
    ps = [Process(target=work, args=(i, 17600 + i, J[i::nw])) for i in range(nw)]
    for p in ps: p.start(); time.sleep(2)
    for p in ps: p.join()
    print("CURVES DONE", flush=True)
