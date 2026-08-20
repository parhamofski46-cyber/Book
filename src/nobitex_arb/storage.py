"""SQLite persistence.

Everything the engine sees is written down, including the raw top-of-book
levels. That way a run can be replayed offline under different fee or
filter assumptions without collecting data again.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Mapping

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   REAL NOT NULL,
    ended_at     REAL,
    config_json  TEXT NOT NULL,
    note         TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id    INTEGER NOT NULL,
    ts        REAL NOT NULL,
    symbol    TEXT NOT NULL,
    best_bid  REAL NOT NULL,
    best_ask  REAL NOT NULL,
    spread_bps REAL NOT NULL,
    obi       REAL NOT NULL,
    sigma_bps REAL NOT NULL,
    bids_json TEXT NOT NULL,
    asks_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_run_ts ON snapshots(run_id, ts);

CREATE TABLE IF NOT EXISTS opportunities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL,
    ts          REAL NOT NULL,
    triangle    TEXT NOT NULL,
    size_irt    REAL NOT NULL,
    gross_bps   REAL NOT NULL,
    net_bps     REAL NOT NULL,
    profit_irt  REAL NOT NULL,
    slippage_bps REAL NOT NULL,
    taken       INTEGER NOT NULL,
    skip_reason TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_opp_run_ts ON opportunities(run_id, ts);

CREATE TABLE IF NOT EXISTS trades (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id         INTEGER NOT NULL,
    ts_signal      REAL NOT NULL,
    ts_fill        REAL NOT NULL,
    latency_sec    REAL NOT NULL,
    triangle       TEXT NOT NULL,
    size_irt       REAL NOT NULL,
    expected_bps   REAL NOT NULL,
    realized_bps   REAL NOT NULL,
    gross_bps      REAL NOT NULL,
    pnl_irt        REAL NOT NULL,
    fees_irt       REAL NOT NULL,
    slippage_bps   REAL NOT NULL,
    break_even_fee REAL NOT NULL,
    obi_json       TEXT NOT NULL,
    outcome        TEXT NOT NULL,
    balance_after  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_run_ts ON trades(run_id, ts_fill);

CREATE TABLE IF NOT EXISTS equity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    ts      REAL NOT NULL,
    balance REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_equity_run_ts ON equity(run_id, ts);
"""


class Store:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), timeout=30.0)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def start_run(self, started_at: float, config: Mapping[str, Any], note: str = "") -> int:
        cur = self.conn.execute(
            "INSERT INTO runs(started_at, config_json, note) VALUES (?,?,?)",
            (started_at, json.dumps(config, ensure_ascii=False), note),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def end_run(self, run_id: int, ended_at: float) -> None:
        self.conn.execute("UPDATE runs SET ended_at=? WHERE id=?", (ended_at, run_id))
        self.conn.commit()

    def latest_run_id(self) -> int | None:
        row = self.conn.execute("SELECT id FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        return int(row["id"]) if row else None

    def add_snapshots(self, run_id: int, rows: Iterable[tuple]) -> None:
        self.conn.executemany(
            "INSERT INTO snapshots(run_id, ts, symbol, best_bid, best_ask, spread_bps, obi, sigma_bps, bids_json, asks_json)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(run_id, *r) for r in rows],
        )

    def add_opportunity(self, run_id: int, row: tuple) -> None:
        self.conn.execute(
            "INSERT INTO opportunities(run_id, ts, triangle, size_irt, gross_bps, net_bps, profit_irt, slippage_bps, taken, skip_reason)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (run_id, *row),
        )

    def add_trade(self, run_id: int, row: tuple) -> None:
        self.conn.execute(
            "INSERT INTO trades(run_id, ts_signal, ts_fill, latency_sec, triangle, size_irt, expected_bps,"
            " realized_bps, gross_bps, pnl_irt, fees_irt, slippage_bps, break_even_fee, obi_json, outcome, balance_after)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, *row),
        )

    def add_equity(self, run_id: int, ts: float, balance: float) -> None:
        self.conn.execute("INSERT INTO equity(run_id, ts, balance) VALUES (?,?,?)", (run_id, ts, balance))

    def commit(self) -> None:
        self.conn.commit()

    def rows(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, params).fetchall()
