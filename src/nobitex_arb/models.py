"""Core value objects: order books, markets, triangles."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Iterable, Sequence


@dataclass(frozen=True, slots=True)
class Level:
    """One price level of an order book."""

    price: float
    amount: float

    @property
    def notional(self) -> float:
        return self.price * self.amount


@dataclass(frozen=True, slots=True)
class OrderBook:
    symbol: str
    bids: tuple[Level, ...]  # descending price
    asks: tuple[Level, ...]  # ascending price
    ts: float = field(default_factory=time.time)

    @staticmethod
    def build(symbol: str, bids: Iterable[Sequence], asks: Iterable[Sequence], ts: float | None = None) -> "OrderBook":
        b = tuple(sorted((Level(float(p), float(a)) for p, a in bids if float(a) > 0), key=lambda x: -x.price))
        a = tuple(sorted((Level(float(p), float(a)) for p, a in asks if float(a) > 0), key=lambda x: x.price))
        return OrderBook(symbol=symbol, bids=b, asks=a, ts=ts if ts is not None else time.time())

    @property
    def best_bid(self) -> float:
        return self.bids[0].price if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0].price if self.asks else 0.0

    @property
    def mid(self) -> float:
        if not self.bids or not self.asks:
            return 0.0
        return (self.best_bid + self.best_ask) / 2.0

    @property
    def spread_bps(self) -> float:
        m = self.mid
        if m <= 0:
            return float("inf")
        return (self.best_ask - self.best_bid) / m * 10_000.0

    def is_valid(self) -> bool:
        """Reject empty and crossed books -- those mean bad data, never trade on them.

        A locked book (bid == ask) is unusual but arithmetically fine, so it is
        allowed through; the cycle math handles it without special-casing.
        """
        return bool(self.bids) and bool(self.asks) and self.best_ask >= self.best_bid > 0

    def depth_notional(self, side: str, levels: int = 5) -> float:
        book = self.bids if side == "bid" else self.asks
        return sum(lv.notional for lv in book[:levels])


@dataclass(frozen=True, slots=True)
class Market:
    """A tradable pair. `symbol` is what the exchange calls it."""

    symbol: str
    base: str
    quote: str


@dataclass(frozen=True, slots=True)
class Leg:
    """One hop of a cycle.

    side == "buy":  spend `market.quote`, receive `market.base` (lift the asks)
    side == "sell": spend `market.base`,  receive `market.quote` (hit the bids)
    """

    market: Market
    side: str

    @property
    def gives(self) -> str:
        return self.market.quote if self.side == "buy" else self.market.base

    @property
    def gets(self) -> str:
        return self.market.base if self.side == "buy" else self.market.quote


@dataclass(frozen=True, slots=True)
class Triangle:
    name: str
    start: str
    legs: tuple[Leg, Leg, Leg]

    @property
    def symbols(self) -> tuple[str, ...]:
        return tuple(leg.market.symbol for leg in self.legs)

    @property
    def path(self) -> str:
        cur = self.start
        out = [cur]
        for leg in self.legs:
            cur = leg.gets
            out.append(cur)
        return " -> ".join(out)
