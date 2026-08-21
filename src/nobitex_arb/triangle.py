"""Triangle discovery, cycle simulation, and optimal position sizing."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .execution import Fill, buy_base, sell_base
from .models import Leg, Market, OrderBook, Triangle


@dataclass(frozen=True, slots=True)
class CycleResult:
    triangle: Triangle
    start_amount: float
    end_amount: float
    fills: tuple[Fill, ...]
    feasible: bool          # every leg filled completely within visible depth
    reason: str = ""

    @property
    def profit(self) -> float:
        return self.end_amount - self.start_amount

    @property
    def ratio(self) -> float:
        return self.end_amount / self.start_amount if self.start_amount > 0 else 0.0

    @property
    def profit_bps(self) -> float:
        return (self.ratio - 1.0) * 10_000.0

    @property
    def gross_ratio(self) -> float:
        """The cycle multiplier before any fee, from the same fills."""
        if not self.fills:
            return 0.0
        r = 1.0
        for f in self.fills:
            if f.in_amount <= 0:
                return 0.0
            r *= f.out_gross / f.in_amount
        return r

    @property
    def gross_bps(self) -> float:
        return (self.gross_ratio - 1.0) * 10_000.0

    @property
    def total_fees_bps(self) -> float:
        """What the fees cost, in bps of the starting notional.

        Exactly the gap between the fee-free and after-fee multiplier for this
        same path and size. Fees are charged in three different currencies, so
        adding them up naively would be wrong; comparing the two multipliers
        sidesteps the conversion entirely.
        """
        return (self.gross_ratio - self.ratio) * 10_000.0

    def quote_notionals(self) -> dict[str, float]:
        """Per-market trade size, each denominated in that market's own quote currency.

        Needed because BTCUSDT depth is measured in USDT while BTCIRT depth is in
        IRT: comparing either against the cycle's IRT size would be nonsense.
        """
        out: dict[str, float] = {}
        for leg, fill in zip(self.triangle.legs, self.fills):
            out[leg.market.symbol] = fill.in_amount if leg.side == "buy" else fill.out_gross
        return out

    @property
    def max_slippage_bps(self) -> float:
        return max((f.slippage_bps for f in self.fills), default=0.0)


def build_triangles(markets: Sequence[Market], start: str) -> list[Triangle]:
    """Find every closed 3-hop loop that begins and ends in `start`.

    A triangle needs two markets quoted in `start` (say A/START and B/START)
    plus a cross market linking A and B in either orientation.
    """
    by_symbol = {m.symbol: m for m in markets}
    legs_to_start = [m for m in markets if m.quote == start]
    triangles: list[Triangle] = []

    for i, ma in enumerate(legs_to_start):
        for mb in legs_to_start[i + 1:]:
            a, b = ma.base, mb.base
            cross = _find_cross(markets, a, b)
            if cross is None:
                continue
            for first, second in ((ma, mb), (mb, ma)):
                x, y = first.base, second.base
                # START -> X -> Y -> START
                hop = _cross_leg(cross, gives=x, gets=y)
                if hop is None:
                    continue
                tri = Triangle(
                    name=f"{start}>{x}>{y}>{start}",
                    start=start,
                    legs=(Leg(first, "buy"), hop, Leg(second, "sell")),
                )
                triangles.append(tri)

    # Deterministic order keeps reports and DB rows stable across runs.
    triangles.sort(key=lambda t: t.name)
    _ = by_symbol
    return triangles


def _find_cross(markets: Sequence[Market], a: str, b: str) -> Market | None:
    for m in markets:
        if {m.base, m.quote} == {a, b}:
            return m
    return None


def _cross_leg(cross: Market, gives: str, gets: str) -> Leg | None:
    """Pick the side of `cross` that converts `gives` into `gets`."""
    if cross.quote == gives and cross.base == gets:
        return Leg(cross, "buy")
    if cross.base == gives and cross.quote == gets:
        return Leg(cross, "sell")
    return None


def run_cycle(
    triangle: Triangle,
    books: Mapping[str, OrderBook],
    start_amount: float,
    fee_rate: float,
    min_notionals: Mapping[str, float] | None = None,
) -> CycleResult:
    """Push `start_amount` through all three legs against live depth.

    `min_notionals` maps a quote currency to the smallest order the exchange
    accepts in markets quoted in it. Every leg is checked against its own
    quote currency: a cycle whose middle leg falls under the tether minimum
    cannot be placed, however profitable it looks.
    """
    for sym in triangle.symbols:
        book = books.get(sym)
        if book is None:
            return CycleResult(triangle, start_amount, 0.0, (), False, f"missing book {sym}")
        if not book.is_valid():
            return CycleResult(triangle, start_amount, 0.0, (), False, f"invalid book {sym}")

    amount = start_amount
    currency = triangle.start
    fills: list[Fill] = []

    for leg in triangle.legs:
        book = books[leg.market.symbol]
        if currency != leg.gives:
            return CycleResult(triangle, start_amount, 0.0, tuple(fills), False, "currency mismatch")

        if leg.side == "buy":
            fill = buy_base(book.asks, amount, fee_rate)
        else:
            fill = sell_base(book.bids, amount, fee_rate)

        fills.append(fill)
        if fill.out_amount <= 0:
            return CycleResult(triangle, start_amount, 0.0, tuple(fills), False, f"no liquidity on {leg.market.symbol}")
        if not fill.filled:
            return CycleResult(
                triangle, start_amount, 0.0, tuple(fills), False,
                f"depth exhausted on {leg.market.symbol}",
            )

        if min_notionals:
            floor = min_notionals.get(leg.market.quote)
            notional = fill.in_amount if leg.side == "buy" else fill.out_gross
            if floor and notional < floor:
                return CycleResult(
                    triangle, start_amount, 0.0, tuple(fills), False,
                    f"below the {_fmt_min(floor)} {leg.market.quote} minimum "
                    f"on {leg.market.symbol}",
                )

        amount = fill.out_amount
        currency = leg.gets

    if currency != triangle.start:
        return CycleResult(triangle, start_amount, 0.0, tuple(fills), False, "cycle did not close")

    return CycleResult(triangle, start_amount, amount, tuple(fills), True)


def _fmt_min(value: float) -> str:
    return f"{value:,.0f}" if value >= 1 else f"{value:g}"


def implied_min_start(
    triangle: Triangle,
    books: Mapping[str, OrderBook],
    min_notionals: Mapping[str, float],
) -> float:
    """Smallest starting amount that clears every leg's own minimum.

    Worked backwards through the mid prices: an 11 USDT floor on the middle
    leg becomes roughly 12.6 million rial at the start of the cycle, which is
    four times the rial-market minimum. Approximate, because it uses mids
    rather than the executed prices, so the exact check still runs per fill.
    """
    required = 0.0
    rate = 1.0        # start-currency units per unit of the currency we hold
    for leg in triangle.legs:
        book = books.get(leg.market.symbol)
        if book is None or not book.is_valid() or book.mid <= 0:
            continue
        # Buying spends the quote currency, so the leg's notional is measured
        # in what we already hold. Selling spends the base and receives the
        # quote, so the notional is measured in what we are about to hold.
        rate_after = rate * book.mid if leg.side == "buy" else rate / book.mid
        quote_rate = rate if leg.side == "buy" else rate_after
        floor = min_notionals.get(leg.market.quote)
        if floor:
            required = max(required, floor * quote_rate)
        rate = rate_after
    return required


def best_size(
    triangle: Triangle,
    books: Mapping[str, OrderBook],
    fee_rate: float,
    min_notional: float,
    max_notional: float,
    grid: int = 24,
    refine: int = 32,
    min_notionals: Mapping[str, float] | None = None,
) -> CycleResult | None:
    """Find the size that maximises absolute profit.

    Profit is not monotonic in size: a bigger order eats deeper (worse) levels,
    so the optimum sits between the exchange minimum and the depth limit. We
    scan a log-spaced grid, then golden-section refine around the winner.
    """
    if min_notionals:
        # Start the search at a size that can actually be placed, instead of
        # spending the whole grid on sizes the exchange would reject.
        min_notional = max(min_notional, implied_min_start(triangle, books, min_notionals))
    if max_notional < min_notional or min_notional <= 0:
        return None

    def evaluate(size: float) -> CycleResult:
        return run_cycle(triangle, books, size, fee_rate, min_notionals)

    lo_log, hi_log = math.log(min_notional), math.log(max_notional)
    candidates: list[CycleResult] = []
    for i in range(grid):
        t = i / (grid - 1) if grid > 1 else 0.0
        size = math.exp(lo_log + (hi_log - lo_log) * t)
        res = evaluate(size)
        if res.feasible:
            candidates.append(res)

    if not candidates:
        return None

    best = max(candidates, key=lambda r: r.profit)
    if best.profit <= 0:
        return best

    # Golden-section refine in a bracket around the grid winner.
    step = (hi_log - lo_log) / max(grid - 1, 1)
    a = max(lo_log, math.log(best.start_amount) - step)
    b = min(hi_log, math.log(best.start_amount) + step)
    phi = (math.sqrt(5.0) - 1.0) / 2.0
    c, d = b - phi * (b - a), a + phi * (b - a)
    fc, fd = evaluate(math.exp(c)), evaluate(math.exp(d))

    for _ in range(refine):
        if (fc.profit if fc.feasible else -math.inf) > (fd.profit if fd.feasible else -math.inf):
            b, d, fd = d, c, fc
            c = b - phi * (b - a)
            fc = evaluate(math.exp(c))
        else:
            a, c, fc = c, d, fd
            d = a + phi * (b - a)
            fd = evaluate(math.exp(d))
        if b - a < 1e-4:
            break

    for cand in (fc, fd):
        if cand.feasible and cand.profit > best.profit:
            best = cand
    return best


def break_even_fee(gross_ratio: float, legs: int = 3) -> float:
    """The per-leg taker fee at which this cycle exactly breaks even.

    With a fee taken from each leg's output, the net multiplier is
    gross_ratio * (1 - f)**legs, so break-even is f = 1 - gross_ratio**(-1/legs).
    """
    if gross_ratio <= 0:
        return 0.0
    return 1.0 - gross_ratio ** (-1.0 / legs)
