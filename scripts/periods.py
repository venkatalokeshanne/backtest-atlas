"""Recent performance for every TradingView backtest that traded: trailing 1, 3 and 6 months, and each of the last 6
calendar months, from the trade list's exit dates. Same per-trade NET % as everywhere else (pl / (entry x size)).
Re-runs each strategy on each dataset (a side handle; the session script for the few that need it).
Output: periods/<tf>/<TICKER>.jsonl, one line per strategy. Resumable (.done markers)."""
import json, os, sys, time, glob
from pathlib import Path
from multiprocessing import Process
import runner

ROOT = runner.ROOT
OUT = ROOT / "periods"
TF_ORDER = ["5m", "15m", "1h", "daily"]
# PHASE=1: only each stock's top backtests (periods_priority.json, what the site shows first); PHASE=2 (default): all
PHASE = os.environ.get("PHASE", "2")
PRIORITY = json.loads((ROOT / "periods_priority.json").read_text()) if PHASE == "1" else None
MARK = ".p1done" if PHASE == "1" else ".done"
SESSION_ONLY = ("crossed runtime contexts", "not valid JSON")


def months_back(ym, k):
    y, m = map(int, ym.split("-")); m -= k
    while m <= 0: m += 12; y -= 1
    return f"{y:04d}-{m:02d}"


def shift_date(d, k):
    """d minus k calendar months (day clamped to 28 so every month has it)."""
    y, m, day = map(int, d.split("-")); m -= k
    while m <= 0: m += 12; y -= 1
    return f"{y:04d}-{m:02d}-{min(day, 28):02d}"


def agg(rs):
    if not rs: return {"n": 0}
    pos = [r for r in rs if r > 0]; neg = [-r for r in rs if r <= 0]
    return {"n": len(rs), "net": round(sum(rs), 3), "win": round(100 * len(pos) / len(rs), 1),
            "pf": round(sum(pos) / sum(neg), 3) if sum(neg) > 0 else None}


def period_stats(trades, dates):
    """trades -> (exit date, net %); trailing windows and calendar months counted back from the data's last bar."""
    last = dates[-1][:10]
    rows = []
    for t in trades:
        den = (t.get("entry_price") or 0) * abs(t.get("size") or 0)
        if den > 0 and t.get("exit_bar") is not None and t["exit_bar"] < len(dates):
            rows.append((dates[t["exit_bar"]][:10], 100 * t["pl"] / den))
    out = {"end": last}
    for k in (1, 3, 6):
        cut = shift_date(last, k)
        out[f"p{k}m"] = agg([r for d, r in rows if d > cut])
    ym = last[:7]
    out["months"] = [{"m": months_back(ym, k), **agg([r for d, r in rows if d[:7] == months_back(ym, k)])} for k in range(5, -1, -1)]
    return out


def trades_of(fs, handle):
    trades, off = [], 0
    while True:
        r = fs.call("get_trades", {"handle": handle, "offset": off, "limit": 1000}, timeout=180)
        if not isinstance(r, dict) or not r.get("trades"): break
        trades += r["trades"]; off += r["count"]
        if off >= r.get("total", 0): break
    return trades


def work(wid, port):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    while True:
        job = None
        for tf in TF_ORDER:
            for f in sorted((ROOT / "results" / tf).glob("*.jsonl")):
                sym = f.stem; od = OUT / tf; od.mkdir(parents=True, exist_ok=True)
                if (od / f"{sym}{MARK}").exists() or (od / f"{sym}.done").exists(): continue
                try:
                    fd = os.open(od / f"{sym}.lock{PHASE}", os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.close(fd)
                except FileExistsError:
                    continue
                job = (tf, sym, f); break
            if job: break
        if not job: break
        tf, sym, f = job
        eng.stop()
        while runner.free_ram_gb() < runner.MIN_FREE_GB: time.sleep(30)     # same memory guard as runner.py
        csv = ROOT / "data" / tf / f"{sym}.csv"
        dates = [l.split(",")[1] for l in open(csv)][1:]
        todo = [json.loads(l) for l in open(f, encoding="utf-8")]
        todo = [r for r in todo if r.get("t_n")]                       # only backtests that traded
        if PRIORITY is not None:
            want = PRIORITY.get(f"{sym}|{tf}", [])
            rank = {s: i for i, s in enumerate(want)}
            todo = sorted([r for r in todo if r["strategy"] in rank], key=lambda r: rank[r["strategy"]])
        out = OUT / tf / f"{sym}.jsonl"
        done = {json.loads(l)["strategy"] for l in open(out, encoding="utf-8")} if out.exists() else set()
        eng.start()
        eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
        t0 = time.time(); n = 0
        with open(out, "a", encoding="utf-8") as fo:
            for r in todo:
                if r["strategy"] in done: continue
                if n and n % runner.RECYCLE_EVERY == 0:
                    eng.start(); eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
                n += 1
                rec = {"strategy": r["strategy"], "ticker": sym, "tf": tf}
                try:
                    h = eng.fs.call("start_run", {"script_path": str(sdir / r["file"]), "detail": "full"}, timeout=180)   # compact detail returns invalid JSON for some scripts
                    if isinstance(h, dict) and h.get("handle"):
                        rec.update(period_stats(trades_of(eng.fs, h["handle"]), dates))
                        eng.fs.call("release_run", {"handle": h["handle"]}, timeout=60)
                    elif any(e in str(h) for e in SESSION_ONLY) or r.get("retried"):
                        # the engine-side failures: run it as the session script, then restore the loader
                        eng.fs.call("load_session", {"script_path": str(sdir / r["file"]), "data_path": str(csv)}, timeout=300)
                        eng.fs.call("run", {}, timeout=300)
                        rec.update(period_stats(trades_of(eng.fs, ""), dates))
                        eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
                    else:
                        rec["error"] = str(h)[:200]
                except Exception as e:
                    rec["error"] = f"timeout/crash: {type(e).__name__}"
                    eng.start(); eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
                fo.write(json.dumps(rec) + "\n"); fo.flush()
        (OUT / tf / f"{sym}{MARK}").write_text(f"{n} runs in {time.time() - t0:.0f}s by w{wid}")
        print(f"w{wid} {tf} {sym}: {n} runs, {time.time() - t0:.0f}s", flush=True)
    eng.stop()


if __name__ == "__main__":
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    for f in OUT.glob("*/*.lock*"): f.unlink()                          # stale locks from a stopped run
    ps = [Process(target=work, args=(i, 17700 + i)) for i in range(nw)]
    for p in ps: p.start(); time.sleep(3)
    for p in ps: p.join()
    print("PERIODS DONE", flush=True)
