"""PayPal settlement via a PayPal.me link, confirmed by hand.

This is deliberately the link-and-review flow rather than a REST integration:
it needs no API credentials and no callback endpoint, which keeps the bot
deployable anywhere. The trade-off is that a human confirms each payment, so
it suits low volume. Swapping in the Orders API later means implementing
``verify`` and flipping ``auto_confirms`` -- nothing else in the app changes.
"""

from __future__ import annotations

from app.db.models import ProviderKind
from app.i18n import t
from app.payments.base import Checkout, PaymentProvider, format_money, register


def paypal_me_url(handle: str, amount: int, currency: str) -> str | None:
    """Build a prefilled PayPal.me URL.

    Only works for a PayPal.me handle. When the config holds a bare email
    address there is no link form, so the buyer is shown the address instead.
    """
    if not handle or "@" in handle:
        return None
    handle = handle.rstrip("/").rsplit("/", 1)[-1]
    major = amount if currency.upper() in {"IRR", "JPY", "KRW"} else amount / 100
    return f"https://paypal.me/{handle}/{major:g}{currency.upper()}"


class PayPalProvider(PaymentProvider):
    kind = ProviderKind.PAYPAL
    auto_confirms = False

    def build_checkout(
        self, *, amount, currency, title, locale, config, reference
    ) -> Checkout:
        account = config.get("paypal_account", "")
        url = paypal_me_url(config.get("paypal_me", ""), amount, currency)
        return Checkout(
            text=t(
                "checkout.paypal",
                locale,
                price=format_money(amount, currency, locale),
                paypal=account,
                link=url or "",
            ),
            url=url,
            reference=reference,
            needs_claim_button=True,
        )


register(PayPalProvider())
