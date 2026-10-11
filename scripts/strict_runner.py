"""Realistic-fill re-run of every TradingView backtest that traded (repainting and duplicate ones skipped).

Foresight broker model "strict": exits from the next bar on, the stop wins when a bar touches both stop and target,
trailing stops on closes (no intrabar peaks), and a spread charged on every fill, sized by price:
1 cent below $50, 2 cents $50-200, 3 cents above $200.
Same statistics as the main run (runner.trade_stats: per-trade net %, first 70% / last 30%, depths) plus the last
6 months (periods.period_stats) plus the account-level figures Foresight reports with the script's own sizing.

Order: PHASE=T  every backtest on the Traded watchlist
       PHASE=1  every stock's top 150 per timeframe (periods_priority.json)
       PHASE=2  everything left
Output: strict/<tf>/<TICKER>.jsonl. Resumable (.done markers per phase)."""
import json, os, sys, time
from pathlib import Path
from multiprocessing import Process
import runner, periods

ROOT = runner.ROOT
OUT = ROOT / "strict"
TF_ORDER = ["5m", "15m", "1h", "daily"]
PHASE = os.environ.get("PHASE", "2")
MARK = {"T": ".tdone", "1": ".p1done"}.get(PHASE, ".done")
TRADED = set(open(ROOT / "traded.txt").read().strip().split(","))
PRIORITY = json.loads((ROOT / "periods_priority.json").read_text()) if PHASE == "1" else None
PRICES = json.loads((ROOT / "prices.json").read_text())
SESSION_ONLY = ("crossed runtime contexts", "not valid JSON")
SITE = Path(r"C:\Users\annev\workspace\backtest-atlas\public\data")


def spread_ticks(sym):
    p = PRICES.get(sym, 0)
    return 3 if p > 200 else 2 if p > 50 else 1


def skip_set():
    """(strategy, tf) that repaint, and duplicate strategies: no point re-running them."""
    strat = json.loads((SITE / "strategies.json").read_text(encoding="utf-8"))
    tfmap = {"5m": "5m", "15m": "15m", "1H": "1h", "Daily": "daily"}
    rep = {(sid, tfmap[tf]) for sid, s in strat.items() if s.get("src") == "tv"
           for tf, v in (s.get("repaint") or {}).items() if v == "repaints"}
    dups = {sid for sid, s in strat.items() if s.get("dup_of")}
    return rep, dups


def record(eng, handle_or_session, rec, oos_bar, nbars, dates, full):
    rec.update(runner.pick(full, runner.KEEP)); rec["family"] = full.get("family")
    rec["from"] = full.get("scope", {}).get("from_date"); rec["to"] = full.get("scope", {}).get("to_date")
    if (full.get("total_trades") or 0) > 0:
        rec.update(runner.trade_stats(eng.fs, handle_or_session, oos_bar, nbars, dates))
        rec.update(periods.period_stats(periods.trades_of(eng.fs, handle_or_session), dates))


def work(wid, port):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    rep, dups = skip_set()
    while True:
        job = None
        for tf in TF_ORDER:
            for f in sorted((ROOT / "results" / tf).glob("*.jsonl")):
                sym = f.stem
                if PHASE == "T" and sym not in TRADED: continue
                od = OUT / tf; od.mkdir(parents=True, exist_ok=True)
                if any((od / f"{sym}{m}").exists() for m in (MARK, ".done")): continue
                try:
                    fd = os.open(od / f"{sym}.lock{PHASE}", os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.close(fd)
                except FileExistsError:
                    continue
                job = (tf, sym, f); break
            if job: break
        if not job: break
        tf, sym, f = job
        eng.stop()
        while runner.free_ram_gb() < runner.MIN_FREE_GB: time.sleep(30)
        csv = ROOT / "data" / tf / f"{sym}.csv"
        dates = [l.split(",")[1] for l in open(csv)][1:]
        nbars = len(dates); oos_bar = int(nbars * runner.OOS_FRAC)
        model = {"model": "strict", "spread_ticks": spread_ticks(sym)}
        todo = [json.loads(l) for l in open(f, encoding="utf-8")]
        todo = [r for r in todo if r.get("t_n") and (r["strategy"], tf) not in rep and r["strategy"] not in dups]
        if PRIORITY is not None:
            rank = {s: i for i, s in enumerate(PRIORITY.get(f"{sym}|{tf}", []))}
            todo = sorted([r for r in todo if r["strategy"] in rank], key=lambda r: rank[r["strategy"]])
        out = OUT / tf / f"{sym}.jsonl"
        done = {json.loads(l)["strategy"] for l in open(out, encoding="utf-8")} if out.exists() else set()

        def fresh():
            eng.start()
            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
            eng.fs.call("set_broker_model", model, timeout=120)
        fresh()
        t0 = time.time(); n = 0
        with open(out, "a", encoding="utf-8") as fo:
            for r in todo:
                if r["strategy"] in done: continue
                if n and n % runner.RECYCLE_EVERY == 0: fresh()
                n += 1
                rec = {"strategy": r["strategy"], "file": r["file"], "ticker": sym, "tf": tf, "bars": nbars,
                       "broker": "strict", "spread_ticks": model["spread_ticks"]}
                try:
                    h = eng.fs.call("start_run", {"script_path": str(sdir / r["file"]), "detail": "full"}, timeout=300)
                    if isinstance(h, dict) and h.get("handle"):
                        record(eng, h["handle"], rec, oos_bar, nbars, dates, h)
                        eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
                    elif any(e in str(h) for e in SESSION_ONLY) or r.get("retried"):
                        eng.fs.call("load_session", {"script_path": str(sdir / r["file"]), "data_path": str(csv)}, timeout=300)
                        eng.fs.call("set_broker_model", model, timeout=120)
                        full = eng.fs.call("run", {}, timeout=300)
                        if isinstance(full, dict) and "ntrade" in full: record(eng, "", rec, oos_bar, nbars, dates, full)
                        else: rec["error"] = str(full)[:200]
                        rec["retried"] = "session"
                        eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
                        eng.fs.call("set_broker_model", model, timeout=120)
                    else:
                        rec["error"] = str(h)[:200]
                except Exception as e:
                    rec["error"] = f"timeout/crash: {type(e).__name__}"; fresh()
                fo.write(json.dumps(rec) + "\n"); fo.flush()
        (OUT / tf / f"{sym}{MARK}").write_text(f"{n} runs in {time.time() - t0:.0f}s by w{wid}")
        if PHASE == "2": (OUT / tf / f"{sym}.done").write_text("all")
        print(f"w{wid} {tf} {sym}: {n} runs, {time.time() - t0:.0f}s", flush=True)
    eng.stop()


if __name__ == "__main__":
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    for f in OUT.glob("*/*.lock*"): f.unlink()
    ps = [Process(target=work, args=(i, 17900 + i)) for i in range(nw)]
    for p in ps: p.start(); time.sleep(3)
    for p in ps: p.join()
    print(f"STRICT PHASE {PHASE} DONE", flush=True)
