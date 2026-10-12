"""Recover runs that failed with DATA_BLOCKED because the script asks for data we DO have, just not loaded:
  - the same stock on another timeframe (5m / 15m / 1h / daily; Foresight builds 30m, 240m... from finer bars)
  - other stocks we hold (SPY, QQQ, AAPL, MSFT, NVDA ...) and the CBOE volatility indices VIX, VIX9D, VXN (daily)
Each stock x timeframe is loaded once with exactly the reference files its blocked runs need; every such strategy is
re-run with TradingView fills (results + recent periods) and with realistic fills (strict model + price-scaled spread).
A run that then asks for a second thing we have gets one more pass with that added. Nothing is fabricated: futures, FX,
crypto, indices we lack (DXY, NDX, SPX), 1/2/3-minute and seconds bars stay as errors.
Writes recovered/<kind>/<tf>/<TICKER>.jsonl; `python recover.py merge` folds them into results/, periods/, strict/
(originals kept in *_before_recover/)."""
import json, glob, os, re, shutil, sys, time
from pathlib import Path
from multiprocessing import Process
import runner, strict_runner

ROOT = runner.ROOT
D = ROOT / "data"
OUT = ROOT / "recovered"
TFS = ["5m", "15m", "1h", "daily"]                                  # finest -> coarsest
TICK = {Path(p).stem for p in glob.glob(str(D / "daily" / "*.csv"))}
VOLS = {"VIX", "VIX9D", "VXN"}
BIG = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA", "AMD", "AVGO", "INTC", "ORCL", "IBM",
       "WMT", "QCOM", "MU", "ADBE", "CRM"]                         # long-history names loaded when a script asks for other stocks
TRADED = open(ROOT / "traded.txt").read().strip().split(",")


def need(err):
    """What a DATA_BLOCKED error asks for, if we have it: ('tf', '1h') / ('sym', 'SPY') / ('vol', 'VIX'), else None."""
    e = str(err)
    if "DATA_BLOCKED" not in e: return None
    m = re.search(r"timeframe '(\d+)'", e)
    if m:
        k = int(m.group(1))
        if k % 5: return None
        return ("tf", "daily" if k % 1440 == 0 else "1h" if k % 60 == 0 else "15m" if k % 15 == 0 else "5m")
    m = re.search(r'request\.\*\("([^"]+)"', e)
    if m:
        s = m.group(1).split(":")[-1]
        if s in TICK: return ("sym", s)
        if s in VOLS: return ("vol", s)
    return None


def refs_for(tk, tf, needs):
    own = {n[1] for n in needs if n[0] == "tf"} | set(TFS[TFS.index(tf) + 1:])     # what was asked + every coarser one
    r = [D / x / f"{tk}.csv" for x in TFS if x in own and x != tf]
    syms = {n[1] for n in needs if n[0] == "sym"}
    if syms: r += [D / tf / f"{s}.csv" for s in sorted(syms | set(BIG)) if s != tk]
    if syms or any(n[0] == "vol" for n in needs): r += [ROOT / "ref" / f"CBOE_{v}_daily.csv" for v in sorted(VOLS)]
    return [str(p) for p in r if Path(p).exists()]


def jobs():
    out = []
    for tf in TFS:
        for f in sorted((ROOT / "results" / tf).glob("*.jsonl")):
            blocked = [x for x in map(json.loads, open(f, encoding="utf-8")) if need(x.get("error"))]
            if tf == "daily":                                    # user's choice: on daily charts only other-stock / VIX needs
                blocked = [x for x in blocked if need(x.get("error"))[0] != "tf"]
            if blocked: out.append((f.stem, tf, blocked))
    out.sort(key=lambda j: (j[0] not in TRADED, TFS[::-1].index(j[1]), j[0]))   # Traded stocks first, daily first
    return out


def run_one(eng, sdir, b, csv, refs, model, rec, oos_bar, nbars, dates, fresh):
    try:
        h = eng.fs.call("start_run", {"script_path": str(sdir / b["file"]), "detail": "full"}, timeout=300)
        if isinstance(h, dict) and h.get("handle"):
            strict_runner.record(eng, h["handle"], rec, oos_bar, nbars, dates, h)
            eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
        elif any(e in str(h) for e in strict_runner.SESSION_ONLY):
            eng.fs.call("load_session", {"script_path": str(sdir / b["file"]), "data_path": str(csv), "reference_paths": refs}, timeout=600)
            eng.fs.call("set_broker_model", model, timeout=120)
            full = eng.fs.call("run", {}, timeout=300)
            if isinstance(full, dict) and "ntrade" in full: strict_runner.record(eng, "", rec, oos_bar, nbars, dates, full)
            else: rec["error"] = str(full)[:300]
            rec["retried"] = "session"; fresh()
        else:
            rec["error"] = str(h)[:300]
    except Exception as e:
        rec["error"] = f"timeout/crash: {type(e).__name__}"; fresh()


def work(wid, port, todo):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    for tk, tf, blocked in todo:
        mark = OUT / "done" / f"{tf}_{tk}"
        if mark.exists(): continue
        t0 = time.time()
        csv = D / tf / f"{tk}.csv"
        dates = [l.split(",")[1] for l in open(csv)][1:]
        nbars = len(dates); oos_bar = int(nbars * runner.OOS_FRAC)
        needs = {need(b["error"]) for b in blocked}
        res = {"results": {}, "periods": {}, "strict": {}}
        pending = blocked
        for _ in (1, 2):                                         # pass 2: runs that asked for a second thing we have
            if not pending: break
            refs = refs_for(tk, tf, needs)
            for kind, model in (("tv", {"model": "tv"}), ("strict", {"model": "strict", "spread_ticks": strict_runner.spread_ticks(tk)})):
                eng.stop()
                while runner.free_ram_gb() < runner.MIN_FREE_GB: time.sleep(30)

                def fresh():
                    for attempt in range(3):                     # an engine that does not answer gets replaced, not fatal
                        try:
                            eng.start()
                            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv), "reference_paths": refs}, timeout=600)
                            eng.fs.call("set_broker_model", model, timeout=120)
                            return
                        except Exception:
                            time.sleep(30)
                    raise RuntimeError("engine would not load the data")
                fresh(); n = 0
                for b in pending:
                    if kind == "strict" and not res["results"].get(b["strategy"], {}).get("t_n"): continue
                    if n and n % 120 == 0: fresh()
                    n += 1
                    rec = {"strategy": b["strategy"], "file": b["file"], "ticker": tk, "tf": tf, "bars": nbars, "recovered": "references"}
                    if kind == "strict": rec.update({"broker": "strict", "spread_ticks": model["spread_ticks"]})
                    run_one(eng, sdir, b, csv, refs, model, rec, oos_bar, nbars, dates, fresh)
                    if kind == "tv":
                        res["results"][b["strategy"]] = rec
                        if rec.get("t_n") and "p1m" in rec:
                            res["periods"][b["strategy"]] = {k: rec[k] for k in ("strategy", "ticker", "tf", "end", "p1m", "p3m", "p6m", "months")}
                    else:
                        res["strict"][b["strategy"]] = rec
            more = {need(res["results"][b["strategy"]].get("error")) for b in pending} - {None} - needs
            pending = [b for b in pending if need(res["results"][b["strategy"]].get("error")) in more]
            needs |= more
        for k, rows in res.items():
            od = OUT / k / tf; od.mkdir(parents=True, exist_ok=True)
            tmp = od / f"{tk}.jsonl.tmp"
            with open(tmp, "w", encoding="utf-8") as fo:
                for r in rows.values(): fo.write(json.dumps(r) + "\n")
            os.replace(tmp, od / f"{tk}.jsonl")
        mark.parent.mkdir(parents=True, exist_ok=True); mark.write_text("ok")
        ok = sum(1 for r in res["results"].values() if "error" not in r)
        print(f"w{wid} {tf} {tk}: {ok}/{len(blocked)} recovered, {time.time() - t0:.0f}s", flush=True)
    eng.stop()


def merge():
    stats = {}
    for kind in ("results", "periods", "strict"):
        stats[kind] = 0
        for f in (OUT / kind).glob("*/*.jsonl"):
            tf, tk = f.parent.name, f.stem
            new = [r for r in map(json.loads, open(f, encoding="utf-8")) if "error" not in r]
            if not new: continue
            dst = ROOT / kind / tf / f"{tk}.jsonl"
            bak = ROOT / f"{kind}_before_recover" / tf; bak.mkdir(parents=True, exist_ok=True)
            if dst.exists() and not (bak / dst.name).exists(): shutil.copy2(dst, bak / dst.name)
            old = [json.loads(l) for l in open(dst, encoding="utf-8")] if dst.exists() else []
            byid = {r["strategy"]: r for r in new}
            if kind == "results":                                  # replace the blocked lines in place
                rows = [byid.get(x["strategy"], x) if need(x.get("error")) else x for x in old]
            else:                                                  # add, replacing any earlier error line
                rows = [x for x in old if x["strategy"] not in byid] + new
            tmp = dst.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8"); os.replace(tmp, dst)
            stats[kind] += len(new)
    print("merged", stats)


if __name__ == "__main__":
    if sys.argv[1:] == ["merge"]: merge(); sys.exit()
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    J = jobs(); print(len(J), "datasets,", sum(len(b) for _, _, b in J), "recoverable runs", flush=True)
    if os.environ.get("ONLY"): J = [j for j in J if f"{j[1]}_{j[0]}" == os.environ["ONLY"]]
    ps = [Process(target=work, args=(i, 18000 + i, J[i::nw])) for i in range(nw)]
    for p in ps: p.start(); time.sleep(3)
    for p in ps: p.join()
    print("RECOVER DONE", flush=True)
