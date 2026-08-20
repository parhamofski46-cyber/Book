"""Depth-aware execution simulator.

Every fill here walks the real order book level by level. There is no
"trade at the best price" shortcut anywhere in this file, because that
shortcut is exactly what makes fake arbitrage backtests look profitable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .models import Level

_EPS = 1e-12


@dataclass(frozen=True, slots=True)
class Fill:
    filled: bool          # did the book have enough depth to complete it?
    in_amount: float      # input currency actually spent
    out_gross: float      # output received before fee
    fee_paid: float       # fee, denominated in the output currency
    out_amount: float     # output received after fee
    vwap: float           # volume-weighted average price (quote per base)
    top_price: float      # best price at the top of the book
    levels_used: int

    @property
    def slippage_bps(self) -> float:
        """How much worse than the top-of-book price we actually got."""
        if self.top_price <= 0 or self.vwap <= 0:
            return 0.0
        return abs(self.vwap - self.top_price) / self.top_price * 10_000.0


def _empty_fill() -> Fill:
    return Fill(False, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0)


def buy_base(asks: Sequence[Level], quote_budget: float, fee_rate: float) -> Fill:
    """Spend `quote_budget` of the quote currency lifting the ask side."""
    if quote_budget <= 0 or not asks:
        return _empty_fill()

    remaining = quote_budget
    base = 0.0
    spent = 0.0
    used = 0

    for lv in asks:
        if remaining <= _EPS:
            break
        take_cost = min(lv.notional, remaining)
        base += take_cost / lv.price
        spent += take_cost
        remaining -= take_cost
        used += 1

    if base <= 0:
        return _empty_fill()

    filled = remaining <= quote_budget * 1e-9
    fee = base * fee_rate
    return Fill(
        filled=filled,
        in_amount=spent,
        out_gross=base,
        fee_paid=fee,
        out_amount=base - fee,
        vwap=spent / base,
        top_price=asks[0].price,
        levels_used=used,
    )


def sell_base(bids: Sequence[Level], base_amount: float, fee_rate: float) -> Fill:
    """Sell `base_amount` of the base currency into the bid side."""
    if base_amount <= 0 or not bids:
        return _empty_fill()

    remaining = base_amount
    quote = 0.0
    sold = 0.0
    used = 0

    for lv in bids:
        if remaining <= _EPS:
            break
        take = min(lv.amount, remaining)
        quote += take * lv.price
        sold += take
        remaining -= take
        used += 1

    if quote <= 0:
        return _empty_fill()

    filled = remaining <= base_amount * 1e-9
    fee = quote * fee_rate
    return Fill(
        filled=filled,
        in_amount=sold,
        out_gross=quote,
        fee_paid=fee,
        out_amount=quote - fee,
        vwap=quote / sold,
        top_price=bids[0].price,
        levels_used=used,
    )
