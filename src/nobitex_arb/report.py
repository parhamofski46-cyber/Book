"""Report generation: a plain-text summary plus a self-contained HTML page."""

from __future__ import annotations

import html
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

from . import stats
from .storage import Store

FEE_GRID = [0.0, 0.0005, 0.001, 0.0015, 0.002, 0.0025, 0.003, 0.0035, 0.004]

# Annualising a Sharpe ratio or compounding a return from a run measured in
# minutes produces impressive-looking garbage. Below this many hours we
# simply decline to print those numbers.
MIN_HOURS_TO_ANNUALISE = 6.0


def _fmt_irt(x: float, unit: str) -> str:
    if unit == "rial":
        return f"{x/10:,.0f} T"
    return f"{x:,.0f}"


def collect(store: Store, run_id: int) -> dict:
    run = store.rows("SELECT * FROM runs WHERE id=?", (run_id,))
    if not run:
        raise SystemExit(f"run {run_id} not found")
    run = run[0]
    cfg = json.loads(run["config_json"])
    unit = cfg.get("irt_unit", "rial")
    if unit == "auto":
        probe = store.rows(
            "SELECT best_ask FROM snapshots WHERE run_id=? AND symbol='USDTIRT' LIMIT 1", (run_id,)
        )
        unit = "rial" if (probe and probe[0]["best_ask"] >= 200_000) else "toman"

    trades = store.rows("SELECT * FROM trades WHERE run_id=? ORDER BY ts_fill", (run_id,))
    opps = store.rows("SELECT * FROM opportunities WHERE run_id=? ORDER BY ts", (run_id,))
    equity = store.rows("SELECT * FROM equity WHERE run_id=? ORDER BY ts", (run_id,))
    snaps = store.rows("SELECT COUNT(*) AS c, MIN(ts) AS a, MAX(ts) AS b FROM snapshots WHERE run_id=?", (run_id,))[0]

    filled = [t for t in trades if t["outcome"] == "filled"]
    vanished = [t for t in trades if t["outcome"] != "filled"]
    pnls = [float(t["pnl_irt"]) for t in filled]
    realized_bps = [float(t["realized_bps"]) for t in filled]
    expected_bps = [float(t["expected_bps"]) for t in filled]

    started = float(run["started_at"])
    ended = float(run["ended_at"] or (snaps["b"] or started))
    elapsed = max(1.0, ended - started)

    capital = float(cfg.get("capital_irt", 0)) or 1.0
    total_pnl = sum(pnls)
    curve = [float(e["balance"]) for e in equity] or [capital]

    pnl_summary = stats.summarize(pnls)
    per_trade_ret = [p / capital for p in pnls]
    trades_per_year = (len(filled) / elapsed) * 365 * 86_400 if filled else 0.0

    # Latency cost: what the signal promised minus what the fill delivered.
    latency_cost_bps = (
        sum(expected_bps) / len(expected_bps) - sum(realized_bps) / len(realized_bps)
    ) if filled else 0.0

    obis: list[float] = []
    for t in filled:
        try:
            vals = list(json.loads(t["obi_json"]).values())
            obis.append(sum(vals) / len(vals) if vals else 0.0)
        except Exception:
            obis.append(0.0)

    sensitivity = []
    for f in FEE_GRID:
        total = 0.0
        winners = 0
        for t in filled:
            gross_ratio = 1.0 + float(t["gross_bps"]) / 10_000.0
            net_ratio = gross_ratio * (1.0 - f) ** 3
            p = (net_ratio - 1.0) * float(t["size_irt"])
            total += p
            if p > 0:
                winners += 1
        sensitivity.append({"fee": f, "pnl": total, "winners": winners})

    be_fees = sorted(float(t["break_even_fee"]) for t in filled)
    skip_reasons = Counter(o["skip_reason"] for o in opps if not o["taken"] and o["skip_reason"])

    by_hour: dict[int, list[float]] = defaultdict(list)
    for t in filled:
        by_hour[time.localtime(float(t["ts_fill"])).tm_hour].append(float(t["pnl_irt"]))

    tri_stats: dict[str, dict] = defaultdict(lambda: {"n": 0, "pnl": 0.0})
    for t in filled:
        tri_stats[t["triangle"]]["n"] += 1
        tri_stats[t["triangle"]]["pnl"] += float(t["pnl_irt"])

    return {
        "run_id": run_id,
        "unit": unit,
        "config": cfg,
        "started": started,
        "ended": ended,
        "elapsed": elapsed,
        "capital": capital,
        "snapshot_count": int(snaps["c"] or 0),
        "opportunity_count": len(opps),
        "taken_count": sum(1 for o in opps if o["taken"]),
        "filled": filled,
        "vanished_count": len(vanished),
        "pnls": pnls,
        "summary": pnl_summary,
        "total_pnl": total_pnl,
        "total_return": total_pnl / capital,
        "curve": curve,
        "ci": stats.bootstrap_ci(pnls) if len(pnls) > 1 else (0.0, 0.0),
        "p_positive": stats.probability_positive(pnls) if len(pnls) > 1 else 0.0,
        "sharpe": stats.sharpe(per_trade_ret, trades_per_year) if len(pnls) > 1 else 0.0,
        "drawdown": stats.max_drawdown(curve),
        "latency_cost_bps": latency_cost_bps,
        "realized_bps": realized_bps,
        "expected_bps": expected_bps,
        "obi_corr": stats.pearson(obis, realized_bps),
        "sensitivity": sensitivity,
        "median_break_even_fee": be_fees[len(be_fees) // 2] if be_fees else 0.0,
        "skip_reasons": skip_reasons.most_common(10),
        "by_hour": {h: (len(v), sum(v)) for h, v in sorted(by_hour.items())},
        "triangles": dict(tri_stats),
        "proj_30d": stats.compound_projection(total_pnl / capital, elapsed, 30),
        "hours": elapsed / 3600.0,
        "can_annualise": elapsed / 3600.0 >= MIN_HOURS_TO_ANNUALISE,
    }


def verdict(d: dict) -> tuple[str, str]:
    """The honest bottom line, stated before any pretty numbers."""
    n = len(d["pnls"])
    if d["snapshot_count"] == 0:
        return ("NO DATA", "The run collected nothing. Check connectivity and the config.")
    if n == 0:
        return (
            "NO EDGE FOUND",
            "Not a single cycle cleared costs. On this data, an arbitrage bot on these "
            "markets would have traded nothing and earned nothing. That is a useful "
            "result: it cost you no money to learn it.",
        )
    if n < 30:
        return (
            "INSUFFICIENT SAMPLE",
            f"Only {n} fills. Anything below ~30 trades cannot distinguish an edge from "
            "luck, whatever the P&L says. Keep collecting.",
        )
    if d["ci"][0] <= 0:
        return (
            "NOT STATISTICALLY SIGNIFICANT",
            "The 95% bootstrap interval for mean P&L per trade includes zero, so the "
            "observed profit is consistent with random variation. Do not fund this.",
        )
    if d["median_break_even_fee"] < d["config"].get("fee_rate", 0.0025) * 1.3:
        return (
            "FRAGILE EDGE",
            "The edge is real in this sample but sits close to the fee line. A small fee "
            "increase, a slower connection, or thinner books erases it.",
        )
    return (
        "EDGE PRESENT IN SAMPLE",
        "Mean P&L per trade is positive with the confidence interval clear of zero, and "
        "there is margin above the fee line. This still is not proof of future profit: "
        "verify with a longer run before committing capital.",
    )


def to_text(d: dict) -> str:
    u = d["unit"]
    v_head, v_body = verdict(d)
    s: stats.Summary = d["summary"]
    lo, hi = d["ci"]
    dd_abs, dd_pct = d["drawdown"]
    L = []
    A = L.append

    A("=" * 70)
    A(f"  NOBITEX TRIANGULAR ARBITRAGE - PAPER TRADING REPORT (run #{d['run_id']})")
    A("=" * 70)
    A("")
    A(f"VERDICT: {v_head}")
    for line in _wrap(v_body, 68):
        A(f"  {line}")
    A("")
    A("-- run ------------------------------------------------------------")
    A(f"  window            : {time.strftime('%Y-%m-%d %H:%M', time.localtime(d['started']))}"
      f" -> {time.strftime('%Y-%m-%d %H:%M', time.localtime(d['ended']))}"
      f"  ({d['elapsed']/3600:.2f} h)")
    A(f"  book snapshots    : {d['snapshot_count']:,}")
    A(f"  capital           : {_fmt_irt(d['capital'], u)}")
    A(f"  fee per leg       : {d['config'].get('fee_rate', 0)*100:.3f}%  "
      f"(round trip {d['config'].get('fee_rate', 0)*300:.3f}%)")
    A("")
    A("-- opportunities --------------------------------------------------")
    A(f"  cycles with positive net edge : {d['opportunity_count']:,}")
    A(f"  passed all filters            : {d['taken_count']:,}")
    A(f"  evaporated before fill        : {d['vanished_count']:,}")
    if d["skip_reasons"]:
        A("  why signals were rejected:")
        for reason, count in d["skip_reasons"]:
            A(f"    {count:>6}  {reason}")
    A("")
    A("-- executed trades ------------------------------------------------")
    A(f"  fills             : {s.n:,}")
    if s.n:
        A(f"  profitable        : {s.positive:,}  ({s.hit_rate*100:.1f}%)")
        A(f"  total P&L         : {_fmt_irt(d['total_pnl'], u)}   "
          f"({d['total_return']*100:+.4f}% of capital)")
        A(f"  mean / trade      : {_fmt_irt(s.mean, u)}")
        A(f"  median / trade    : {_fmt_irt(s.median, u)}")
        A(f"  best / worst      : {_fmt_irt(s.maximum, u)} / {_fmt_irt(s.minimum, u)}")
        A(f"  std dev           : {_fmt_irt(s.stdev, u)}")
        A("")
        A("-- is it real? ----------------------------------------------------")
        A(f"  95% bootstrap CI for mean P&L : [{_fmt_irt(lo, u)} , {_fmt_irt(hi, u)}]")
        A(f"  P(true mean > 0)              : {d['p_positive']*100:.1f}%")
        A(f"  annualised Sharpe             : {_ann(d, format(d['sharpe'], '.2f'))}")
        A(f"  max drawdown                  : {_fmt_irt(dd_abs, u)} ({dd_pct*100:.3f}%)")
        A("")
        A("-- cost structure -------------------------------------------------")
        A(f"  latency cost (signal -> fill) : {d['latency_cost_bps']:.2f} bps average")
        A(f"  median break-even fee per leg : {d['median_break_even_fee']*100:.4f}%")
        A(f"  your configured fee           : {d['config'].get('fee_rate', 0)*100:.4f}%")
        A(f"  OBI vs realized edge (corr)   : {d['obi_corr']:+.3f}")
        A("")
        A("  P&L if the fee per leg were:")
        for row in d["sensitivity"]:
            mark = " <- yours" if abs(row["fee"] - d["config"].get("fee_rate", 0)) < 1e-9 else ""
            A(f"    {row['fee']*100:5.2f}%  {_fmt_irt(row['pnl'], u):>18}  "
              f"({row['winners']} winners){mark}")
        A("")
        if d["triangles"]:
            A("-- by triangle ----------------------------------------------------")
            for name, st in sorted(d["triangles"].items(), key=lambda kv: -kv[1]["pnl"]):
                A(f"  {name:<28} n={st['n']:<5} pnl={_fmt_irt(st['pnl'], u)}")
            A("")
        A("-- extrapolation (READ THIS) --------------------------------------")
        A(f"  naive 30-day compounding of this run : {_projection_text(d)}")
        for line in _wrap(
            "That number is arithmetic, not a forecast. It assumes the same "
            "opportunity rate around the clock, unlimited depth at these sizes, no "
            "competition arriving, no API rate limits, no outages, and fills exactly "
            "as simulated. Every one of those assumptions breaks with real money. "
            "Treat it as an upper bound that reality will not reach.", 68):
            A(f"  {line}")
    A("")
    A("=" * 70)
    return "\n".join(L)


def _ann(d: dict, value: str) -> str:
    """Annualised figures are meaningless from a short run -- say so instead."""
    if d["can_annualise"]:
        return value
    return f"n/a (run is {d['hours']:.1f}h, need {MIN_HOURS_TO_ANNUALISE:.0f}h+)"


def _projection_text(d: dict) -> str:
    if not d["can_annualise"]:
        return f"n/a (run is {d['hours']:.1f}h, need {MIN_HOURS_TO_ANNUALISE:.0f}h+)"
    proj = d["proj_30d"]
    if proj == float("inf") or proj > 100:
        return "off the scale -- which is itself a warning that the sample is too thin"
    return f"{proj*100:+.2f}%"


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def _sparkline_svg(curve: list[float], width: int = 900, height: int = 220) -> str:
    if len(curve) < 2:
        return '<p class="muted">Not enough equity points to draw a curve.</p>'
    lo, hi = min(curve), max(curve)
    span = (hi - lo) or 1.0
    pad = 12
    pts = []
    for i, v in enumerate(curve):
        x = pad + (width - 2 * pad) * i / (len(curve) - 1)
        y = height - pad - (height - 2 * pad) * (v - lo) / span
        pts.append(f"{x:.2f},{y:.2f}")
    poly = " ".join(pts)
    base_y = height - pad - (height - 2 * pad) * (curve[0] - lo) / span
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img" '
        f'aria-label="equity curve">'
        f'<line x1="{pad}" y1="{base_y:.2f}" x2="{width-pad}" y2="{base_y:.2f}" '
        f'stroke="currentColor" stroke-dasharray="4 4" opacity="0.35"/>'
        f'<polyline points="{poly}" fill="none" stroke="#2f9e6e" stroke-width="2" '
        f'stroke-linejoin="round" stroke-linecap="round"/></svg>'
    )


def to_html(d: dict) -> str:
    u = d["unit"]
    v_head, v_body = verdict(d)
    s: stats.Summary = d["summary"]
    lo, hi = d["ci"]
    dd_abs, dd_pct = d["drawdown"]
    e = html.escape

    tone = {
        "NO DATA": "#8a8a8a", "NO EDGE FOUND": "#b4553d", "INSUFFICIENT SAMPLE": "#b0862f",
        "NOT STATISTICALLY SIGNIFICANT": "#b4553d", "FRAGILE EDGE": "#b0862f",
        "EDGE PRESENT IN SAMPLE": "#2f9e6e",
    }.get(v_head, "#8a8a8a")

    def stat(label: str, value: str) -> str:
        return f'<div class="stat"><div class="k">{e(label)}</div><div class="v">{e(value)}</div></div>'

    tiles = [
        stat("Snapshots", f"{d['snapshot_count']:,}"),
        stat("Opportunities", f"{d['opportunity_count']:,}"),
        stat("Fills", f"{s.n:,}"),
        stat("Hit rate", f"{s.hit_rate*100:.1f}%"),
        stat("Total P&L", _fmt_irt(d["total_pnl"], u)),
        stat("Return", f"{d['total_return']*100:+.4f}%"),
        stat("Sharpe", f"{d['sharpe']:.2f}" if d["can_annualise"] else "n/a"),
        stat("Max drawdown", f"{dd_pct*100:.3f}%"),
    ]

    sens_rows = "".join(
        f"<tr{' class=mine' if abs(r['fee'] - d['config'].get('fee_rate', 0)) < 1e-9 else ''}>"
        f"<td>{r['fee']*100:.2f}%</td><td>{e(_fmt_irt(r['pnl'], u))}</td><td>{r['winners']}</td></tr>"
        for r in d["sensitivity"]
    )
    tri_rows = "".join(
        f"<tr><td>{e(name)}</td><td>{st['n']}</td><td>{e(_fmt_irt(st['pnl'], u))}</td></tr>"
        for name, st in sorted(d["triangles"].items(), key=lambda kv: -kv[1]["pnl"])
    ) or "<tr><td colspan=3 class=muted>no fills</td></tr>"
    skip_rows = "".join(
        f"<tr><td>{e(r)}</td><td>{c}</td></tr>" for r, c in d["skip_reasons"]
    ) or "<tr><td colspan=2 class=muted>none</td></tr>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arbitrage paper run #{d['run_id']}</title>
<style>
  :root {{ color-scheme: light dark; --bg:#fbfaf8; --fg:#1a1a1a; --mut:#6b6b6b; --card:#fff; --line:#e4e1dc; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#16171a; --fg:#e9e7e3; --mut:#9a9792; --card:#1e1f23; --line:#2e2f34; }}
  }}
  body {{ margin:0; padding:32px 20px; background:var(--bg); color:var(--fg);
         font:15px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif; }}
  main {{ max-width:940px; margin:0 auto; }}
  h1 {{ font-size:22px; margin:0 0 4px; }}
  h2 {{ font-size:15px; text-transform:uppercase; letter-spacing:.08em;
        color:var(--mut); margin:32px 0 10px; }}
  .muted {{ color:var(--mut); }}
  .verdict {{ border-left:4px solid {tone}; background:var(--card); padding:16px 18px;
              border-radius:6px; margin:20px 0; }}
  .verdict h3 {{ margin:0 0 6px; font-size:16px; color:{tone}; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }}
  .stat {{ background:var(--card); border:1px solid var(--line); border-radius:6px; padding:12px 14px; }}
  .stat .k {{ font-size:12px; color:var(--mut); }}
  .stat .v {{ font-size:19px; font-variant-numeric:tabular-nums; margin-top:2px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:6px; padding:16px; }}
  table {{ width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }}
  th,td {{ text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); font-size:14px; }}
  th {{ color:var(--mut); font-weight:500; font-size:12px; text-transform:uppercase; }}
  tr.mine {{ background:rgba(47,158,110,.10); font-weight:600; }}
  .warn {{ border:1px solid #b0862f; border-radius:6px; padding:14px 16px; margin-top:12px; }}
  .cols {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  @media (max-width:700px) {{ .cols {{ grid-template-columns:1fr; }} }}
</style></head><body><main>

<h1>Triangular arbitrage &mdash; paper run #{d['run_id']}</h1>
<p class="muted">{time.strftime('%Y-%m-%d %H:%M', time.localtime(d['started']))}
&rarr; {time.strftime('%Y-%m-%d %H:%M', time.localtime(d['ended']))}
&nbsp;·&nbsp; {d['elapsed']/3600:.2f} hours &nbsp;·&nbsp;
fee {d['config'].get('fee_rate',0)*100:.3f}% per leg &nbsp;·&nbsp; simulated money only</p>

<div class="verdict"><h3>{e(v_head)}</h3><p style="margin:0">{e(v_body)}</p></div>

<div class="grid">{''.join(tiles)}</div>

<h2>Equity curve</h2>
<div class="card">{_sparkline_svg(d['curve'])}</div>

<h2>Is it real, or is it luck?</h2>
<div class="card">
<table>
<tr><th>Measure</th><th>Value</th><th>Reading</th></tr>
<tr><td>95% bootstrap CI, mean P&amp;L/trade</td>
    <td>{e(_fmt_irt(lo,u))} … {e(_fmt_irt(hi,u))}</td>
    <td class="muted">{'excludes zero' if lo > 0 else 'includes zero &mdash; not significant'}</td></tr>
<tr><td>P(true mean &gt; 0)</td><td>{d['p_positive']*100:.1f}%</td>
    <td class="muted">bootstrap resampling</td></tr>
<tr><td>Latency cost</td><td>{d['latency_cost_bps']:.2f} bps</td>
    <td class="muted">edge lost between signal and fill</td></tr>
<tr><td>Median break-even fee</td><td>{d['median_break_even_fee']*100:.4f}%</td>
    <td class="muted">vs your {d['config'].get('fee_rate',0)*100:.4f}%</td></tr>
<tr><td>Opportunities that evaporated</td><td>{d['vanished_count']:,}</td>
    <td class="muted">gone within one poll interval</td></tr>
<tr><td>Order-book imbalance vs edge</td><td>{d['obi_corr']:+.3f}</td>
    <td class="muted">correlation, |r|&lt;0.2 means no usable signal</td></tr>
</table>
</div>

<div class="cols">
<div><h2>Fee sensitivity</h2><div class="card"><table>
<tr><th>Fee/leg</th><th>Total P&amp;L</th><th>Winners</th></tr>{sens_rows}</table></div></div>
<div><h2>By triangle</h2><div class="card"><table>
<tr><th>Cycle</th><th>N</th><th>P&amp;L</th></tr>{tri_rows}</table></div></div>
</div>

<h2>Why signals were rejected</h2>
<div class="card"><table><tr><th>Reason</th><th>Count</th></tr>{skip_rows}</table></div>

<h2>Extrapolation</h2>
<div class="card">
<p style="margin-top:0">Naive 30-day compounding of this run:
<strong>{e(_projection_text(d))}</strong></p>
<div class="warn"><strong>This is arithmetic, not a forecast.</strong> It assumes the same
opportunity rate around the clock, unlimited depth at these sizes, no competitor taking the
trade first, no rate limits, no outages, and fills exactly as simulated. Every one of those
assumptions degrades with real money. Treat it as a ceiling reality will not reach &mdash;
and note that a simulator cannot lose your money, so a good number here is the cheapest
part of the problem.</div>
</div>

<p class="muted" style="margin-top:32px">Generated {time.strftime('%Y-%m-%d %H:%M')} ·
paper trading only · no orders were placed on any exchange.</p>
</main></body></html>"""


def write_all(store: Store, run_id: int, outdir: str | Path) -> tuple[Path, Path]:
    d = collect(store, run_id)
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    txt = out / f"report_run{run_id}.txt"
    htm = out / f"report_run{run_id}.html"
    txt.write_text(to_text(d), encoding="utf-8")
    htm.write_text(to_html(d), encoding="utf-8")
    return txt, htm
