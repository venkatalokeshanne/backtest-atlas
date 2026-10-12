"""Re-run the periods/ and strict/ lines that ended in an error (engine unreachable after the PC slept, watchdog
time-outs). Each stock x timeframe is loaded once; the run goes through start_run, falling back to the session route;
time-outs get a fresh engine and a longer wait. Fixed lines replace the error lines in place (originals kept in
<kind>_before_errretry/). Lines that still fail keep their error."""
import json, os, shutil, sys, time
from pathlib import Path
from multiprocessing import Process
import runner, periods, strict_runner

ROOT = runner.ROOT


def jobs():
    out = []
    for kind in ("periods", "strict"):
        for f in sorted((ROOT / kind).glob("*/*.jsonl")):
            bad = [x for x in map(json.loads, open(f, encoding="utf-8")) if "error" in x]
            if bad: out.append((kind, f.parent.name, f.stem, bad))
    return out


def work(wid, port, todo):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    files = {Path(p).name.split("-")[0].split(".")[0]: Path(p).name for p in runner.STRATS}
    for kind, tf, tk, bad in todo:
        csv = ROOT / "data" / tf / f"{tk}.csv"
        dates = [l.split(",")[1] for l in open(csv)][1:]
        nbars = len(dates); oos_bar = int(nbars * runner.OOS_FRAC)
        model = {"model": "strict", "spread_ticks": strict_runner.spread_ticks(tk)} if kind == "strict" else {"model": "tv"}

        def fresh():
            eng.start()
            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv)}, timeout=300)
            eng.fs.call("set_broker_model", model, timeout=120)
        fresh()
        fixed = {}
        for b in bad:
            sid = b["strategy"]; fn = b.get("file") or files.get(sid)
            if not fn or not (sdir / fn).exists(): continue
            rec = {k: b[k] for k in ("strategy", "file", "ticker", "tf", "bars", "broker", "spread_ticks") if k in b}
            rec["file"] = fn
            try:
                h = eng.fs.call("start_run", {"script_path": str(sdir / fn), "detail": "full"}, timeout=900)
                if isinstance(h, dict) and h.get("handle"):
                    full, handle = h, h["handle"]
                else:
                    eng.fs.call("load_session", {"script_path": str(sdir / fn), "data_path": str(csv)}, timeout=900)
                    eng.fs.call("set_broker_model", model, timeout=120)
                    full, handle = eng.fs.call("run", {}, timeout=900), ""
                if isinstance(full, dict) and "ntrade" in full:
                    if kind == "strict": strict_runner.record(eng, handle, rec, oos_bar, nbars, dates, full)
                    else: rec.update(periods.period_stats(periods.trades_of(eng.fs, handle), dates))
                    rec["retried"] = "errretry"; fixed[sid] = rec
                    print(f"w{wid} {kind} {tf} {tk} {sid}: fixed", flush=True)
                else:
                    print(f"w{wid} {kind} {tf} {tk} {sid}: still {str(full)[:90]}", flush=True)
                if handle: eng.fs.call("release_run", {"handle": handle}, timeout=60)
                else: fresh()
            except Exception as e:
                print(f"w{wid} {kind} {tf} {tk} {sid}: {type(e).__name__}", flush=True); fresh()
        if fixed:
            dst = ROOT / kind / tf / f"{tk}.jsonl"
            bak = ROOT / f"{kind}_before_errretry" / tf; bak.mkdir(parents=True, exist_ok=True)
            if not (bak / dst.name).exists(): shutil.copy2(dst, bak / dst.name)
            rows = [fixed.get(x["strategy"], x) if "error" in x else x for x in map(json.loads, open(dst, encoding="utf-8"))]
            tmp = dst.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8"); os.replace(tmp, dst)
    eng.stop()


if __name__ == "__main__":
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    J = jobs(); print(len(J), "files,", sum(len(b) for *_, b in J), "error lines", flush=True)
    ps = [Process(target=work, args=(i, 18200 + i, J[i::nw])) for i in range(nw)]
    for p in ps: p.start(); time.sleep(3)
    for p in ps: p.join()
    print("ERRRETRY DONE", flush=True)
