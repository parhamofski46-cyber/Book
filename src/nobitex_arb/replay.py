"""Offline replay of a recorded run under different assumptions.

Because every order-book snapshot is stored, a question like "would this
still work if the fee were 0.35%?" or "what if I demanded a 20 bps edge?"
can be answered without waiting days to collect data again.
"""

from __future__ import annotations

import json
from collections import defaultdict

from .config import Config
from .engine import PaperEngine
from .models import OrderBook
from .nobitex import NobitexFeed
from .storage import Store


def load_snapshots(store: Store, run_id: int) -> list[tuple[float, dict[str, OrderBook]]]:
    rows = store.rows(
        "SELECT ts, symbol, bids_json, asks_json FROM snapshots WHERE run_id=? ORDER BY ts",
        (run_id,),
    )
    grouped: dict[float, dict[str, OrderBook]] = defaultdict(dict)
    for r in rows:
        book = OrderBook.build(
            r["symbol"], json.loads(r["bids_json"]), json.loads(r["asks_json"]), float(r["ts"])
        )
        grouped[float(r["ts"])][r["symbol"]] = book
    return sorted(grouped.items())


def replay(store: Store, source_run_id: int, cfg: Config, note: str = "") -> int:
    """Re-run the engine over recorded books and store it as a new run."""
    frames = load_snapshots(store, source_run_id)
    if not frames:
        raise SystemExit(f"run {source_run_id} has no stored snapshots to replay")

    feed = NobitexFeed(cfg.base_url, cfg.request_timeout_sec)
    engine = PaperEngine(cfg, store, feed)
    engine.quiet = True

    started = frames[0][0]
    engine.run_id = store.start_run(started, cfg.to_dict(), note or f"replay of run {source_run_id}")
    store.add_equity(engine.run_id, started, engine.balance)

    for ts, books in frames:
        engine.step(books, now=ts)

    store.end_run(engine.run_id, frames[-1][0])
    store.commit()
    feed.close()
    return engine.run_id
