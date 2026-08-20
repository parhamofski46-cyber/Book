"""End-to-end test of the full pipeline with a scripted market.

Drives the engine over synthetic order books, then checks that trades
land in the database, that the latency model behaves, and that both
reports render. No network access anywhere.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nobitex_arb.config import Config
from nobitex_arb.engine import PaperEngine
from nobitex_arb.models import Market, OrderBook
from nobitex_arb.replay import replay
from nobitex_arb.report import collect, to_html, to_text, verdict
from nobitex_arb.storage import Store

USDT_IRT = 1_150_000.0     # rial per USDT
BTC_USDT = 95_000.0
MARKETS = [
    Market("USDTIRT", "USDT", "IRT"),
    Market("BTCIRT", "BTC", "IRT"),
    Market("BTCUSDT", "BTC", "USDT"),
]


def two_sided(symbol: str, mid: float, depth_base: float, edge_bps: float = 1.0) -> OrderBook:
    half = mid * edge_bps / 10_000.0
    return OrderBook.build(
        symbol,
        [[mid - half, depth_base], [mid - 3 * half, depth_base * 5]],
        [[mid + half, depth_base], [mid + 3 * half, depth_base * 5]],
    )


def frame(btc_irt_skew: float = 0.0) -> dict[str, OrderBook]:
    """A consistent market, optionally with BTC/IRT mispriced by `btc_irt_skew`."""
    btc_irt = USDT_IRT * BTC_USDT * (1.0 + btc_irt_skew)
    return {
        "USDTIRT": two_sided("USDTIRT", USDT_IRT, 5_000.0),
        "BTCUSDT": two_sided("BTCUSDT", BTC_USDT, 20.0),
        "BTCIRT": two_sided("BTCIRT", btc_irt, 20.0),
    }


def broken_frame() -> dict[str, OrderBook]:
    """BTC/IRT goes bad: the queued cycle can no longer be executed."""
    books = frame()
    books["BTCIRT"] = OrderBook.build("BTCIRT", [[1.0, 0.0001]], [[2.0, 0.0001]])
    return books


def make_config(tmp: Path) -> Config:
    return Config(
        markets=list(MARKETS),
        irt_unit="rial",
        fee_rate=0.0025,
        capital_irt=100_000_000,
        min_order_irt=5_000_000,
        max_order_irt=50_000_000,
        min_profit_bps=5.0,
        cooldown_sec=0.0,
        db_path=str(tmp / "test.db"),
        log_path=str(tmp / "test.log"),
    )


class _Harness:
    """Runs the engine over a list of frames at 3-second intervals."""

    def __init__(self, tmp: Path, cfg: Config | None = None) -> None:
        self.cfg = cfg or make_config(tmp)
        self.store = Store(self.cfg.db_path)
        self.engine = PaperEngine(self.cfg, self.store, feed=None)  # step() never touches the feed
        self.engine.quiet = True
        self.t0 = 1_760_000_000.0
        self.run_id = self.store.start_run(self.t0, self.cfg.to_dict(), "test")
        self.engine.run_id = self.run_id
        self.store.add_equity(self.run_id, self.t0, self.engine.balance)

    def play(self, frames: list[dict]) -> None:
        for i, f in enumerate(frames):
            self.engine.step(f, now=self.t0 + i * 3.0)
        self.store.end_run(self.run_id, self.t0 + len(frames) * 3.0)
        self.store.commit()

    def trades(self) -> list:
        return self.store.rows("SELECT * FROM trades WHERE run_id=? ORDER BY id", (self.run_id,))

    def opportunities(self) -> list:
        return self.store.rows("SELECT * FROM opportunities WHERE run_id=? ORDER BY id", (self.run_id,))


class TestEngineBehaviour(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_quiet_market_produces_no_trades(self):
        h = _Harness(self.tmp)
        h.play([frame() for _ in range(20)])
        self.assertEqual(h.trades(), [])
        self.assertAlmostEqual(h.engine.balance, h.cfg.capital_irt)

    def test_persistent_mispricing_is_captured(self):
        h = _Harness(self.tmp)
        # Quiet, then a 1.5% dislocation that lasts long enough to trade.
        h.play([frame()] * 5 + [frame(0.015)] * 4 + [frame()] * 5)
        trades = h.trades()
        self.assertTrue(trades, "engine failed to trade an obvious dislocation")
        filled = [t for t in trades if t["outcome"] == "filled"]
        self.assertTrue(filled)
        self.assertGreater(sum(t["pnl_irt"] for t in filled), 0)
        self.assertGreater(h.engine.balance, h.cfg.capital_irt)

    def test_fill_never_uses_the_signal_snapshot(self):
        """The latency model must settle against the *next* frame, not the one that triggered."""
        h = _Harness(self.tmp)
        # A one-frame flash: the signal fires, but by settlement the market is normal again.
        h.play([frame()] * 3 + [frame(0.015)] + [frame()] * 4)
        filled = [t for t in h.trades() if t["outcome"] == "filled"]
        self.assertEqual(len(filled), 1)
        t = filled[0]
        self.assertGreater(t["expected_bps"], 0)
        self.assertLess(t["realized_bps"], t["expected_bps"])
        self.assertLess(t["pnl_irt"], 0, "a vanished edge must be allowed to lose money")

    def test_unexecutable_cycle_is_recorded_not_crashed(self):
        h = _Harness(self.tmp)
        h.play([frame()] * 2 + [frame(0.015)] + [broken_frame()] + [frame()] * 2)
        outcomes = [t["outcome"] for t in h.trades()]
        self.assertTrue(any(o.startswith("vanished") for o in outcomes), outcomes)
        self.assertAlmostEqual(h.engine.balance, h.cfg.capital_irt)

    def test_size_respects_the_configured_cap(self):
        h = _Harness(self.tmp)
        h.play([frame()] * 2 + [frame(0.015)] * 4)
        for t in h.trades():
            self.assertLessEqual(t["size_irt"], h.cfg.max_order_irt + 1e-6)
            self.assertGreaterEqual(t["size_irt"], h.cfg.min_order_irt - 1e-6)

    def test_sub_threshold_edge_is_logged_but_skipped(self):
        cfg = make_config(self.tmp)
        cfg.min_profit_bps = 500.0  # demand 5%, far more than the dislocation offers
        h = _Harness(self.tmp, cfg)
        h.play([frame()] * 2 + [frame(0.015)] * 4)
        opps = h.opportunities()
        self.assertTrue(opps, "a positive-edge cycle should still be recorded")
        self.assertTrue(all(o["taken"] == 0 for o in opps))
        self.assertTrue(any("below threshold" in o["skip_reason"] for o in opps))
        self.assertEqual(h.trades(), [])

    def test_snapshots_are_persisted_for_every_symbol(self):
        h = _Harness(self.tmp)
        h.play([frame() for _ in range(4)])
        rows = h.store.rows("SELECT COUNT(*) c FROM snapshots WHERE run_id=?", (h.run_id,))
        self.assertEqual(rows[0]["c"], 4 * 3)


class TestReportAndReplay(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.h = _Harness(self.tmp)
        self.h.play([frame()] * 3 + [frame(0.015)] * 6 + [frame()] * 3)

    def tearDown(self):
        self._tmp.cleanup()

    def test_report_renders_both_formats(self):
        d = collect(self.h.store, self.h.run_id)
        text = to_text(d)
        page = to_html(d)
        self.assertIn("PAPER TRADING REPORT", text)
        self.assertIn("VERDICT", text)
        self.assertIn("<!doctype html>", page)
        self.assertIn("bootstrap", page.lower())
        self.assertNotIn("{d[", page, "an f-string placeholder leaked into the HTML")

    def test_small_sample_is_never_declared_significant(self):
        d = collect(self.h.store, self.h.run_id)
        head, _ = verdict(d)
        self.assertIn(head, {"INSUFFICIENT SAMPLE", "NO EDGE FOUND"})

    def test_report_survives_a_run_with_no_trades(self):
        h = _Harness(self.tmp, make_config(self.tmp))
        h.play([frame() for _ in range(6)])
        d = collect(h.store, h.run_id)
        self.assertEqual(verdict(d)[0], "NO EDGE FOUND")
        self.assertIn("NO EDGE FOUND", to_text(d))
        self.assertIn("<!doctype html>", to_html(d))

    def test_replay_reproduces_the_original_run(self):
        cfg = make_config(self.tmp)
        new_id = replay(self.h.store, self.h.run_id, cfg)
        original = collect(self.h.store, self.h.run_id)
        again = collect(self.h.store, new_id)
        self.assertAlmostEqual(original["total_pnl"], again["total_pnl"], places=6)

    def test_replay_with_a_higher_fee_destroys_the_profit(self):
        cfg = make_config(self.tmp)
        cfg.fee_rate = 0.02  # absurd fee: nothing can clear it
        new_id = replay(self.h.store, self.h.run_id, cfg)
        again = collect(self.h.store, new_id)
        self.assertEqual(len(again["pnls"]), 0)

    def test_stored_books_round_trip_through_sqlite(self):
        rows = self.h.store.rows(
            "SELECT bids_json, asks_json FROM snapshots WHERE run_id=? LIMIT 1", (self.h.run_id,)
        )
        bids = json.loads(rows[0]["bids_json"])
        self.assertTrue(bids and len(bids[0]) == 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
