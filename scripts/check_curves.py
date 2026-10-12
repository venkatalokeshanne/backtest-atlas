"""Every stored curve must end where its backtest's Net % ends (same run conditions). Lists the ones that do not.
curves.json vs results/ t_net (TradingView fills), curves_strict.json vs strict/ t_net (realistic fills)."""
import json, glob, sys
from pathlib import Path

ROOT = Path(__file__).parent
TFD = {"Daily": "daily", "1H": "1h", "15m": "15m", "5m": "5m"}


def nets(kind):
    out = {}
    for f in glob.glob(str(ROOT / kind / "*" / "*.jsonl")):
        for l in open(f, encoding="utf-8"):
            x = json.loads(l)
            if "error" not in x and x.get("t_net") is not None: out[(x["ticker"], x["tf"], x["strategy"])] = x["t_net"]
    return out


def check(drop=False):
    bad_all = {}
    for name, kind in (("curves.json", "results"), ("curves_strict.json", "strict")):
        cs = json.loads((ROOT / name).read_text(encoding="utf-8")); n = nets(kind)
        bad = []
        for key, c in cs.items():
            tk, rest = key.split("|"); _, sid, tf = rest.split(":")
            want = n.get((tk, TFD[tf], sid))
            if want is None or abs(c["s"][-1] - want) > 0.05: bad.append(key)
        print(f"{name}: {len(cs)} curves, {len(bad)} do not match their Net %")
        bad_all[name] = bad
        if drop and bad:
            for k in bad: cs.pop(k)
            (ROOT / name).write_text(json.dumps(cs, separators=(",", ":")), encoding="utf-8")
    return bad_all


if __name__ == "__main__":
    b = check(drop="drop" in sys.argv)
    for k, v in b.items(): print(k, v[:5])
