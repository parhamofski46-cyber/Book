"""Nobitex public market-data client.

Only public read-only endpoints are used: no API key, no credentials, and
no order placement anywhere in this project. The response shape is
normalised defensively because the exchange has shipped several order-book
formats (v2 and v3, per-symbol and batched) and mixes strings with numbers.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import requests

from .models import OrderBook

USER_AGENT = "nobitex-arb-lab/0.1 (paper trading, read-only)"


class FeedError(RuntimeError):
    pass


@dataclass
class FetchStats:
    attempts: int = 0
    failures: int = 0
    last_error: str = ""

    @property
    def success_rate(self) -> float:
        if self.attempts == 0:
            return 0.0
        return (self.attempts - self.failures) / self.attempts


def _num(x: Any) -> float:
    """Nobitex returns prices as strings in some endpoints and floats in others."""
    if isinstance(x, str):
        return float(x.replace(",", "").strip())
    return float(x)


def _pairs(raw: Any) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    if not isinstance(raw, Iterable):
        return out
    for row in raw:
        if isinstance(row, Sequence) and not isinstance(row, (str, bytes)) and len(row) >= 2:
            try:
                out.append((_num(row[0]), _num(row[1])))
            except (TypeError, ValueError):
                continue
    return out


class NobitexFeed:
    """Fetches order books, preferring the single batched request."""

    def __init__(self, base_url: str, timeout: float = 10.0, levels: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.levels = levels
        self.stats = FetchStats()
        self.mode = "auto"  # resolved to "batch" or "single" on first success
        self._last_reasons: list[str] = []
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})

    def close(self) -> None:
        self._session.close()

    def _get(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        resp = self._session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def fetch(self, symbols: Sequence[str]) -> dict[str, OrderBook]:
        """Return a book per symbol. Symbols that fail are simply absent."""
        self.stats.attempts += 1
        self._last_reasons = []
        try:
            if self.mode in ("auto", "batch"):
                books = self._fetch_batch(symbols)
                if books:
                    self.mode = "batch"
                    return books
                if self.mode == "auto":
                    self.mode = "single"
            books = self._fetch_single(symbols)
            if not books:
                # "no order books returned" on its own tells nobody anything.
                # Carry what actually went wrong, per endpoint.
                detail = "; ".join(self._last_reasons[:4]) or "no detail available"
                raise FeedError(f"no order books returned ({detail})")
            self.mode = "single"
            return books
        except Exception as exc:  # network, JSON, or schema trouble -- caller retries
            self.stats.failures += 1
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            raise FeedError(self.stats.last_error) from exc

    def _fetch_batch(self, symbols: Sequence[str]) -> dict[str, OrderBook]:
        try:
            payload = self._get("/v3/orderbook/all")
        except Exception as exc:
            self._note("/v3/orderbook/all", exc)
            return {}
        if not isinstance(payload, dict):
            return {}
        ts = time.time()
        books: dict[str, OrderBook] = {}
        for sym in symbols:
            entry = payload.get(sym)
            book = self._parse(sym, entry, ts)
            if book is not None:
                books[sym] = book
        return books

    def _fetch_single(self, symbols: Sequence[str]) -> dict[str, OrderBook]:
        ts = time.time()
        books: dict[str, OrderBook] = {}
        for sym in symbols:
            entry = None
            for path in (f"/v3/orderbook/{sym}", f"/v2/orderbook/{sym}"):
                try:
                    entry = self._get(path)
                    break
                except Exception as exc:
                    self._note(path, exc)
                    continue
            if entry is not None and self._parse(sym, entry, ts) is None:
                self._note(f"/v3/orderbook/{sym}", "response had no usable bids/asks")
            book = self._parse(sym, entry, ts)
            if book is not None:
                books[sym] = book
        return books

    def _parse(self, symbol: str, entry: Any, ts: float) -> OrderBook | None:
        if not isinstance(entry, dict):
            return None
        if str(entry.get("status", "ok")).lower() not in ("ok", "none", ""):
            return None
        bids = _pairs(entry.get("bids"))
        asks = _pairs(entry.get("asks"))
        if not bids or not asks:
            return None
        book = OrderBook.build(symbol, bids[: self.levels], asks[: self.levels], ts)
        return book if book.is_valid() else None

    def _note(self, path: str, problem: Any) -> None:
        text = (f"{type(problem).__name__}: {problem}"
                if isinstance(problem, BaseException) else str(problem))
        self._last_reasons.append(f"{path} -> {text[:160]}")

    def fetch_options(self) -> dict[str, float]:
        """Read the exchange's own minimum order values from GET /v2/options.

        Better than trusting a number typed into a config file: these are the
        limits the matching engine will actually enforce.
        """
        payload = self._get("/v2/options")
        if not isinstance(payload, dict):
            raise FeedError("unexpected /v2/options payload")
        raw = (payload.get("nobitex") or {}).get("minOrders") or {}
        mapping = {"rls": "IRT", "irt": "IRT", "usdt": "USDT"}
        out: dict[str, float] = {}
        for key, value in raw.items():
            quote = mapping.get(str(key).lower())
            if quote is None:
                continue
            try:
                out[quote] = _num(value)
            except (TypeError, ValueError):
                continue
        if not out:
            raise FeedError("/v2/options carried no recognisable minOrders")
        return out

    def raw(self, symbol: str) -> Any:
        """Untouched payload, for the `doctor` command."""
        for path in (f"/v3/orderbook/{symbol}", f"/v2/orderbook/{symbol}"):
            try:
                return {"path": path, "payload": self._get(path)}
            except Exception as exc:
                last = f"{type(exc).__name__}: {exc}"
        return {"path": "none", "error": last}


def detect_irt_unit(usdt_irt_mid: float) -> str:
    """Nobitex quotes IRT markets in rial; some mirrors use toman.

    A USDT price in the hundreds of thousands is rial; in the tens of
    thousands it is toman. Getting this wrong changes every reported number
    by 10x, so we check rather than assume.
    """
    if usdt_irt_mid <= 0:
        return "unknown"
    if usdt_irt_mid >= 200_000:
        return "rial"
    if usdt_irt_mid >= 20_000:
        return "toman"
    return "unknown"
