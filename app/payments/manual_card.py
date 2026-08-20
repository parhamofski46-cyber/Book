"""Card-to-card settlement, reconciled by unique amount.

A screenshot proves nothing -- it is trivially edited. Instead every invoice
gets a small random suffix added to its amount, so the exact figure appears
once in the recipient's bank statement and identifies the payer. Confirmation
is then a two-second match against the statement rather than an act of faith.
"""

from __future__ import annotations

import secrets

from app.db.models import ProviderKind
from app.i18n import t
from app.payments.base import Checkout, PaymentProvider, format_money, register

# Range of the disambiguating suffix, in minor units. Wide enough that two
# open invoices colliding is unlikely, small enough to be immaterial.
SUFFIX_MIN = 1_000
SUFFIX_MAX = 9_999


def make_suffix() -> int:
    return secrets.randbelow(SUFFIX_MAX - SUFFIX_MIN + 1) + SUFFIX_MIN


class ManualCardProvider(PaymentProvider):
    kind = ProviderKind.MANUAL_CARD
    auto_confirms = False

    def build_checkout(
        self, *, amount, currency, title, locale, config, reference
    ) -> Checkout:
        card = config.get("card_number", "")
        holder = config.get("card_holder", "")
        return Checkout(
            text=t(
                "checkout.manual_card",
                locale,
                amount=format_money(amount, currency, locale),
                card=card,
                holder=holder,
            ),
            reference=reference,
            needs_claim_button=True,
        )


register(ManualCardProvider())
