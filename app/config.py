from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    bot_token: str
    admin_ids: str = ""
    database_url: str = "sqlite+aiosqlite:///./chansub.db"

    platform_card_number: str = ""
    platform_card_holder: str = ""
    platform_monthly_price: int = 5_000_000
    platform_trial_days: int = 14

    # International settlement for owners outside Iran. PayPal is a link plus a
    # manual check here -- no API credentials, no callback endpoint.
    platform_paypal_account: str = ""
    platform_paypal_me: str = ""
    platform_usd_price: int = 1900  # cents, i.e. $19.00

    telegram_proxy: str = ""
    zarinpal_callback_base: str = ""

    # How many days before expiry the renewal reminder goes out.
    reminder_days_before: int = 3

    @property
    def admins(self) -> set[int]:
        return {int(x) for x in self.admin_ids.split(",") if x.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
