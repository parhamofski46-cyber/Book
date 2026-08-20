"""Thread-safe live state shared between the engine thread and the UI."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any


class LiveState:
    """A snapshot of what the engine is doing right now.

    The engine thread writes; the HTTP thread reads. Every access goes
    through one lock and readers get a detached copy, so the UI can never
    observe a half-updated tick.
    """

    def __init__(self, history: int = 600, events: int = 120) -> None:
        self._lock = threading.Lock()
        self._history = history
        self._core: dict[str, Any] = {
            "running": False,
            "run_id": 0,
            "started_at": 0.0,
            "updated_at": 0.0,
            "polls": 0,
            "opportunities": 0,
            "trades": 0,
            "wins": 0,
            "vanished": 0,
            "capital": 0.0,
            "balance": 0.0,
            "irt_unit": "auto",
            "fee_rate": 0.0,
            "feed_ok": True,
            "feed_success_rate": 1.0,
            "last_error": "",
            "best_edge_bps": None,
            "best_triangle": "",
            "cooldown_until": 0.0,
        }
        self._markets: dict[str, dict] = {}
        self._triangles: dict[str, dict] = {}
        self._edges: deque[tuple[float, float | None]] = deque(maxlen=history)
        self._equity: deque[tuple[float, float]] = deque(maxlen=history)
        self._events: deque[dict] = deque(maxlen=events)

    # -- writers (engine thread) --------------------------------------------

    def set(self, **fields: Any) -> None:
        with self._lock:
            self._core.update(fields)
            self._core["updated_at"] = time.time()

    def bump(self, field: str, by: int = 1) -> None:
        with self._lock:
            self._core[field] = self._core.get(field, 0) + by

    def set_markets(self, markets: dict[str, dict]) -> None:
        with self._lock:
            self._markets = markets

    def set_triangles(self, triangles: dict[str, dict]) -> None:
        with self._lock:
            self._triangles = triangles

    def push_edge(self, ts: float, edge_bps: float | None) -> None:
        with self._lock:
            self._edges.append((ts, edge_bps))

    def push_equity(self, ts: float, balance: float) -> None:
        with self._lock:
            self._equity.append((ts, balance))

    def push_event(self, kind: str, message: str, **extra: Any) -> None:
        with self._lock:
            self._events.appendleft({"ts": time.time(), "kind": kind, "message": message, **extra})

    def reset(self) -> None:
        with self._lock:
            self._edges.clear()
            self._equity.clear()
            self._events.clear()
            self._markets = {}
            self._triangles = {}
            self._core.update({
                "polls": 0, "opportunities": 0, "trades": 0, "wins": 0, "vanished": 0,
                "best_edge_bps": None, "best_triangle": "", "last_error": "",
            })

    # -- reader (HTTP thread) -----------------------------------------------

    def snapshot(self) -> dict:
        with self._lock:
            core = dict(self._core)
            core["markets"] = {k: dict(v) for k, v in self._markets.items()}
            core["triangles"] = {k: dict(v) for k, v in self._triangles.items()}
            core["edges"] = [[t, e] for t, e in self._edges]
            core["equity"] = [[t, b] for t, b in self._equity]
            core["events"] = [dict(e) for e in self._events]
        capital = core.get("capital") or 0.0
        core["pnl"] = core["balance"] - capital
        core["pnl_pct"] = (core["pnl"] / capital * 100.0) if capital else 0.0
        core["hit_rate"] = (core["wins"] / core["trades"] * 100.0) if core["trades"] else 0.0
        return core
