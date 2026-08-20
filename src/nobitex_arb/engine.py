"""The paper-trading engine.

The single most important design decision is here: an opportunity spotted
on snapshot N is never filled at snapshot N's prices. It is queued and
settled against snapshot N+1, so every reported profit has already
survived one full poll interval of market movement. Real latency is
smaller than that, which makes these results conservative rather than
flattering -- the opposite of how arbitrage bots are usually demonstrated.
"""

from __future__ import annotations

import json
import logging
import signal
import time
from dataclasses import dataclass
from typing import Mapping

from .config import Config
from .microstructure import MarketFilter, Snapshot
from .models import OrderBook, Triangle
from .nobitex import FeedError, NobitexFeed, detect_irt_unit
from .storage import Store
from .triangle import CycleResult, best_size, break_even_fee, build_triangles, run_cycle

log = logging.getLogger("engine")


@dataclass
class PendingOrder:
    """A cycle that has been decided on but not yet filled."""

    triangle: Triangle
    size: float
    expected_bps: float
    ts_signal: float
    obi: dict[str, float]


class PaperEngine:
    def __init__(self, cfg: Config, store: Store, feed: NobitexFeed) -> None:
        self.cfg = cfg
        self.store = store
        self.feed = feed
        self.triangles = build_triangles(cfg.markets, cfg.start_currency)
        self.filter = MarketFilter(
            max_spread_bps=cfg.max_spread_bps,
            min_depth_multiple=cfg.min_depth_multiple,
            max_sigma_bps=cfg.max_sigma_bps,
            obi_levels=cfg.obi_levels,
        )
        self.balance = float(cfg.capital_irt)
        self.peak_balance = self.balance
        self.pending: PendingOrder | None = None
        self.last_trade_ts = 0.0
        self.run_id = 0
        self.polls = 0
        self.trades = 0
        self.wins = 0
        self.opportunities = 0
        self.irt_unit = cfg.irt_unit
        self.quiet = False
        self._stop = False

    # ------------------------------------------------------------------ run

    def install_signal_handlers(self) -> None:
        def handler(signum, frame):  # noqa: ARG001
            self._stop = True
            print("\nstopping after this poll...", flush=True)

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass

    def run(self, duration_sec: float | None = None) -> None:
        if not self.triangles:
            raise SystemExit("no triangles could be built from the configured markets")

        started = time.time()
        self.run_id = self.store.start_run(started, self.cfg.to_dict())
        self.store.add_equity(self.run_id, started, self.balance)
        self.store.commit()

        print(f"run #{self.run_id} | {len(self.triangles)} triangles | capital {self._fmt(self.balance)}")
        for t in self.triangles:
            print(f"  - {t.path}")
        print("press Ctrl+C to stop\n", flush=True)

        consecutive_failures = 0
        while not self._stop:
            if duration_sec is not None and time.time() - started >= duration_sec:
                break
            cycle_start = time.time()
            try:
                books = self.feed.fetch(tuple({s for t in self.triangles for s in t.symbols}))
                consecutive_failures = 0
                self.step(books)
            except FeedError as exc:
                consecutive_failures += 1
                log.warning("feed error (%d in a row): %s", consecutive_failures, exc)
                # Back off so a exchange-side outage does not turn into a request flood.
                time.sleep(min(60.0, self.cfg.poll_interval_sec * (2 ** min(consecutive_failures, 5))))
                continue
            except Exception:
                log.exception("unexpected error in poll loop; continuing")

            elapsed = time.time() - cycle_start
            time.sleep(max(0.0, self.cfg.poll_interval_sec - elapsed))

        self.store.end_run(self.run_id, time.time())
        self.store.commit()
        self._print_summary(time.time() - started)

    # ----------------------------------------------------------------- step

    def step(self, books: Mapping[str, OrderBook], now: float | None = None) -> None:
        now = time.time() if now is None else now
        self.polls += 1
        snaps = self.filter.observe(books)
        self._resolve_unit(books)
        self._persist_snapshots(now, books, snaps)

        # 1. Settle anything queued on the previous poll, at the new prices.
        if self.pending is not None:
            self._settle(self.pending, books, now)
            self.pending = None

        # 2. Look for a new opportunity.
        if now - self.last_trade_ts < self.cfg.cooldown_sec:
            self.store.commit()
            self._status(now, None)
            return

        best: CycleResult | None = None
        for tri in self.triangles:
            cap = min(self.cfg.max_order_irt, self.balance)
            if cap < self.cfg.min_order_irt:
                continue
            res = best_size(tri, books, self.cfg.fee_rate, self.cfg.min_order_irt, cap)
            if res is None or not res.feasible:
                continue
            if best is None or res.profit > best.profit:
                best = res

        if best is not None and best.profit_bps > 0:
            self.opportunities += 1
            taken, reason = self._admit(best, snaps)
            self.store.add_opportunity(
                self.run_id,
                (
                    now, best.triangle.name, best.start_amount,
                    best.gross_bps, best.profit_bps, best.profit,
                    best.max_slippage_bps, int(taken), reason,
                ),
            )
            if taken:
                self.pending = PendingOrder(
                    triangle=best.triangle,
                    size=best.start_amount,
                    expected_bps=best.profit_bps,
                    ts_signal=now,
                    obi={s: snaps[s].obi for s in best.triangle.symbols if s in snaps},
                )

        self.store.commit()
        self._status(now, best)

    def _admit(self, res: CycleResult, snaps: Mapping[str, Snapshot]) -> tuple[bool, str]:
        if res.profit_bps < self.cfg.min_profit_bps:
            return False, f"edge {res.profit_bps:.1f}bps below threshold"
        notionals = res.quote_notionals()
        verdict = self.filter.check(res.triangle.symbols, snaps, notionals)
        if not verdict.ok:
            return False, verdict.reason
        if res.start_amount > self.balance:
            return False, "insufficient balance"
        return True, ""

    def _settle(self, order: PendingOrder, books: Mapping[str, OrderBook], now: float) -> None:
        """Execute the queued cycle against the *current* book."""
        realized = run_cycle(order.triangle, books, order.size, self.cfg.fee_rate)

        if not realized.feasible:
            # The opportunity evaporated before we could act -- that is a real
            # outcome, not an error, and it costs nothing but is worth counting.
            self.store.add_trade(
                self.run_id,
                (
                    order.ts_signal, now, now - order.ts_signal, order.triangle.name,
                    order.size, order.expected_bps, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                    json.dumps(order.obi), f"vanished:{realized.reason}", self.balance,
                ),
            )
            self.last_trade_ts = now
            return

        pnl = realized.profit
        self.balance += pnl
        self.peak_balance = max(self.peak_balance, self.balance)
        self.trades += 1
        if pnl > 0:
            self.wins += 1

        fees_irt = realized.total_fees_bps / 10_000.0 * order.size
        self.store.add_trade(
            self.run_id,
            (
                order.ts_signal, now, now - order.ts_signal, order.triangle.name,
                order.size, order.expected_bps, realized.profit_bps,
                realized.gross_bps, pnl, fees_irt, realized.max_slippage_bps,
                break_even_fee(realized.gross_ratio),
                json.dumps(order.obi), "filled", self.balance,
            ),
        )
        self.store.add_equity(self.run_id, now, self.balance)
        self.last_trade_ts = now

        if self.quiet:
            return
        arrow = "+" if pnl >= 0 else "-"
        print(
            f"  [fill] {order.triangle.name} size={self._fmt(order.size)} "
            f"expected={order.expected_bps:+.1f}bps realized={realized.profit_bps:+.1f}bps "
            f"pnl={arrow}{self._fmt(abs(pnl))}",
            flush=True,
        )

    # ------------------------------------------------------------- plumbing

    def _resolve_unit(self, books: Mapping[str, OrderBook]) -> None:
        if self.irt_unit != "auto":
            return
        probe = books.get("USDTIRT")
        if probe is not None and probe.is_valid():
            unit = detect_irt_unit(probe.mid)
            if unit != "unknown":
                self.irt_unit = unit
                if not self.quiet:
                    print(f"[unit] IRT prices look like {unit}", flush=True)

    def _persist_snapshots(self, now: float, books: Mapping[str, OrderBook], snaps: Mapping[str, Snapshot]) -> None:
        n = self.cfg.store_book_levels
        rows = []
        for sym, book in books.items():
            s = snaps[sym]
            rows.append((
                now, sym, book.best_bid, book.best_ask, s.spread_bps, s.obi, s.sigma_bps,
                json.dumps([[lv.price, lv.amount] for lv in book.bids[:n]]),
                json.dumps([[lv.price, lv.amount] for lv in book.asks[:n]]),
            ))
        self.store.add_snapshots(self.run_id, rows)

    def _fmt(self, amount: float) -> str:
        if self.irt_unit == "rial":
            return f"{amount/10:,.0f} toman"
        return f"{amount:,.0f} {self.cfg.start_currency}"

    def _status(self, now: float, best: CycleResult | None) -> None:
        if self.quiet:
            return
        edge = f"{best.profit_bps:+7.1f}bps" if best is not None else "   none"
        pnl = self.balance - self.cfg.capital_irt
        line = (
            f"\r[{time.strftime('%H:%M:%S', time.localtime(now))}] "
            f"polls={self.polls} best={edge} opps={self.opportunities} "
            f"trades={self.trades} pnl={pnl:+,.0f}   "
        )
        print(line, end="", flush=True)

    def _print_summary(self, elapsed: float) -> None:
        pnl = self.balance - self.cfg.capital_irt
        print("\n" + "=" * 62)
        print(f"ran for {elapsed/3600:.2f} h | polls {self.polls} "
              f"(feed success {self.feed.stats.success_rate*100:.1f}%)")
        print(f"opportunities seen : {self.opportunities}")
        print(f"trades executed    : {self.trades} (profitable: {self.wins})")
        print(f"net P&L            : {pnl:+,.0f} ({pnl/self.cfg.capital_irt*100:+.4f}% of capital)")
        print("=" * 62)
        print("run `report.bat` for the full statistical breakdown.")
