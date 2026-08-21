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
from .live import LiveState
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
        self.min_notionals = dict(cfg.min_order_by_quote)
        self.quiet = False
        self.live = LiveState()
        self.live.set(
            capital=float(cfg.capital_irt),
            balance=float(cfg.capital_irt),
            fee_rate=cfg.fee_rate,
            irt_unit=cfg.irt_unit,
        )
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

        self.live.set(running=True, run_id=self.run_id, started_at=started,
                      balance=self.balance, capital=float(self.cfg.capital_irt),
                      fee_rate=self.cfg.fee_rate)
        self.live.push_equity(started, self.balance)
        self.live.set_triangles({
            t.name: {"path": t.path, "net_bps": None, "size": 0.0,
                     "note": "در انتظار اولین خواندن دفتر"}
            for t in self.triangles})
        self.live.push_event("run", f"run #{self.run_id} started")
        self._refresh_limits()

        if not self.quiet:
            print(f"run #{self.run_id} | {len(self.triangles)} triangles | "
                  f"capital {self._fmt(self.balance)}")
            for t in self.triangles:
                print(f"  - {t.path}")
            print("press Ctrl+C to stop\n", flush=True)

        symbols = tuple({s for t in self.triangles for s in t.symbols})
        consecutive_failures = 0

        while not self._stop:
            if duration_sec is not None and time.time() - started >= duration_sec:
                break
            cycle_start = time.time()
            try:
                books = self.feed.fetch(symbols)
                consecutive_failures = 0
                self.live.set(feed_ok=True, last_error="",
                              feed_success_rate=self.feed.stats.success_rate)
                self.step(books)
            except FeedError as exc:
                consecutive_failures += 1
                log.warning("feed error (%d in a row): %s", consecutive_failures, exc)
                self.live.set(feed_ok=False, last_error=str(exc),
                              feed_success_rate=self.feed.stats.success_rate)
                if consecutive_failures in (1, 5, 20):
                    self.live.push_event("error", f"connection problem: {exc}")
                # Back off so an exchange-side outage does not become a request flood.
                self._sleep(min(60.0, self.cfg.poll_interval_sec * (2 ** min(consecutive_failures, 5))))
                continue
            except Exception as exc:
                log.exception("unexpected error in poll loop; continuing")
                self.live.push_event("error", f"internal error: {exc}")

            self._sleep(max(0.0, self.cfg.poll_interval_sec - (time.time() - cycle_start)))

        self.store.end_run(self.run_id, time.time())
        self.store.commit()
        self.live.set(running=False, feed_success_rate=self.feed.stats.success_rate)
        self.live.push_event("run", f"run #{self.run_id} stopped")
        if not self.quiet:
            self._print_summary(time.time() - started)

    def _refresh_limits(self) -> None:
        """Replace the configured minimum order values with the exchange's own."""
        if not self.cfg.fetch_exchange_limits:
            return
        try:
            limits = self.feed.fetch_options()
        except Exception as exc:
            log.warning("could not read exchange limits, using the configured ones: %s", exc)
            self.live.push_event(
                "run", "حداقل حجم سفارش از صرافی خوانده نشد؛ مقدار تنظیمات استفاده می‌شود")
            return
        self.min_notionals.update(limits)
        self.live.set(min_notionals=dict(self.min_notionals))
        summary = "، ".join(f"{v:,.0f} {k}" for k, v in sorted(self.min_notionals.items()))
        log.info("exchange minimum order values: %s", summary)
        self.live.push_event("run", f"حداقل حجم سفارش صرافی: {summary}")

    def _sleep(self, seconds: float) -> None:
        """Sleep in slices so a stop request is honoured promptly."""
        deadline = time.time() + seconds
        while not self._stop and time.time() < deadline:
            time.sleep(min(0.25, deadline - time.time()))

    def stop(self) -> None:
        self._stop = True

    # ----------------------------------------------------------------- step

    def step(self, books: Mapping[str, OrderBook], now: float | None = None) -> None:
        now = time.time() if now is None else now
        self.polls += 1
        snaps = self.filter.observe(books)
        self._resolve_unit(books)
        self._persist_snapshots(now, books, snaps)
        self.live.set(polls=self.polls, balance=self.balance, irt_unit=self.irt_unit)
        self.live.set_markets({
            sym: {
                "bid": b.best_bid, "ask": b.best_ask,
                "spread_bps": snaps[sym].spread_bps, "obi": snaps[sym].obi,
                "sigma_bps": snaps[sym].sigma_bps, "mid": b.mid,
                "depth": min(snaps[sym].bid_depth, snaps[sym].ask_depth),
            }
            for sym, b in books.items()
        })

        # 1. Settle anything queued on the previous poll, at the new prices.
        if self.pending is not None:
            self._settle(self.pending, books, now)
            self.pending = None

        # 2. Look for a new opportunity.
        if now - self.last_trade_ts < self.cfg.cooldown_sec:
            self.live.set(cooldown_until=self.last_trade_ts + self.cfg.cooldown_sec)
            self.store.commit()
            self._status(now, None)
            return

        best: CycleResult | None = None
        scan: dict[str, dict] = {}
        for tri in self.triangles:
            cap = min(self.cfg.max_order_irt, self.balance)
            if cap < self.cfg.min_order_irt:
                continue
            res = best_size(tri, books, self.cfg.fee_rate, self.cfg.min_order_irt, cap,
                            min_notionals=self.min_notionals)
            if res is None or not res.feasible:
                scan[tri.name] = {"path": tri.path, "net_bps": None, "size": 0.0,
                                  "note": (res.reason if res else "no depth")}
                continue
            scan[tri.name] = {"path": tri.path, "net_bps": res.profit_bps,
                              "gross_bps": res.gross_bps, "size": res.start_amount, "note": ""}
            if best is None or res.profit > best.profit:
                best = res
        self.live.set_triangles(scan)
        self.live.push_edge(now, best.profit_bps if best is not None else None)
        self.live.set(best_edge_bps=best.profit_bps if best is not None else None,
                      best_triangle=best.triangle.name if best is not None else "")

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
            self.live.set(opportunities=self.opportunities)
            if not taken and reason:
                self.live.push_event("skip", reason, triangle=best.triangle.name)
            if taken:
                self.live.push_event(
                    "signal",
                    f"{best.triangle.name}: {best.profit_bps:+.1f} bps",
                    triangle=best.triangle.name, bps=best.profit_bps, size=best.start_amount,
                )
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
            self.live.bump("vanished")
            self.live.push_event(
                "vanish", f"{order.triangle.name}: opportunity gone before the fill",
                triangle=order.triangle.name,
            )
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

        self.live.set(trades=self.trades, wins=self.wins, balance=self.balance)
        self.live.push_equity(now, self.balance)
        self.live.push_event(
            "fill",
            f"{order.triangle.name}: {realized.profit_bps:+.1f} bps",
            triangle=order.triangle.name, bps=realized.profit_bps,
            expected_bps=order.expected_bps, pnl=pnl, size=order.size,
        )

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
