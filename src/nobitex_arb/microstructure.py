"""Market-microstructure signals.

These are the measurements that actually matter for latency-sensitive
execution. Deliberately no trend indicators: a triangular cycle opens and
closes within seconds, so the direction of the market is irrelevant to it.
What is relevant is whether the book is thick enough, quiet enough, and
not about to move against us between the quote and the fill.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Mapping

from .models import OrderBook


def order_book_imbalance(book: OrderBook, levels: int = 5) -> float:
    """(bid notional - ask notional) / total, in [-1, 1].

    Positive means buy pressure. Empirically the strongest short-horizon
    predictor of the next tick's direction, which is exactly the horizon
    our latency exposes us to.
    """
    bid = book.depth_notional("bid", levels)
    ask = book.depth_notional("ask", levels)
    total = bid + ask
    if total <= 0:
        return 0.0
    return (bid - ask) / total


def microprice(book: OrderBook) -> float:
    """Depth-weighted fair price: leans toward the side with less size."""
    if not book.is_valid():
        return 0.0
    qb = book.bids[0].amount
    qa = book.asks[0].amount
    if qb + qa <= 0:
        return book.mid
    return (book.best_bid * qa + book.best_ask * qb) / (qb + qa)


class RollingVolatility:
    """Realized volatility of log mid-price returns over a sliding window."""

    def __init__(self, window: int = 60) -> None:
        self.window = window
        self._prices: deque[float] = deque(maxlen=window)

    def update(self, price: float) -> None:
        if price > 0:
            self._prices.append(price)

    @property
    def ready(self) -> bool:
        return len(self._prices) >= 8

    def sigma_bps(self) -> float:
        """Per-observation standard deviation of returns, in bps."""
        if not self.ready:
            return 0.0
        p = list(self._prices)
        rets = [math.log(p[i] / p[i - 1]) for i in range(1, len(p)) if p[i - 1] > 0]
        if len(rets) < 2:
            return 0.0
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        return math.sqrt(var) * 10_000.0


@dataclass(frozen=True, slots=True)
class Snapshot:
    """Per-symbol microstructure state captured alongside each poll."""

    symbol: str
    mid: float
    spread_bps: float
    obi: float
    sigma_bps: float
    bid_depth: float
    ask_depth: float


@dataclass(frozen=True, slots=True)
class FilterVerdict:
    ok: bool
    reason: str = ""


class MarketFilter:
    """Pre-trade sanity gate.

    Each rule below exists to block a specific way that a paper profit fails
    to survive contact with a real exchange.
    """

    def __init__(
        self,
        max_spread_bps: float,
        min_depth_multiple: float,
        max_sigma_bps: float,
        obi_levels: int = 5,
    ) -> None:
        self.max_spread_bps = max_spread_bps
        self.min_depth_multiple = min_depth_multiple
        self.max_sigma_bps = max_sigma_bps
        self.obi_levels = obi_levels
        self._vol: dict[str, RollingVolatility] = {}

    def observe(self, books: Mapping[str, OrderBook]) -> dict[str, Snapshot]:
        out: dict[str, Snapshot] = {}
        for sym, book in books.items():
            vol = self._vol.setdefault(sym, RollingVolatility())
            if book.is_valid():
                vol.update(book.mid)
            out[sym] = Snapshot(
                symbol=sym,
                mid=book.mid,
                spread_bps=book.spread_bps,
                obi=order_book_imbalance(book, self.obi_levels),
                sigma_bps=vol.sigma_bps(),
                bid_depth=book.depth_notional("bid", self.obi_levels),
                ask_depth=book.depth_notional("ask", self.obi_levels),
            )
        return out

    def check(self, symbols: tuple[str, ...], snaps: Mapping[str, Snapshot], notional_by_symbol: Mapping[str, float]) -> FilterVerdict:
        for sym in symbols:
            s = snaps.get(sym)
            if s is None:
                return FilterVerdict(False, f"no snapshot for {sym}")
            if s.mid <= 0:
                return FilterVerdict(False, f"{sym}: empty book")
            if s.spread_bps > self.max_spread_bps:
                return FilterVerdict(False, f"{sym}: spread {s.spread_bps:.0f}bps too wide")
            if s.sigma_bps > self.max_sigma_bps:
                return FilterVerdict(False, f"{sym}: volatility {s.sigma_bps:.0f}bps too high")
            need = notional_by_symbol.get(sym, 0.0) * self.min_depth_multiple
            have = min(s.bid_depth, s.ask_depth)
            if need > 0 and have < need:
                return FilterVerdict(False, f"{sym}: book too thin")
        return FilterVerdict(True)
