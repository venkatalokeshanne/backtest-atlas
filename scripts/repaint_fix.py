"""Re-check repaint verdicts that failed with DATA_BLOCKED, loading every finer timeframe of the same stock plus the
other-stock / VIX references. Replaces the error lines in repaint.jsonl (original kept as repaint_before_fix.jsonl)."""
import json, shutil
from pathlib import Path
import runner, recover

ROOT = runner.ROOT
P = ROOT / "repaint.jsonl"
rows = [json.loads(l) for l in open(P, encoding="utf-8")]
bad = [i for i, r in enumerate(rows) if "DATA_BLOCKED" in str(r.get("error", ""))]
print(len(bad), "to re-check")
files = {Path(p).name.split("-")[0].split(".")[0]: Path(p).name for p in runner.STRATS}
sdir = Path(runner.STRATS[0]).parent
eng = runner.Engine(18700)
for i in bad:
    r = rows[i]; tf, tk = r["tf"], r["ticker"]
    needs = {("tf", x) for x in recover.TFS} | {("sym", "SPY"), ("vol", "VIX")}
    refs = recover.refs_for(tk, tf, needs)
    rec = {"strategy": r["strategy"], "tf": tf, "ticker": tk}
    try:
        eng.start()
        x = eng.fs.call("load_session", {"script_path": str(sdir / files[r["strategy"]]), "data_path": str(ROOT / "data" / tf / f"{tk}.csv"),
                                         "reference_paths": refs}, timeout=900)
        c = eng.fs.call("check_repaint", {}, timeout=900) if isinstance(x, dict) and "error" not in x else x
        if isinstance(c, dict) and "verdict" in c:
            d = c.get("diff", {})
            rec.update({"verdict": c["verdict"], "vectors": sorted({v.get("vector") for v in c.get("census", {}).get("findings", [])}),
                        "as_written": d.get("trades_as_written"), "confirmed": d.get("trades_confirmed"),
                        "matched": d.get("matched"), "drifted": d.get("drifted")})
        else:
            rec["error"] = str(c)[:200]
    except Exception as e:
        rec["error"] = f"timeout/crash: {type(e).__name__}"
    print(rec["strategy"], tf, tk, rec.get("verdict", rec.get("error", "")[:100]), flush=True)
    rows[i] = rec
eng.stop()
if not (ROOT / "repaint_before_fix.jsonl").exists(): shutil.copy2(P, ROOT / "repaint_before_fix.jsonl")
P.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
