"""Runtime configuration, loaded once from the environment."""
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _ints(raw: str) -> list[int]:
    return [int(p) for p in raw.replace(",", " ").split() if p.strip().lstrip("-").isdigit()]


@dataclass(frozen=True)
class Config:
    bot_token: str = os.getenv("BOT_TOKEN", "")
    bot_username: str = os.getenv("BOT_USERNAME", "").lstrip("@")
    admin_ids: list[int] = field(default_factory=lambda: _ints(os.getenv("ADMIN_IDS", "")))

    trc20_address: str = os.getenv("TRC20_ADDRESS", "").strip()
    trongrid_api_key: str = os.getenv("TRONGRID_API_KEY", "").strip()
    ton_address: str = os.getenv("TON_ADDRESS", "").strip()
    toncenter_api_key: str = os.getenv("TONCENTER_API_KEY", "").strip()

    price_month: float = float(os.getenv("PRICE_MONTH", "5"))
    price_quarter: float = float(os.getenv("PRICE_QUARTER", "12"))
    price_year: float = float(os.getenv("PRICE_YEAR", "39"))

    digest_channel: str = os.getenv("DIGEST_CHANNEL", "").strip()
    free_scans_per_day: int = int(os.getenv("FREE_SCANS_PER_DAY", "5"))
    referrals_for_free_week: int = int(os.getenv("REFERRALS_FOR_FREE_WEEK", "3"))

    db_path: str = os.getenv("DB_PATH", "data/bot.db")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")

    # Plan catalogue: code -> (label, days, price attribute)
    @property
    def plans(self) -> dict[str, tuple[str, int, float]]:
        return {
            "month": ("1 Month", 30, self.price_month),
            "quarter": ("3 Months", 92, self.price_quarter),
            "year": ("12 Months", 365, self.price_year),
        }


cfg = Config()
