"""Figures computed from the saved trades (archive.py), never by re-running: drawdown for the trailing 1/3/6 months and
for each of the last 6 calendar months, the worst drawdown with its dates and recovery, the current drawdown, year by
year results, and the longest winning / losing streaks. Same yardstick as the site: per-trade net % = pl/(entry*size),
summed (not compounded), drawdown = largest fall of that running sum; trades counted in the month/year they closed,
months and windows counted back from the data's last bar exactly as periods.py does.

Writes extras/<model>/<tf>/<T>.json {strategy: {...}} for every archived dataset (skips ones already up to date) and
checks the 6-month net % against the stored recent figures. `python extras.py` (all) or `python extras.py NVDA ...`."""
import array, gzip, json, sys
from datetime import date
from pathlib import Path
from periods import agg, months_back, shift_date

ROOT = Path(__file__).parent
ARCH = ROOT / "archive"
OUT = ROOT / "extras"


def load(model, tf, tk):
    od = ARCH / model / tf
    meta = json.loads((od / f"{tk}.trades.json").read_text(encoding="utf-8"))
    blob = gzip.decompress((od / f"{tk}.trades.bin.gz").read_bytes())
    n, off, cols = meta["n"], 0, {}
    for name, code, size in meta["fields"]:
        a = array.array(code); a.frombytes(blob[off:off + n * size]); off += n * size
        if meta["byteorder"] != sys.byteorder: a.byteswap()
        cols[name] = a
    return meta, cols


def dd_of(rs):
    cum = peak = dd = 0.0
    for r in rs:
        cum += r; peak = max(peak, cum); dd = max(dd, peak - cum)
    return round(dd, 3)


def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def figures(rows, first_date, last):
    """rows: (exit date YYYY-MM-DD, net %) in exit order."""
    out = {}
    for k in (1, 3, 6):
        cut = shift_date(last, k)
        out[f"dd{k}"] = dd_of([r for d, r in rows if d > cut])
    ym = last[:7]
    out["mdd"] = [dd_of([r for d, r in rows if d[:7] == months_back(ym, k)]) for k in range(5, -1, -1)]
    # worst drawdown of the whole run: from the high before it to its low, and when (if) the sum got back above that high
    cum = peak = 0.0; pk = -1; best = (0.0, -1, -1); series = []
    for i, (d, r) in enumerate(rows):
        cum += r; series.append(cum)
        if cum > peak: peak, pk = cum, i
        if peak - cum > best[0]: best = (peak - cum, pk, i)
    if best[0] > 0:
        depth, p, t = best
        hi = series[p] if p >= 0 else 0.0
        rec = next((k for k in range(t + 1, len(series)) if series[k] >= hi), None)
        start = rows[p][0] if p >= 0 else first_date
        out["worst"] = {"dd": round(depth, 3), "peak": start, "trough": rows[t][0], "rec": rows[rec][0] if rec is not None else None,
                        "n": t - p if p >= 0 else t + 1, "days": days(start, rows[t][0]),
                        "rdays": days(rows[t][0], rows[rec][0]) if rec is not None else None}
    else:
        out["worst"] = None
    # where it stands now: below its best by how much, since when
    top = max([0.0] + series); ti = max((i for i, v in enumerate(series) if v == top), default=-1) if series and top > 0 else -1
    out["cur"] = {"dd": round(top - (series[-1] if series else 0.0), 3), "since": rows[ti][0] if ti >= 0 else first_date}
    # year by year
    years = {}
    for d, r in rows: years.setdefault(d[:4], []).append(r)
    out["years"] = [[y, len(rs), round(sum(rs), 3), dd_of(rs), round(100 * sum(1 for x in rs if x > 0) / len(rs), 1)]
                    for y, rs in sorted(years.items())]
    # streaks (a loss is a trade at or below zero, as in the win rate)
    lw = ll = cw = cl = 0
    for _, r in rows:
        if r > 0: cw += 1; cl = 0
        else: cl += 1; cw = 0
        lw, ll = max(lw, cw), max(ll, cl)
    out["streak"] = {"win": lw, "loss": ll}
    return out


def build(model, tf, tk):
    src = ARCH / model / tf / f"{tk}.check.json"
    dst = OUT / model / tf / f"{tk}.json"
    if not src.exists() or (dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime): return None
    meta, c = load(model, tf, tk)
    dates = [l.split(",")[1] for l in open(ROOT / "data" / tf / f"{tk}.csv")][1:]
    last, first = dates[-1][:10], dates[0][:10]
    res = {}
    for sid, (s0, cnt) in meta["index"].items():
        rows = []
        for i in range(s0, s0 + cnt):
            den = c["entry_price"][i] * abs(c["size"][i]); xb = c["exit_bar"][i]
            if den > 0 and 0 <= xb < len(dates): rows.append((xb, c["entry_bar"][i], 100 * c["pl"][i] / den))
        rows.sort(key=lambda x: (x[0], x[1]))                   # exit order, as trade_stats
        dated = [(dates[xb][:10], r) for xb, _, r in rows]
        res[sid] = figures(dated, first, last)
        # the recent figures again, from the saved (count-checked) trades, the same way periods.py makes them
        res[sid]["recent"] = {"end": last, **{f"p{k}m": agg([r for d, r in dated if d > shift_date(last, k)]) for k in (1, 3, 6)},
                              "months": [{"m": months_back(last[:7], k), **agg([r for d, r in dated if d[:7] == months_back(last[:7], k)])}
                                         for k in range(5, -1, -1)]}
        res[sid]["_net6"] = round(sum(r for xb, _, r in rows if dates[xb][:10] > shift_date(last, 6)), 3)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(res, separators=(",", ":")), encoding="utf-8")
    return res


def check(model, tf, tk, res):
    """6-month net % from the trades vs the stored recent figure (periods/ for tv, strict/ for realistic)."""
    f = ROOT / ("periods" if model == "tv" else "strict") / tf / f"{tk}.jsonl"
    if not f.exists(): return 0, 0
    want = {x["strategy"]: x["p6m"].get("net", 0.0) for x in map(json.loads, open(f, encoding="utf-8")) if "p6m" in x}
    n = bad = 0
    for sid, v in res.items():
        if sid in want: n += 1; bad += abs(v["_net6"] - want[sid]) > 0.01
    return n, bad


if __name__ == "__main__":
    only = set(sys.argv[1:])
    tot = [0, 0, 0]
    for f in sorted(ARCH.glob("*/*/*.check.json")):
        model, tf, tk = f.parent.parent.name, f.parent.name, f.name.split(".")[0]
        if only and tk not in only: continue
        res = build(model, tf, tk)
        if res is None: continue
        n, bad = check(model, tf, tk, res)
        tot[0] += 1; tot[1] += n; tot[2] += bad
        if bad: print(f"{model} {tf} {tk}: {bad}/{n} six-month figures differ from stored", flush=True)
    print(f"{tot[0]} datasets built; six-month net checked on {tot[1]} backtests, {tot[2]} differ")
