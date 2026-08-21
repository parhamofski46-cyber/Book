"""Configuration loading. Plain JSON so it works on any Python 3.9+ install."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path

from .models import Market

DEFAULT_CONFIG: dict = {
    "_comment": "Verify fee_rate and min_order_* against your own Nobitex account before trusting any number this produces.",
    "base_url": "https://apiv2.nobitex.ir",
    "start_currency": "IRT",
    "irt_unit": "auto",
    "markets": [
        {"symbol": "USDTIRT", "base": "USDT", "quote": "IRT"},
        {"symbol": "BTCIRT", "base": "BTC", "quote": "IRT"},
        {"symbol": "BTCUSDT", "base": "BTC", "quote": "USDT"},
        {"symbol": "ETHIRT", "base": "ETH", "quote": "IRT"},
        {"symbol": "ETHUSDT", "base": "ETH", "quote": "USDT"}
    ],
    "fee_rate": 0.0025,
    "min_order_by_quote": {"IRT": 3000000, "USDT": 11},
    "fetch_exchange_limits": True,
    "poll_interval_sec": 3.0,
    "request_timeout_sec": 10.0,
    "capital_irt": 100000000,
    "min_order_irt": 3000000,
    "max_order_irt": 50000000,
    "min_profit_bps": 5.0,
    "cooldown_sec": 15.0,
    "max_spread_bps": 300.0,
    "min_depth_multiple": 2.0,
    "max_sigma_bps": 80.0,
    "obi_levels": 5,
    "store_book_levels": 10,
    "db_path": "data/paper.db",
    "log_path": "data/run.log"
}


@dataclass
class Config:
    base_url: str = DEFAULT_CONFIG["base_url"]
    start_currency: str = "IRT"
    irt_unit: str = "auto"          # "rial" | "toman" | "auto"
    markets: list[Market] = field(default_factory=list)

    fee_rate: float = 0.0025        # per leg, taker

    # Nobitex enforces a minimum order value per quote currency: 3,000,000 rial
    # on rial markets and 11 USDT on tether markets. The tether one is the
    # binding constraint for a triangle, because the middle leg is quoted in
    # USDT: at ~1,150,000 rial per USDT, 11 USDT is about 12,650,000 rial, far
    # above the rial minimum. Ignoring it would let the simulator "trade" sizes
    # the exchange would reject outright.
    min_order_by_quote: dict[str, float] = field(
        default_factory=lambda: {"IRT": 3_000_000.0, "USDT": 11.0})
    fetch_exchange_limits: bool = True   # refresh the above from GET /v2/options
    poll_interval_sec: float = 3.0
    request_timeout_sec: float = 10.0

    capital_irt: float = 100_000_000
    min_order_irt: float = 3_000_000
    max_order_irt: float = 50_000_000
    min_profit_bps: float = 5.0
    cooldown_sec: float = 15.0

    max_spread_bps: float = 300.0
    min_depth_multiple: float = 2.0
    max_sigma_bps: float = 80.0
    obi_levels: int = 5

    store_book_levels: int = 10
    db_path: str = "data/paper.db"
    log_path: str = "data/run.log"

    @staticmethod
    def load(path: str | Path) -> "Config":
        p = Path(path)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
        raw = json.loads(p.read_text(encoding="utf-8"))
        raw.pop("_comment", None)
        markets = [Market(**m) for m in raw.pop("markets", [])]
        if "min_order_by_quote" in raw:
            raw["min_order_by_quote"] = {
                str(k): float(v) for k, v in dict(raw["min_order_by_quote"]).items()}
        known = {f for f in Config.__dataclass_fields__ if f != "markets"}
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"unknown config keys: {sorted(unknown)}")
        cfg = Config(markets=markets, **raw)
        cfg.validate()
        return cfg

    def validate(self) -> None:
        if not self.markets:
            raise ValueError("config has no markets")
        if not 0 <= self.fee_rate < 0.05:
            raise ValueError(f"implausible fee_rate: {self.fee_rate}")
        if self.min_order_irt <= 0 or self.max_order_irt < self.min_order_irt:
            raise ValueError("bad order size bounds")
        if self.capital_irt < self.min_order_irt:
            raise ValueError("capital is below the minimum order size")
        if self.poll_interval_sec < 1.0:
            raise ValueError("poll_interval_sec below 1s risks hitting the exchange rate limit")
        if self.irt_unit not in ("rial", "toman", "auto"):
            raise ValueError("irt_unit must be rial, toman or auto")
        for quote, minimum in self.min_order_by_quote.items():
            if minimum < 0:
                raise ValueError(f"negative minimum order for {quote}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["markets"] = [asdict(m) for m in self.markets]
        return d
