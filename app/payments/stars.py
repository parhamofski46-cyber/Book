"""Telegram Stars (XTR).

Telegram signs the result itself: a ``successful_payment`` update only reaches
the bot for a payment Telegram actually took, so no callback verification is
needed. Stars invoices carry an empty provider token and a single price line.

Note for owners outside Telegram's payout coverage: Stars can be collected here
and still be unwithdrawable at the Fragment step. Confirm an end-to-end payout
before relying on this provider for real revenue.
"""

from __future__ import annotations

from app.db.models import ProviderKind
from app.i18n import t
from app.payments.base import Checkout, PaymentProvider, format_money, register


class StarsProvider(PaymentProvider):
    kind = ProviderKind.STARS
    auto_confirms = True

    def build_checkout(
        self, *, amount, currency, title, locale, config, reference
    ) -> Checkout:
        if currency.upper() != "XTR":
            raise ValueError("Stars invoices must be priced in XTR")
        return Checkout(
            text=t("checkout.pay", locale, price=format_money(amount, "XTR", locale)),
            invoice={
                "title": title[:32],
                "description": title[:255],
                "payload": reference,
                "provider_token": "",   # empty is required for Stars
                "currency": "XTR",
                "prices": [{"label": title[:32], "amount": amount}],
            },
            reference=reference,
        )

    def verify(self, *, payload: dict, config: dict) -> bool:
        # payload is Telegram's SuccessfulPayment, already authenticated.
        return payload.get("currency") == "XTR" and payload.get("total_amount", 0) > 0


register(StarsProvider())
