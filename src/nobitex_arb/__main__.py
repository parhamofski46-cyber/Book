"""Command line entry point: python -m nobitex_arb <command>"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from .config import Config
from .engine import PaperEngine
from .nobitex import NobitexFeed, detect_irt_unit
from .replay import replay
from .report import write_all
from .storage import Store
from .triangle import best_size, build_triangles


def setup_logging(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.FileHandler(path, encoding="utf-8")],
    )


def cmd_doctor(args: argparse.Namespace) -> int:
    """Check connectivity, response shape, units, and the current spread."""
    cfg = Config.load(args.config)
    feed = NobitexFeed(cfg.base_url, cfg.request_timeout_sec)
    symbols = sorted({m.symbol for m in cfg.markets})

    print(f"endpoint : {cfg.base_url}")
    print(f"markets  : {', '.join(symbols)}\n")

    try:
        books = feed.fetch(tuple(symbols))
    except Exception as exc:
        print(f"FAILED to fetch order books: {exc}\n")
        print("Things to check, in order:")
        print("  1. Is your internet working? Open https://nobitex.ir in a browser.")
        print("  2. Are you behind a VPN or proxy that blocks the API? Turn it off.")
        print("  3. Did the endpoint change? Inspect the raw response:")
        probe = feed.raw(symbols[0])
        print("     " + json.dumps(probe, ensure_ascii=False)[:400])
        return 1

    print(f"fetch mode: {feed.mode}")
    missing = [s for s in symbols if s not in books]
    if missing:
        print(f"WARNING: no book returned for {missing} -- check the symbol spelling")

    unit = "unknown"
    if "USDTIRT" in books:
        unit = detect_irt_unit(books["USDTIRT"].mid)
        print(f"IRT unit : {unit} (USDT mid = {books['USDTIRT'].mid:,.0f})")
    print()

    print(f"{'symbol':<10} {'best bid':>16} {'best ask':>16} {'spread':>10} {'levels':>8}")
    for sym in symbols:
        b = books.get(sym)
        if b is None:
            print(f"{sym:<10} {'-':>16} {'-':>16} {'-':>10} {'-':>8}")
            continue
        print(f"{sym:<10} {b.best_bid:>16,.0f} {b.best_ask:>16,.0f} "
              f"{b.spread_bps:>9.1f}b {len(b.bids)+len(b.asks):>8}")
    print()

    triangles = build_triangles(cfg.markets, cfg.start_currency)
    if not triangles:
        print("No triangles could be formed. You need two markets quoted in "
              f"{cfg.start_currency} plus the cross market between their bases.")
        return 1

    limits = dict(cfg.min_order_by_quote)
    try:
        limits.update(feed.fetch_options())
        print("minimum order value (from the exchange): "
              + ", ".join(f"{v:,.0f} {k}" for k, v in sorted(limits.items())))
    except Exception as exc:
        print(f"minimum order value (from config; {exc}): "
              + ", ".join(f"{v:,.0f} {k}" for k, v in sorted(limits.items())))
    print()

    print(f"{len(triangles)} triangles, evaluated right now at "
          f"{cfg.fee_rate*100:.3f}% fee per leg:\n")
    print(f"{'cycle':<28} {'gross':>10} {'net':>10} {'best size':>16} {'status'}")
    any_positive = False
    for tri in triangles:
        res = best_size(tri, books, cfg.fee_rate, cfg.min_order_irt,
                        min(cfg.max_order_irt, cfg.capital_irt),
                        min_notionals=limits)
        if res is None or not res.feasible:
            reason = res.reason if res else "not enough visible depth"
            print(f"{tri.name:<28} {'n/a':>10} {'n/a':>10} {'-':>16} {reason}")
            continue
        g = f"{res.gross_bps:+.1f}b"
        status = "PROFITABLE" if res.profit_bps > 0 else "below costs"
        any_positive |= res.profit_bps > 0
        print(f"{tri.name:<28} {g:>10} {res.profit_bps:>+9.1f}b "
              f"{res.start_amount:>16,.0f} {status}")

    print()
    if any_positive:
        print("At this instant at least one cycle clears costs. One instant proves "
              "nothing -- run `collect` for a few days.")
    else:
        print("Nothing clears costs at this instant. Completely normal: profitable "
              "windows are rare and brief. That is the whole point of measuring.")
    feed.close()
    return 0


def cmd_collect(args: argparse.Namespace) -> int:
    cfg = Config.load(args.config)
    setup_logging(cfg.log_path)
    if args.fee is not None:
        cfg.fee_rate = args.fee
    store = Store(cfg.db_path)
    feed = NobitexFeed(cfg.base_url, cfg.request_timeout_sec)
    engine = PaperEngine(cfg, store, feed)
    engine.install_signal_handlers()
    duration = args.hours * 3600 if args.hours else None
    try:
        engine.run(duration)
    finally:
        feed.close()
        store.close()
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    cfg = Config.load(args.config)
    store = Store(cfg.db_path)
    run_id = args.run or store.latest_run_id()
    if run_id is None:
        print("no runs in the database yet -- run `collect` first")
        return 1
    txt, htm = write_all(store, run_id, args.outdir)
    print(txt.read_text(encoding="utf-8"))
    print(f"\nwritten: {txt}\n         {htm}")
    store.close()
    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    cfg = Config.load(args.config)
    store = Store(cfg.db_path)
    source = args.run or store.latest_run_id()
    if source is None:
        print("no runs to replay")
        return 1
    if args.fee is not None:
        cfg.fee_rate = args.fee
    if args.min_profit_bps is not None:
        cfg.min_profit_bps = args.min_profit_bps
    cfg.validate()
    new_id = replay(store, source, cfg, note=args.note)
    print(f"replayed run {source} -> new run {new_id} "
          f"(fee {cfg.fee_rate*100:.3f}%, threshold {cfg.min_profit_bps:.1f}bps)")
    txt, htm = write_all(store, new_id, args.outdir)
    print(txt.read_text(encoding="utf-8"))
    print(f"\nwritten: {txt}\n         {htm}")
    store.close()
    return 0


def cmd_ui(args: argparse.Namespace) -> int:
    from .ui.app import main as ui_main
    return ui_main()


def cmd_serve(args: argparse.Namespace) -> int:
    """Run only the HTTP server -- used by the tests and for headless checks."""
    import time as _time

    from .ui.controller import AppController
    from .ui.server import UiServer

    server = UiServer(AppController(args.config), port=args.port)
    server.start()
    print(f"{server.url}?token={server.token}", flush=True)
    try:
        while True:
            _time.sleep(0.5)
    except KeyboardInterrupt:
        server.stop()
    return 0


def cmd_runs(args: argparse.Namespace) -> int:
    cfg = Config.load(args.config)
    store = Store(cfg.db_path)
    rows = store.rows("SELECT * FROM runs ORDER BY id")
    if not rows:
        print("no runs yet")
        return 0
    print(f"{'id':>4} {'started':<17} {'hours':>7} {'snaps':>8} {'trades':>7}  note")
    for r in rows:
        n_s = store.rows("SELECT COUNT(*) c FROM snapshots WHERE run_id=?", (r["id"],))[0]["c"]
        n_t = store.rows("SELECT COUNT(*) c FROM trades WHERE run_id=?", (r["id"],))[0]["c"]
        hours = ((r["ended_at"] or time.time()) - r["started_at"]) / 3600
        print(f"{r['id']:>4} {time.strftime('%Y-%m-%d %H:%M', time.localtime(r['started_at'])):<17}"
              f" {hours:>7.2f} {n_s:>8} {n_t:>7}  {r['note']}")
    store.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="nobitex_arb",
        description="Triangular arbitrage paper-trading lab for Nobitex. "
                    "Simulated money only: this program never places an order.",
    )
    p.add_argument("--config", default="config.json")
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("doctor", help="check the connection and show the current edge")
    d.set_defaults(func=cmd_doctor)

    c = sub.add_parser("collect", help="run the paper-trading loop on live data")
    c.add_argument("--hours", type=float, default=None, help="stop after N hours (default: until Ctrl+C)")
    c.add_argument("--fee", type=float, default=None, help="override fee per leg, e.g. 0.0035")
    c.set_defaults(func=cmd_collect)

    r = sub.add_parser("report", help="build the text and HTML report for a run")
    r.add_argument("--run", type=int, default=None)
    r.add_argument("--outdir", default="reports")
    r.set_defaults(func=cmd_report)

    rp = sub.add_parser("replay", help="re-run recorded data under different assumptions")
    rp.add_argument("--run", type=int, default=None)
    rp.add_argument("--fee", type=float, default=None)
    rp.add_argument("--min-profit-bps", dest="min_profit_bps", type=float, default=None)
    rp.add_argument("--note", default="")
    rp.add_argument("--outdir", default="reports")
    rp.set_defaults(func=cmd_replay)

    ls = sub.add_parser("runs", help="list recorded runs")
    ls.set_defaults(func=cmd_runs)

    ui = sub.add_parser("ui", help="open the desktop application")
    ui.set_defaults(func=cmd_ui)

    sv = sub.add_parser("serve", help="run the UI server only (no window)")
    sv.add_argument("--port", type=int, default=0)
    sv.set_defaults(func=cmd_serve)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
