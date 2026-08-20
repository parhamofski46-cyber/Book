"""Tiny JSON-backed translator.

Locale is resolved per update: an explicit choice stored on the user wins,
otherwise Telegram's ``language_code``, otherwise English. Missing keys fall
back to English rather than showing a raw key to a paying customer.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

LOCALES_DIR = Path(__file__).parent / "locales"
DEFAULT_LOCALE = "en"

# Languages the bot ships with, in menu order.
SUPPORTED: dict[str, str] = {
    "en": "English",
    "fa": "فارسی",
    "ar": "العربية",
    "tr": "Türkçe",
    "ru": "Русский",
}

RTL_LOCALES = {"fa", "ar"}


@cache
def _catalog(locale: str) -> dict[str, str]:
    path = LOCALES_DIR / f"{locale}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def normalize(locale: str | None) -> str:
    """Map a Telegram language_code such as 'fa-IR' onto a supported locale."""
    if not locale:
        return DEFAULT_LOCALE
    base = locale.split("-")[0].lower()
    return base if base in SUPPORTED else DEFAULT_LOCALE


def t(key: str, locale: str | None = None, /, **kwargs: object) -> str:
    loc = normalize(locale)
    template = _catalog(loc).get(key) or _catalog(DEFAULT_LOCALE).get(key) or key
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        # A malformed placeholder must not take a handler down mid-checkout.
        return template


def is_rtl(locale: str | None) -> bool:
    return normalize(locale) in RTL_LOCALES
