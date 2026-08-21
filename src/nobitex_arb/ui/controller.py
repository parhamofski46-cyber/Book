"""Application controller: owns the engine thread and serves the UI's requests."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from ..config import DEFAULT_CONFIG, Config
from ..engine import PaperEngine
from ..live import LiveState
from ..nobitex import NobitexFeed, detect_irt_unit
from ..replay import replay
from ..report import collect, to_json, write_all
from ..storage import Store
from ..triangle import best_size, build_triangles


class AppController:
    def __init__(self, config_path: str | Path = "config.json") -> None:
        self.config_path = Path(config_path)
        self.cfg = Config.load(self.config_path)
        self._idle = LiveState()
        self._idle.set(capital=float(self.cfg.capital_irt), balance=float(self.cfg.capital_irt),
                       fee_rate=self.cfg.fee_rate, irt_unit=self.cfg.irt_unit)
        self._engine: PaperEngine | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._last_error = ""

    # -- lifecycle ----------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> dict:
        with self._lock:
            if self.is_running:
                return {"ok": False, "error": "already running"}
            try:
                self.cfg = Config.load(self.config_path)
            except Exception as exc:
                return {"ok": False, "error": f"config: {exc}"}

            cfg = self.cfg
            self._last_error = ""
            ready = threading.Event()
            outcome: dict[str, Any] = {}

            def worker() -> None:
                # The SQLite connection is opened here rather than in the caller:
                # sqlite3 forbids using a connection from a thread other than the
                # one that created it, and the engine lives on this thread.
                store = feed = None
                try:
                    store = Store(cfg.db_path)
                    feed = NobitexFeed(cfg.base_url, cfg.request_timeout_sec)
                    engine = PaperEngine(cfg, store, feed)
                    engine.quiet = True
                    self._engine = engine
                    outcome["ok"] = True
                except Exception as exc:
                    outcome["error"] = str(exc)
                    self._last_error = str(exc)
                    ready.set()
                    return
                finally:
                    ready.set()

                try:
                    engine.run(None)
                except Exception as exc:  # surfaced in the UI rather than lost with the thread
                    self._last_error = str(exc)
                    engine.live.set(running=False, last_error=str(exc))
                    engine.live.push_event("error", f"engine stopped: {exc}")
                finally:
                    for closeable in (feed, store):
                        try:
                            if closeable is not None:
                                closeable.close()
                        except Exception:
                            pass

            self._thread = threading.Thread(target=worker, name="engine", daemon=True)
            self._thread.start()

            if not ready.wait(20.0):
                return {"ok": False, "error": "engine did not start in time"}
            if "error" in outcome:
                return {"ok": False, "error": outcome["error"]}
            return {"ok": True}

    def stop(self) -> dict:
        with self._lock:
            if self._engine is None or not self.is_running:
                return {"ok": False, "error": "not running"}
            self._engine.stop()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=15.0)
        return {"ok": True}

    def status(self) -> dict:
        live = self._engine.live if self._engine is not None else self._idle
        snap = live.snapshot()
        snap["running"] = self.is_running and snap.get("running", False)
        snap["config"] = {
            "fee_rate": self.cfg.fee_rate,
            "capital_irt": self.cfg.capital_irt,
            "min_order_irt": self.cfg.min_order_irt,
            "max_order_irt": self.cfg.max_order_irt,
            "min_profit_bps": self.cfg.min_profit_bps,
            "poll_interval_sec": self.cfg.poll_interval_sec,
        }
        if self._last_error:
            snap["last_error"] = self._last_error
        return snap

    # -- data ---------------------------------------------------------------

    def doctor(self) -> dict:
        cfg = self.cfg
        feed = NobitexFeed(cfg.base_url, cfg.request_timeout_sec)
        symbols = sorted({m.symbol for m in cfg.markets})
        out: dict[str, Any] = {"endpoint": cfg.base_url, "symbols": symbols}
        try:
            books = feed.fetch(tuple(symbols))
        except Exception as exc:
            out.update({"ok": False, "error": str(exc), "markets": [], "triangles": []})
            feed.close()
            return out

        out["ok"] = True
        out["mode"] = feed.mode
        limits = dict(cfg.min_order_by_quote)
        try:
            limits.update(feed.fetch_options())
            out["limits_source"] = "exchange"
        except Exception as exc:
            out["limits_source"] = f"config ({exc})"
        out["min_notionals"] = limits
        out["missing"] = [s for s in symbols if s not in books]
        out["unit"] = detect_irt_unit(books["USDTIRT"].mid) if "USDTIRT" in books else "unknown"
        out["markets"] = [
            {"symbol": s, "bid": books[s].best_bid, "ask": books[s].best_ask,
             "spread_bps": books[s].spread_bps, "levels": len(books[s].bids) + len(books[s].asks)}
            for s in symbols if s in books
        ]
        rows = []
        for tri in build_triangles(cfg.markets, cfg.start_currency):
            res = best_size(tri, books, cfg.fee_rate, cfg.min_order_irt,
                            min(cfg.max_order_irt, cfg.capital_irt),
                            min_notionals=limits)
            if res is None or not res.feasible:
                rows.append({"name": tri.name, "path": tri.path, "net_bps": None,
                             "gross_bps": None, "size": 0.0,
                             "note": res.reason if res else "not enough visible depth"})
                continue
            rows.append({"name": tri.name, "path": tri.path, "net_bps": res.profit_bps,
                         "gross_bps": res.gross_bps, "size": res.start_amount, "note": ""})
        out["triangles"] = rows
        feed.close()
        return out

    def runs(self) -> list[dict]:
        with Store(self.cfg.db_path) as store:
            rows = store.rows("SELECT * FROM runs ORDER BY id DESC")
            out = []
            for r in rows:
                snaps = store.rows("SELECT COUNT(*) c FROM snapshots WHERE run_id=?", (r["id"],))[0]["c"]
                trades = store.rows("SELECT COUNT(*) c FROM trades WHERE run_id=?", (r["id"],))[0]["c"]
                out.append({
                    "id": r["id"], "started_at": r["started_at"], "ended_at": r["ended_at"],
                    "hours": ((r["ended_at"] or time.time()) - r["started_at"]) / 3600.0,
                    "snapshots": snaps, "trades": trades, "note": r["note"] or "",
                })
            return out

    def report(self, run_id: int | None = None) -> dict:
        with Store(self.cfg.db_path) as store:
            rid = run_id or store.latest_run_id()
            if rid is None:
                return {"empty": True}
            return to_json(collect(store, rid))

    def export(self, run_id: int | None = None, outdir: str = "reports") -> dict:
        with Store(self.cfg.db_path) as store:
            rid = run_id or store.latest_run_id()
            if rid is None:
                return {"ok": False, "error": "no runs yet"}
            txt, htm = write_all(store, rid, outdir)
            return {"ok": True, "text": str(txt.resolve()), "html": str(htm.resolve())}

    def replay(self, run_id: int, fee_rate: float | None, min_profit_bps: float | None) -> dict:
        if self.is_running:
            return {"ok": False, "error": "stop the live run first"}
        cfg = Config.load(self.config_path)
        if fee_rate is not None:
            cfg.fee_rate = fee_rate
        if min_profit_bps is not None:
            cfg.min_profit_bps = min_profit_bps
        try:
            cfg.validate()
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        with Store(cfg.db_path) as store:
            new_id = replay(store, run_id, cfg)
        return {"ok": True, "run_id": new_id}

    # -- settings -----------------------------------------------------------

    def get_config(self) -> dict:
        raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        raw.pop("_comment", None)
        return raw

    def save_config(self, patch: dict) -> dict:
        if self.is_running:
            return {"ok": False, "error": "stop the run before changing settings"}
        raw = self.get_config()
        allowed = set(DEFAULT_CONFIG) - {"_comment", "markets"}
        for key, value in patch.items():
            if key not in allowed:
                return {"ok": False, "error": f"cannot set {key}"}
            raw[key] = value
        try:
            probe = dict(raw)
            markets = probe.pop("markets", [])
            from ..models import Market
            cfg = Config(markets=[Market(**m) for m in markets], **probe)
            cfg.validate()
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        self.config_path.write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")
        self.cfg = Config.load(self.config_path)
        self._idle.set(capital=float(self.cfg.capital_irt), balance=float(self.cfg.capital_irt),
                       fee_rate=self.cfg.fee_rate)
        return {"ok": True, "config": raw}
