"""Keep everything, once: every backtest that traded is run again with TradingView fills and with realistic fills, and
this time ALL of Foresight's summary figures and EVERY trade are saved, so later figures (monthly drawdown, recovery
dates, losing streaks, yearly returns, MAE/MFE from the price data...) are computed from these files, never by re-running.

Same engine settings as before (results/, strict/): opt-0 JIT, strict model with the price-scaled spread, and the same
reference files for runs recover.py brought back. Duplicate strategies are skipped (identical to another).
Order: the Traded watchlist first (all timeframes, both fills), then everything else.

Output, per model (tv | strict) and dataset:
  archive/<model>/<tf>/<T>.summary.jsonl   one line per strategy: every figure Foresight reports for the run
  archive/<model>/<tf>/<T>.trades.bin.gz   every trade, one array per field (layout in <T>.trades.json)
  archive/<model>/<tf>/<T>.trades.json     n, field order and types, strategy -> [first trade, count], text dictionaries
  archive/<model>/<tf>/<T>.check.json      net % from the saved trades vs the stored figure for each strategy
`python archive.py status` prints progress."""
import array, gzip, json, os, sys, time
from pathlib import Path
from multiprocessing import Process
import runner, strict_runner, recover

ROOT = runner.ROOT
OUT = ROOT / "archive"
TFS = ["daily", "1h", "15m", "5m"]
TRADED = open(ROOT / "traded.txt").read().strip().split(",")
SITE = strict_runner.SITE
PAGE = 2000                                   # trades per get_trades call (10,000 is allowed, but big answers stall a busy engine)
# per trade: name, array type code (little-endian on this machine), how to read it from a Foresight trade
FIELDS = [("entry_bar", "I"), ("exit_bar", "i"), ("short", "B"), ("tpsl", "B"), ("entry_price", "d"), ("exit_price", "d"),
          ("size", "d"), ("pl", "d"), ("commission", "d"), ("entry_id", "h"), ("exit_id", "h"), ("exit_comment", "h")]
TEXT = {"entry_id", "exit_id", "exit_comment"}


def dups():
    strat = json.loads((SITE / "strategies.json").read_text(encoding="utf-8"))
    return {sid for sid, s in strat.items() if s.get("dup_of")}


def jobs():
    d = dups(); out = []
    for tf in TFS:
        for f in sorted((ROOT / "results" / tf).glob("*.jsonl")):
            # only what a worker needs: every worker gets the whole list, so keep it small
            todo = [{"strategy": x["strategy"], "file": x["file"], "session": x.get("retried") == "session"}
                    for x in map(json.loads, open(f, encoding="utf-8"))
                    if x.get("t_n") and x["strategy"] not in d]
            if todo: out.append((f.stem, tf, todo))
    out.sort(key=lambda j: (j[0] not in TRADED, TFS.index(j[1]), j[0]))
    return out


def stored(tk, tf):
    """The t_net already stored for each strategy, per model, to check the archive against."""
    o = {}
    for model, folder in (("tv", "results"), ("strict", "strict")):
        f = ROOT / folder / tf / f"{tk}.jsonl"
        o[model] = {x["strategy"]: x.get("t_net") for x in map(json.loads, open(f, encoding="utf-8"))} if f.exists() else {}
    return o


class EngineDown(Exception):
    """The engine stopped answering or lost its data: restart, reload and run the strategy again."""


DOWN = ("not running or not reachable", "No data loaded", "Timed out waiting for Foresight")


def check_up(x):
    if isinstance(x, dict) and any(d in str(x.get("error", "")) for d in DOWN): raise EngineDown(str(x)[:120])
    return x


def fetch_trades(fs, handle):
    """Every trade of the run; anything short of the full list is an engine failure, never a partial save."""
    trades, off, total = [], 0, None
    while True:
        r = check_up(fs.call("get_trades", {"handle": handle, "offset": off, "limit": PAGE}, timeout=300))
        if not isinstance(r, dict) or "trades" not in r: raise EngineDown(f"get_trades answered {str(r)[:120]}")
        if total is None: total = r.get("total", 0)
        if not r["trades"]: break
        trades += r["trades"]; off += r["count"]
        if off >= total: break
    if len(trades) != total: raise EngineDown(f"got {len(trades)} of {total} trades")
    return trades


def net_sum(trades):
    s = 0.0
    for t in trades:
        den = (t.get("entry_price") or 0) * abs(t.get("size") or 0)
        if den > 0 and t.get("exit_bar") is not None: s += 100 * t["pl"] / den
    return s


class Pack:
    """Trades go straight into one array per field as they arrive (a 5m stock has ~1 million trades)."""
    def __init__(self):
        self.cols = {name: array.array(code) for name, code in FIELDS}
        self.dicts = {k: [] for k in TEXT}; self.dix = {k: {} for k in TEXT}
        self.index = {}; self.n = 0

    def add(self, sid, trades):
        self.index[sid] = [self.n, len(trades)]; self.n += len(trades)
        c = self.cols
        for t in trades:
            for k in TEXT:
                v = t.get(k) or ""
                if v not in self.dix[k]: self.dix[k][v] = len(self.dicts[k]); self.dicts[k].append(v)
                c[k].append(self.dix[k][v])
            c["entry_bar"].append(t.get("entry_bar") or 0)
            c["exit_bar"].append(-1 if t.get("exit_bar") is None else t["exit_bar"])
            c["short"].append(1 if t.get("type") == "sell" else 0)
            c["tpsl"].append(1 if t.get("closed_by_tpsl") else 0)
            for k in ("entry_price", "exit_price", "size", "pl", "commission"): c[k].append(t.get(k) or 0.0)

    def write(self, od, tk, summaries, checks):
        blob = b"".join(self.cols[name].tobytes() for name, _ in FIELDS)
        meta = {"n": self.n, "byteorder": sys.byteorder, "fields": [[name, code, self.cols[name].itemsize] for name, code in FIELDS],
                "index": self.index, "text": self.dicts}
        tmp = {k: od / f"{tk}.{k}.tmp" for k in ("summary", "bin", "meta", "check")}
        tmp["summary"].write_text("".join(json.dumps(x) + "\n" for x in summaries), encoding="utf-8")
        tmp["bin"].write_bytes(gzip.compress(blob, 6))
        tmp["meta"].write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        tmp["check"].write_text(json.dumps(checks, separators=(",", ":")), encoding="utf-8")
        for k, final in (("summary", "summary.jsonl"), ("bin", "trades.bin.gz"), ("meta", "trades.json"), ("check", "check.json")):
            os.replace(tmp[k], od / f"{tk}.{final}")        # check.json last: it marks the dataset done


def claim(tk, tf):
    """Take the next dataset off the shared queue (a lock file per dataset; cleared when a new run starts)."""
    (OUT / "locks").mkdir(parents=True, exist_ok=True)
    try:
        os.close(os.open(OUT / "locks" / f"{tf}_{tk}", os.O_CREAT | os.O_EXCL | os.O_WRONLY)); return True
    except FileExistsError:
        return False


def work(wid, port, todo):
    eng = runner.Engine(port)
    sdir = Path(runner.STRATS[0]).parent
    MODELS = ("tv", "strict")
    try:
        for tk, tf, rows in todo:
            if all((OUT / m / tf / f"{tk}.check.json").exists() for m in MODELS) or not claim(tk, tf): continue
            try:
                one(eng, sdir, wid, tk, tf, rows, MODELS)
            except Exception as e:      # never lose the worker: free the dataset for the final pass and carry on
                print(f"w{wid} {tf} {tk}: FAILED ({type(e).__name__}: {str(e)[:120]}); left for the final pass", flush=True)
                (OUT / "locks" / f"{tf}_{tk}").unlink(missing_ok=True)
                try: eng.start()
                except Exception: time.sleep(30)
    finally:
        eng.stop()


def one(eng, sdir, wid, tk, tf, rows, MODELS):
    if True:
        if True:
            t0 = time.time()
            csv = ROOT / "data" / tf / f"{tk}.csv"
            setting = {"tv": {"model": "tv"}, "strict": {"model": "strict", "spread_ticks": strict_runner.spread_ticks(tk)}}
            bn = {}
            fb = ROOT / "results_before_recover" / tf / f"{tk}.jsonl"
            if fb.exists():
                bn = {x["strategy"]: recover.need(x.get("error")) for x in map(json.loads, open(fb, encoding="utf-8")) if recover.need(x.get("error"))}
            # the same conditions as the stored run: references only for strategies recover.py brought back
            groups = [([r for r in rows if r["strategy"] not in bn], []),
                      ([r for r in rows if r["strategy"] in bn], recover.refs_for(tk, tf, set(bn.values())) if bn else [])]
            st = stored(tk, tf)
            summaries = {m: [] for m in MODELS}; packs = {m: Pack() for m in MODELS}; checks = {m: {} for m in MODELS}

            def record(model, rec, h, handle):
                sid = rec["strategy"]
                if isinstance(h, dict) and "ntrade" in h:
                    rec["run"] = {k: v for k, v in h.items() if k != "handle"}
                    tr = fetch_trades(eng.fs, handle) if (h.get("total_trades") or 0) > 0 else []
                    packs[model].add(sid, tr)
                    checks[model][sid] = [round(net_sum(tr), 3), st[model].get(sid)]
                else:
                    rec["error"] = str(h)[:300]
                if handle: eng.fs.call("release_run", {"handle": handle}, timeout=60)
                summaries[model].append(rec)

            for grp, refs in groups:
                if not grp: continue
                eng.stop()
                while runner.free_ram_gb() < runner.MIN_FREE_GB: time.sleep(20)

                def fresh():
                    for _ in range(3):
                        try:
                            eng.start()
                            eng.fs.call("load_session", {"script_path": str(ROOT / "loader.pine"), "data_path": str(csv), "reference_paths": refs}, timeout=600)
                            return
                        except Exception:
                            time.sleep(20)
                    raise RuntimeError("engine would not load the data")
                fresh(); n = 0
                for r in grp:
                    if n and n % runner.RECYCLE_EVERY == 0: fresh()
                    n += 1
                    base = {"strategy": r["strategy"], "file": r["file"], "ticker": tk, "tf": tf}
                    # both fills back to back on the loaded data: the second run reuses the compiled script (~3x faster)
                    # run it the way its stored result was made: some scripts only work, or only match, as the session script
                    session = False
                    if r.get("session"):
                        session = True
                        try: check_up(eng.fs.call("load_session", {"script_path": str(sdir / r["file"]), "data_path": str(csv), "reference_paths": refs}, timeout=600))
                        except Exception:     # the attempts below restart the engine and load it again
                            pass
                    for model in MODELS:
                        for attempt in range(3):
                            rec = dict(base, model=model)
                            if model == "strict": rec["spread_ticks"] = setting["strict"]["spread_ticks"]
                            try:
                                check_up(eng.fs.call("set_broker_model", setting[model], timeout=120))
                                if not session:
                                    h = check_up(eng.fs.call("start_run", {"script_path": str(sdir / r["file"]), "detail": "full"}, timeout=300))
                                    handle = h.get("handle") if isinstance(h, dict) else None
                                    if not handle and any(e in str(h) for e in strict_runner.SESSION_ONLY):
                                        session = True  # engine-side failure: run it as the session script instead
                                        check_up(eng.fs.call("load_session", {"script_path": str(sdir / r["file"]), "data_path": str(csv), "reference_paths": refs}, timeout=600))
                                        check_up(eng.fs.call("set_broker_model", setting[model], timeout=120))
                                if session:
                                    h = check_up(eng.fs.call("run", {}, timeout=300)); handle = ""; rec["route"] = "session"
                                record(model, rec, h, handle)
                                break
                            except Exception as e:
                                if attempt == 2:
                                    rec["error"] = f"engine failed 3 times: {type(e).__name__} {str(e)[:120]}"; summaries[model].append(rec)
                                try:
                                    fresh(); session = False
                                    if r.get("session"):
                                        session = True
                                        eng.fs.call("load_session", {"script_path": str(sdir / r["file"]), "data_path": str(csv), "reference_paths": refs}, timeout=600)
                                except Exception:
                                    time.sleep(10)
                    if session: fresh()
            msg = []
            for m in MODELS:
                od = OUT / m / tf; od.mkdir(parents=True, exist_ok=True)
                packs[m].write(od, tk, summaries[m], checks[m])
                bad = sum(1 for g, w in checks[m].values() if w is not None and abs(g - w) > 0.01)
                msg.append(f"{m} {len(packs[m].index)}/{len(rows)} saved {packs[m].n} trades {bad} differ")
            print(f"w{wid} {tf} {tk}: {'; '.join(msg)}; {time.time() - t0:.0f}s", flush=True)


def status():
    J = jobs(); total = 2 * len(J)
    done = sum(1 for tk, tf, _ in J for m in ("tv", "strict") if (OUT / m / tf / f"{tk}.check.json").exists())
    tr = [(tk, tf) for tk, tf, _ in J if tk in TRADED]
    tdone = sum(1 for tk, tf in tr for m in ("tv", "strict") if (OUT / m / tf / f"{tk}.check.json").exists())
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e9 if OUT.exists() else 0
    print(f"{done}/{total} dataset x fills done (Traded {tdone}/{2 * len(tr)}), {size:.2f} GB")


if __name__ == "__main__":
    if sys.argv[1:] == ["status"]: status(); sys.exit()
    nw = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    J = jobs()
    print(len(J), "datasets,", sum(len(r) for _, _, r in J), "backtests x 2 fills", flush=True)
    if os.environ.get("ONLY"): J = [j for j in J if f"{j[1]}_{j[0]}" == os.environ["ONLY"]]
    if not os.environ.get("KEEPLOCKS"):     # an extra worker joining a running run keeps its locks
        for f in (OUT / "locks").glob("*") if (OUT / "locks").exists() else []: f.unlink()   # locks of a stopped run
    # every worker walks the same list (Traded first) and takes the next dataset nobody has
    base = int(os.environ.get("PORT0", 18300))
    ps = [Process(target=work, args=(i, base + i, J)) for i in range(nw)]
    for p in ps: p.start(); time.sleep(2)
    for p in ps: p.join()
    print("ARCHIVE DONE", flush=True)
