"""Unit tests for the arbitrage math.

The live exchange cannot be reached from CI, so every number the engine
produces is validated here against hand-computed synthetic order books.
If these pass, a wrong result in production is a data problem, not a
math problem.
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nobitex_arb.execution import buy_base, sell_base
from nobitex_arb.models import Level, Market, OrderBook
from nobitex_arb.microstructure import order_book_imbalance
from nobitex_arb.stats import bootstrap_ci, max_drawdown, summarize
from nobitex_arb.triangle import (
    best_size, break_even_fee, build_triangles, implied_min_start, run_cycle,
)

USDTIRT = Market("USDTIRT", "USDT", "IRT")
BTCIRT = Market("BTCIRT", "BTC", "IRT")
BTCUSDT = Market("BTCUSDT", "BTC", "USDT")
MARKETS = [USDTIRT, BTCIRT, BTCUSDT]


def book(symbol: str, bid: float, ask: float, size: float = 1e9) -> OrderBook:
    """A single-level book, deep enough that depth never binds."""
    return OrderBook.build(symbol, [[bid, size / bid]], [[ask, size / ask]])


class TestFills(unittest.TestCase):
    def test_buy_single_level(self):
        asks = (Level(100.0, 10.0),)
        f = buy_base(asks, 500.0, 0.0)
        self.assertTrue(f.filled)
        self.assertAlmostEqual(f.out_amount, 5.0)
        self.assertAlmostEqual(f.vwap, 100.0)
        self.assertAlmostEqual(f.in_amount, 500.0)

    def test_buy_walks_multiple_levels(self):
        # 10 @ 100 = 1000, then 10 @ 110. Spending 1550 takes all of L1 and 5 of L2.
        asks = (Level(100.0, 10.0), Level(110.0, 10.0))
        f = buy_base(asks, 1550.0, 0.0)
        self.assertTrue(f.filled)
        self.assertAlmostEqual(f.out_amount, 15.0)
        self.assertAlmostEqual(f.vwap, 1550.0 / 15.0)
        self.assertEqual(f.levels_used, 2)
        self.assertGreater(f.slippage_bps, 0)

    def test_buy_reports_depth_exhaustion(self):
        f = buy_base((Level(100.0, 1.0),), 5000.0, 0.0)
        self.assertFalse(f.filled)

    def test_fee_taken_from_output(self):
        f = buy_base((Level(100.0, 10.0),), 1000.0, 0.01)
        self.assertAlmostEqual(f.out_gross, 10.0)
        self.assertAlmostEqual(f.fee_paid, 0.1)
        self.assertAlmostEqual(f.out_amount, 9.9)

    def test_sell_walks_bids_downward(self):
        bids = (Level(100.0, 5.0), Level(90.0, 5.0))
        f = sell_base(bids, 10.0, 0.0)
        self.assertTrue(f.filled)
        self.assertAlmostEqual(f.out_amount, 5 * 100 + 5 * 90)
        self.assertAlmostEqual(f.vwap, 95.0)

    def test_empty_book_yields_nothing(self):
        self.assertEqual(buy_base((), 100.0, 0.0).out_amount, 0.0)
        self.assertEqual(sell_base((), 100.0, 0.0).out_amount, 0.0)


class TestBookHygiene(unittest.TestCase):
    def test_crossed_book_is_invalid(self):
        b = OrderBook.build("X", [[110.0, 1.0]], [[100.0, 1.0]])
        self.assertFalse(b.is_valid())

    def test_levels_are_sorted_defensively(self):
        b = OrderBook.build("X", [[90.0, 1.0], [95.0, 1.0]], [[110.0, 1.0], [105.0, 1.0]])
        self.assertEqual(b.best_bid, 95.0)
        self.assertEqual(b.best_ask, 105.0)

    def test_zero_size_levels_dropped(self):
        b = OrderBook.build("X", [[95.0, 0.0], [90.0, 2.0]], [[105.0, 1.0]])
        self.assertEqual(b.best_bid, 90.0)

    def test_imbalance_sign(self):
        heavy_bid = OrderBook.build("X", [[100.0, 100.0]], [[101.0, 1.0]])
        self.assertGreater(order_book_imbalance(heavy_bid), 0.9)


class TestTriangleConstruction(unittest.TestCase):
    def test_finds_both_directions(self):
        tris = build_triangles(MARKETS, "IRT")
        self.assertEqual(len(tris), 2)
        self.assertEqual({t.name for t in tris},
                         {"IRT>USDT>BTC>IRT", "IRT>BTC>USDT>IRT"})

    def test_cycles_start_and_end_in_irt(self):
        for t in build_triangles(MARKETS, "IRT"):
            self.assertTrue(t.path.startswith("IRT"))
            self.assertTrue(t.path.endswith("IRT"))

    def test_no_cross_market_means_no_triangle(self):
        self.assertEqual(build_triangles([USDTIRT, BTCIRT], "IRT"), [])


class TestCycleMath(unittest.TestCase):
    def consistent_books(self):
        """Perfectly consistent prices: 1 BTC = 100 USDT = 1,000,000 IRT."""
        return {
            "USDTIRT": book("USDTIRT", 10_000.0, 10_000.0),
            "BTCUSDT": book("BTCUSDT", 100.0, 100.0),
            "BTCIRT": book("BTCIRT", 1_000_000.0, 1_000_000.0),
        }

    def test_consistent_prices_yield_exactly_zero_without_fees(self):
        for tri in build_triangles(MARKETS, "IRT"):
            r = run_cycle(tri, self.consistent_books(), 1_000_000.0, 0.0)
            self.assertTrue(r.feasible)
            self.assertAlmostEqual(r.ratio, 1.0, places=9)

    def test_fees_make_a_flat_cycle_lose_exactly_three_legs_of_fee(self):
        fee = 0.0025
        for tri in build_triangles(MARKETS, "IRT"):
            r = run_cycle(tri, self.consistent_books(), 1_000_000.0, fee)
            self.assertAlmostEqual(r.ratio, (1 - fee) ** 3, places=9)

    def test_real_mispricing_is_detected(self):
        books = self.consistent_books()
        # BTC/IRT quoted 2% rich: selling BTC there completes the loop at a profit.
        books["BTCIRT"] = book("BTCIRT", 1_020_000.0, 1_020_000.0)
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        r = run_cycle(tri, books, 1_000_000.0, 0.0)
        self.assertTrue(r.feasible)
        self.assertAlmostEqual(r.ratio, 1.02, places=9)

    def test_fees_erase_a_thin_edge(self):
        books = self.consistent_books()
        books["BTCIRT"] = book("BTCIRT", 1_003_000.0, 1_003_000.0)  # +30 bps gross
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        gross = run_cycle(tri, books, 1_000_000.0, 0.0)
        net = run_cycle(tri, books, 1_000_000.0, 0.0025)  # 75 bps of cost
        self.assertGreater(gross.profit, 0)
        self.assertLess(net.profit, 0)

    def test_spread_alone_is_not_an_opportunity(self):
        """A wide bid/ask on consistent mids must never look profitable."""
        books = {
            "USDTIRT": book("USDTIRT", 9_950.0, 10_050.0),
            "BTCUSDT": book("BTCUSDT", 99.5, 100.5),
            "BTCIRT": book("BTCIRT", 995_000.0, 1_005_000.0),
        }
        for tri in build_triangles(MARKETS, "IRT"):
            r = run_cycle(tri, books, 1_000_000.0, 0.0)
            self.assertLess(r.profit, 0, f"{tri.name} showed phantom profit")

    def test_missing_or_invalid_book_is_not_feasible(self):
        tri = build_triangles(MARKETS, "IRT")[0]
        books = self.consistent_books()
        del books["BTCUSDT"]
        self.assertFalse(run_cycle(tri, books, 1_000_000.0, 0.0).feasible)

    def test_fees_bps_accounting_matches_the_shortfall(self):
        fee = 0.002
        tri = build_triangles(MARKETS, "IRT")[0]
        r = run_cycle(tri, self.consistent_books(), 1_000_000.0, fee)
        expected_loss_bps = (1 - (1 - fee) ** 3) * 10_000
        self.assertAlmostEqual(r.total_fees_bps, expected_loss_bps, places=4)


class TestSizing(unittest.TestCase):
    def test_size_is_capped_by_visible_depth(self):
        # Only 2 USDT of depth exists, so no size above ~20,000 IRT can fill.
        books = {
            "USDTIRT": OrderBook.build("USDTIRT", [[10_000.0, 100.0]], [[10_000.0, 2.0]]),
            "BTCUSDT": OrderBook.build("BTCUSDT", [[100.0, 100.0]], [[100.0, 100.0]]),
            "BTCIRT": OrderBook.build("BTCIRT", [[1_100_000.0, 100.0]], [[1_100_000.0, 100.0]]),
        }
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = best_size(tri, books, 0.0, 1_000.0, 10_000_000.0)
        self.assertIsNotNone(res)
        self.assertTrue(res.feasible)
        self.assertLessEqual(res.start_amount, 20_000.0 + 1e-6)

    def test_optimum_stops_before_the_book_turns_unprofitable(self):
        """First ask level is cheap, the second is expensive: size must not overreach."""
        books = {
            "USDTIRT": OrderBook.build(
                "USDTIRT", [[9_700.0, 1e6]], [[9_800.0, 10.0], [10_400.0, 1e6]]
            ),
            "BTCUSDT": OrderBook.build("BTCUSDT", [[100.0, 1e6]], [[100.0, 1e6]]),
            "BTCIRT": OrderBook.build("BTCIRT", [[1_000_000.0, 1e6]], [[1_000_000.0, 1e6]]),
        }
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = best_size(tri, books, 0.0, 1_000.0, 10_000_000.0)
        self.assertGreater(res.profit, 0)
        # 10 USDT of cheap depth == 98,000 IRT; going far past it destroys the edge.
        self.assertLess(res.start_amount, 130_000.0)

    def test_no_opportunity_returns_a_loss_not_a_crash(self):
        books = {
            "USDTIRT": book("USDTIRT", 10_000.0, 10_000.0),
            "BTCUSDT": book("BTCUSDT", 100.0, 100.0),
            "BTCIRT": book("BTCIRT", 1_000_000.0, 1_000_000.0),
        }
        tri = build_triangles(MARKETS, "IRT")[0]
        res = best_size(tri, books, 0.0025, 1_000.0, 1_000_000.0)
        self.assertIsNotNone(res)
        self.assertLess(res.profit, 0)


class TestExchangeMinimums(unittest.TestCase):
    """Nobitex requires 3,000,000 rial on rial markets and 11 USDT on tether ones.

    The tether floor binds a triangle harder than the rial one, because the
    middle leg is quoted in USDT. A simulator that ignores it reports trades
    the exchange would have rejected.
    """

    USDT_IRT = 1_150_000.0
    BTC_USDT = 95_000.0
    MINIMUMS = {"IRT": 3_000_000.0, "USDT": 11.0}

    def books(self, skew: float = 0.0):
        return {
            "USDTIRT": book("USDTIRT", self.USDT_IRT, self.USDT_IRT),
            "BTCUSDT": book("BTCUSDT", self.BTC_USDT, self.BTC_USDT),
            "BTCIRT": book("BTCIRT", self.USDT_IRT * self.BTC_USDT * (1 + skew),
                           self.USDT_IRT * self.BTC_USDT * (1 + skew)),
        }

    def test_tether_leg_sets_the_floor_not_the_rial_leg(self):
        for tri in build_triangles(MARKETS, "IRT"):
            floor = implied_min_start(tri, self.books(), self.MINIMUMS)
            self.assertAlmostEqual(floor, 11 * self.USDT_IRT, delta=1.0)
            self.assertGreater(floor, self.MINIMUMS["IRT"])

    def test_a_cycle_under_the_tether_minimum_is_rejected(self):
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        # 5,000,000 rial clears the rial floor but is only ~4.3 USDT on leg two.
        res = run_cycle(tri, self.books(0.02), 5_000_000.0, 0.0, self.MINIMUMS)
        self.assertFalse(res.feasible)
        self.assertIn("USDT", res.reason)
        self.assertIn("BTCUSDT", res.reason)

    def test_the_same_cycle_is_accepted_above_the_floor(self):
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = run_cycle(tri, self.books(0.02), 20_000_000.0, 0.0, self.MINIMUMS)
        self.assertTrue(res.feasible, res.reason)
        self.assertGreater(res.profit, 0)

    def test_sizing_never_proposes_an_unplaceable_order(self):
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = best_size(tri, self.books(0.02), 0.0, 1_000_000.0, 100_000_000.0,
                        min_notionals=self.MINIMUMS)
        self.assertIsNotNone(res)
        self.assertTrue(res.feasible, res.reason)
        self.assertGreaterEqual(res.start_amount, 11 * self.USDT_IRT - 1.0)

    def test_capital_below_the_floor_yields_no_trade_at_all(self):
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = best_size(tri, self.books(0.02), 0.0, 1_000_000.0, 8_000_000.0,
                        min_notionals=self.MINIMUMS)
        self.assertIsNone(res, "a cap under the tether floor must produce nothing")

    def test_without_minimums_the_old_permissive_behaviour_remains(self):
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        res = run_cycle(tri, self.books(0.02), 5_000_000.0, 0.0)
        self.assertTrue(res.feasible)


class TestBreakEvenFee(unittest.TestCase):
    def test_closed_form_matches_simulation(self):
        books = {
            "USDTIRT": book("USDTIRT", 10_000.0, 10_000.0),
            "BTCUSDT": book("BTCUSDT", 100.0, 100.0),
            "BTCIRT": book("BTCIRT", 1_010_000.0, 1_010_000.0),
        }
        tri = next(t for t in build_triangles(MARKETS, "IRT") if t.name == "IRT>USDT>BTC>IRT")
        gross = run_cycle(tri, books, 1_000_000.0, 0.0)
        f = break_even_fee(gross.ratio)
        at_break_even = run_cycle(tri, books, 1_000_000.0, f)
        self.assertAlmostEqual(at_break_even.ratio, 1.0, places=9)
        self.assertTrue(0 < f < 0.01)

    def test_no_edge_means_zero_tolerable_fee(self):
        self.assertLessEqual(break_even_fee(1.0), 1e-12)


class TestStats(unittest.TestCase):
    def test_summary_basics(self):
        s = summarize([1.0, -2.0, 3.0, 4.0])
        self.assertEqual(s.n, 4)
        self.assertEqual(s.positive, 3)
        self.assertAlmostEqual(s.total, 6.0)
        self.assertAlmostEqual(s.mean, 1.5)

    def test_bootstrap_interval_brackets_the_mean(self):
        xs = [1.0, 2.0, 3.0, 4.0, 5.0] * 20
        lo, hi = bootstrap_ci(xs)
        self.assertLess(lo, 3.0)
        self.assertGreater(hi, 3.0)

    def test_noisy_zero_mean_series_is_not_significant(self):
        xs = [1.0, -1.0] * 50
        lo, hi = bootstrap_ci(xs)
        self.assertLessEqual(lo, 0.0)
        self.assertGreaterEqual(hi, 0.0)

    def test_drawdown(self):
        abs_dd, pct = max_drawdown([100.0, 120.0, 90.0, 110.0])
        self.assertAlmostEqual(abs_dd, 30.0)
        self.assertAlmostEqual(pct, 0.25)

    def test_drawdown_of_monotonic_curve_is_zero(self):
        self.assertEqual(max_drawdown([1.0, 2.0, 3.0])[0], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
