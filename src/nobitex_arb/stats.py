"""Statistics used to decide whether a result is signal or luck.

A handful of profitable paper trades proves nothing on its own. These
functions quantify how much of the observed P&L could be explained by
chance, which is the question that actually matters before risking money.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True, slots=True)
class Summary:
    n: int
    total: float
    mean: float
    median: float
    stdev: float
    minimum: float
    maximum: float
    positive: int

    @property
    def hit_rate(self) -> float:
        return self.positive / self.n if self.n else 0.0


def summarize(xs: Sequence[float]) -> Summary:
    if not xs:
        return Summary(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0)
    s = sorted(xs)
    n = len(s)
    total = sum(s)
    mean = total / n
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    var = sum((x - mean) ** 2 for x in s) / (n - 1) if n > 1 else 0.0
    return Summary(n, total, mean, median, math.sqrt(var), s[0], s[-1], sum(1 for x in s if x > 0))


def _resample_budget(n: int, requested: int) -> int:
    """Keep total resampling work bounded so a long run still reports quickly.

    Cost is resamples x n. A multi-day run can produce thousands of trades, and
    a fixed 10,000 resamples would then take minutes for no extra precision
    worth having -- the interval is already tight by then.
    """
    if n <= 0:
        return 0
    budget = 5_000_000
    return max(2_000, min(requested, budget // max(n, 1)))


def bootstrap_means(
    xs: Sequence[float],
    resamples: int = 10_000,
    seed: int = 20260820,
) -> list[float]:
    """Means of `resamples` bootstrap resamples, sorted ascending."""
    n = len(xs)
    if n < 2:
        return []
    rng = random.Random(seed)
    draws = _resample_budget(n, resamples)
    pool = list(xs)
    choices = rng.choices          # C-implemented; far faster than a per-item loop
    means = [sum(choices(pool, k=n)) / n for _ in range(draws)]
    means.sort()
    return means


def bootstrap_ci(
    xs: Sequence[float],
    confidence: float = 0.95,
    resamples: int = 10_000,
    seed: int = 20260820,
    means: Sequence[float] | None = None,
) -> tuple[float, float]:
    """Percentile bootstrap CI for the mean.

    Trade P&L is heavily skewed and nothing like normal, so a t-interval
    would understate the tails. Resampling makes no distributional claim.
    Pass `means` to reuse a set of resamples already computed.
    """
    m = list(means) if means is not None else bootstrap_means(xs, resamples, seed)
    if not m:
        return (0.0, 0.0)
    lo_i = int((1 - confidence) / 2 * len(m))
    hi_i = min(len(m) - 1, int((1 + confidence) / 2 * len(m)))
    return (m[lo_i], m[hi_i])


def probability_positive(
    xs: Sequence[float],
    resamples: int = 10_000,
    seed: int = 20260820,
    means: Sequence[float] | None = None,
) -> float:
    """Share of bootstrap resamples whose mean is above zero."""
    m = list(means) if means is not None else bootstrap_means(xs, resamples, seed)
    if not m:
        return 0.0
    return sum(1 for v in m if v > 0) / len(m)


def sharpe(xs: Sequence[float], periods_per_year: float) -> float:
    """Annualised Sharpe of the per-trade return series (risk-free = 0)."""
    s = summarize(xs)
    if s.n < 2 or s.stdev == 0:
        return 0.0
    return s.mean / s.stdev * math.sqrt(periods_per_year)


def max_drawdown(equity: Sequence[float]) -> tuple[float, float]:
    """Largest peak-to-trough decline, absolute and as a fraction."""
    if not equity:
        return (0.0, 0.0)
    peak = equity[0]
    worst_abs = 0.0
    worst_pct = 0.0
    for v in equity:
        peak = max(peak, v)
        dd = peak - v
        if dd > worst_abs:
            worst_abs = dd
            worst_pct = dd / peak if peak else 0.0
    return (worst_abs, worst_pct)


def compound_projection(total_return: float, elapsed_sec: float, horizon_days: float) -> float:
    """Extrapolate an observed return to a horizon. Read the warning in the report."""
    if elapsed_sec <= 0:
        return 0.0
    periods = horizon_days * 86_400 / elapsed_sec
    growth = 1.0 + total_return
    if growth <= 0:
        return -1.0
    try:
        return growth ** periods - 1.0
    except OverflowError:
        return float("inf")


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float:
    n = min(len(xs), len(ys))
    if n < 3:
        return 0.0
    mx = sum(xs[:n]) / n
    my = sum(ys[:n]) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    dx = math.sqrt(sum((xs[i] - mx) ** 2 for i in range(n)))
    dy = math.sqrt(sum((ys[i] - my) ** 2 for i in range(n)))
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)
