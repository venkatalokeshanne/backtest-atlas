"""Equity curves for the site's report panel: each symbol's top TradingView backtests (top 40 by Backtest Score with
TradingView fills, plus top 40 by score with realistic fills), re-run in Foresight to get the trade list, turned into
the running sum of per-trade net % (the same yardstick as the site's Net %) by exit date, next to buy & hold of the stock
over the same bars. Up to 80 points per curve. Two runs per backtest: TradingView fills -> curves.json, realistic fills
(strict model + price-scaled spread, only for fill-checked rows) -> curves_strict.json. Curves already stored are kept.
Runs that needed other data (recover.py) load the same reference files; engine-side failures use the session route.
Output: {"<TICKER>|tv:<sid>:<tf>": {"t": [...dates], "s": [...strategy %], "b": [...buy & hold %], "start": date}}"""
import json, sys, time, glob
from pathlib import Path
from multiprocessing import Process
import runner, strict_runner, recover

ROOT = runner.ROOT
SITE = Path(r"C:\Users\annev\workspace\backtest-atlas\public\data\symbol")
TFDIR = {"Daily": "daily", "1H": "1h", "15m": "15m", "5m": "5m"}
TOP = int(sys.argv[2]) if len(sys.argv) > 2 else 40
POINTS = 80
OUTS = {"tv": ROOT / "curves.json", "strict": ROOT / "curves_strict.json"}


def stored(kind):
    p = OUTS[kind]
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def jobs():
    have = {k: set(stored(k)) for k in OUTS}
    out = {}
    for f in sorted(SITE.glob("*.json")):
        if f.name.endswith(".detail.json"): continue
        d = json.loads(f.read_text(encoding="utf-8")); ci = {c: i for i, c in enumerate(d["cols"])}
        tv = [r for r in d["runs"] if r[ci["src"]] == "tv"]
        top = sorted([r for r in tv if r[ci["score"]] is not None], key=lambda r: -r[ci["score"]])[:TOP]
        top += sorted([r for r in tv if r[ci["r_score"]] is not None], key=lambda r: -r[ci["r_score"]])[:TOP]
        for r in top:
            key = f"{d['symbol']}|{r[ci['id']]}"
            kinds = [k for k in ("tv", "strict") if key not in have[k] and (k == "tv" or r[ci["fills"]])]
            job = out.setdefault((d["symbol"], r[ci["tf"]]), {})
            for k in kinds: job.setdefault(r[ci["sid"]], set()).add(k)
    return sorted((k, {s: sorted(v) for s, v in j.items() if v}) for k, j in out.items() if any(j.values()))


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
        if den > 0 and t.get("exit_bar") is not None and t["exit_bar"] < len(dates): pts.append((t["exit_bar"], 100 * t["pl"] / den))
    if not pts: return None
    pts.sort(); cum = 0.0; series = []
    for b, r in pts: cum += r; series.append((b, cum))
    first = max(0, min(t["entry_bar"] for t in trades))
    step = max(1, len(series) // POINTS)
    keep = series[::step] + ([series[-1]] if series[-1] not in series[::step] else [])
    base = closes[first]
    return {"t": [dates[b] for b, _ in keep], "s": [round(v, 2) for _, v in keep],
            "b": [round(100 * (closes[b] / base - 1), 2) for b, _ in keep], "start": dates[first]}


def blocked_needs(tk, tfd):
    """What the recovered runs on this dataset asked for (from the pre-recovery error lines)."""
    f = ROOT / "results_before_recover" / tfd / f"{tk}.jsonl"
    if not f.exists(): return {}
    return {x["strategy"]: recover.need(x.get("error")) for x in map(json.loads, open(f, encoding="utf-8")) if recover.need(x.get("error"))}


def work(wid, port, todo):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    files = {Path(p).name.split("-")[0].split(".")[0]: Path(p).name for p in runner.STRATS}
    out = {"tv": {}, "strict": {}}
    for (tk, tf), sids in todo:
        tfd = TFDIR[tf]
        csv = ROOT / "data" / tfd / f"{tk}.csv"
        lines = open(csv).read().splitlines()[1:]
        dates = [l.split(",")[1] + " " + l.split(",")[2][:5] for l in lines]; closes = [float(l.split(",")[6]) for l in lines]
        bn = blocked_needs(tk, tfd)
        # each curve is drawn under the same conditions as its backtest: references only for the recovered strategies
        # (extra files change some scripts: a loaded daily file replaces daily bars built from the chart)
        groups = [([s for s in sids if s not in bn], []), ([s for s in sids if s in bn], recover.refs_for(tk, tfd, set(bn.values())))]
        for (grp, refs), (kind, model) in [(g, k) for g in groups for k in (("tv", {"model": "tv"}), ("strict", {"model": "strict", "spread_ticks": strict_runner.spread_ticks(tk)}))]:
            todo_k = [s for s in grp if kind in sids[s] and s in files]
            if not todo_k: continue

            def fresh():
                eng.start()
                eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv), "reference_paths": refs}, timeout=600)
                eng.fs.call("set_broker_model", model, timeout=120)
            try: fresh()
            except Exception: continue
            for sid in todo_k:
                key = f"{tk}|tv:{sid}:{tf}"
                try:
                    h = eng.fs.call("start_run", {"script_path": str(sdir / files[sid]), "detail": "full"}, timeout=300)
                    if isinstance(h, dict) and h.get("handle"):
                        c = curve_for(eng.fs, h["handle"], dates, closes)
                        eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
                    else:
                        eng.fs.call("load_session", {"script_path": str(sdir / files[sid]), "data_path": str(csv), "reference_paths": refs}, timeout=600)
                        eng.fs.call("set_broker_model", model, timeout=120)
                        full = eng.fs.call("run", {}, timeout=300)
                        c = curve_for(eng.fs, "", dates, closes) if isinstance(full, dict) and "ntrade" in full else None
                        fresh()
                    if c: out[kind][key] = c
                except Exception:
                    try: fresh()
                    except Exception: pass
        for k in out: (ROOT / f"curves_{k}_w{wid}.json").write_text(json.dumps(out[k]), encoding="utf-8")
        print(f"w{wid} {tf} {tk}: {sum(len(v) for v in out.values())} curves so far", flush=True)
    eng.stop()


if __name__ == "__main__":
    if sys.argv[1:2] == ["merge"]:
        for k, path in OUTS.items():
            allc = stored(k)
            for f in glob.glob(str(ROOT / f"curves_{k}_w*.json")): allc.update(json.loads(Path(f).read_text(encoding="utf-8")))
            path.write_text(json.dumps(allc, separators=(",", ":")), encoding="utf-8")
            print(k, len(allc), "curves ->", path)
        sys.exit()
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    for f in glob.glob(str(ROOT / "curves_*_w*.json")): Path(f).unlink()
    J = jobs(); print(len(J), "datasets,", sum(len(ks) for _, s in J for ks in s.values()), "curves to make", flush=True)
    ps = [Process(target=work, args=(i, 17600 + i, J[i::nw])) for i in range(nw)]
    for p in ps: p.start(); time.sleep(2)
    for p in ps: p.join()
    print("CURVES DONE", flush=True)
