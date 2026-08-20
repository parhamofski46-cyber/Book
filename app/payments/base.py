"""Payment provider abstraction.

Every provider answers two questions: how does a buyer pay, and how do we know
they did. Providers that can prove payment on their own (Stars, ZarinPal)
report ``auto_confirms = True``; the rest queue a review for a human.

Keeping this behind one interface is what lets the same product run on Telegram
Stars, an Iranian rial gateway, or a plain card transfer without the
subscription logic knowing the difference.
"""

from __future__ import annotations

import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.db.models import ProviderKind

# Currencies whose smallest unit is the unit itself (no cents).
ZERO_DECIMAL = {"IRR", "XTR", "JPY", "KRW"}

_SYMBOLS = {"USD": "$", "EUR": "€", "XTR": "⭐"}
_NAMES = {"IRR": {"en": "IRR", "fa": "ریال"}}


def format_money(amount: int, currency: str, locale: str = "en") -> str:
    """Render a minor-unit amount for display."""
    currency = currency.upper()
    if currency in ZERO_DECIMAL:
        body = f"{amount:,}"
    else:
        body = f"{amount / 100:,.2f}"

    if currency == "XTR":
        return f"{body} ⭐"
    if symbol := _SYMBOLS.get(currency):
        return f"{symbol}{body}"
    name = _NAMES.get(currency, {}).get(locale, currency)
    return f"{body} {name}"


@dataclass(slots=True)
class Checkout:
    """What the buyer is shown, and how the result comes back."""

    # Message body already rendered in the buyer's language.
    text: str
    # Set for providers that hand Telegram a native invoice (Stars).
    invoice: dict | None = None
    # Set for providers that send the buyer to a URL (ZarinPal, PayPal).
    url: str | None = None
    # Our own reference; also the idempotency key for manual providers.
    reference: str = field(default_factory=lambda: secrets.token_hex(8))
    # True when the buyer has to tell us they paid.
    needs_claim_button: bool = False


class PaymentProvider(ABC):
    kind: ProviderKind
    auto_confirms: bool

    @abstractmethod
    def build_checkout(
        self,
        *,
        amount: int,
        currency: str,
        title: str,
        locale: str,
        config: dict,
        reference: str,
    ) -> Checkout:
        """Produce the buyer-facing payment step."""

    def verify(self, *, payload: dict, config: dict) -> bool:
        """Confirm a callback really represents a completed payment.

        Manual providers never reach this; a human confirms instead.
        """
        raise NotImplementedError


_REGISTRY: dict[ProviderKind, PaymentProvider] = {}


def register(provider: PaymentProvider) -> PaymentProvider:
    _REGISTRY[provider.kind] = provider
    return provider


def get_provider(kind: ProviderKind) -> PaymentProvider:
    if kind not in _REGISTRY:
        raise KeyError(f"No provider registered for {kind}")
    return _REGISTRY[kind]


def available() -> list[ProviderKind]:
    return list(_REGISTRY)
