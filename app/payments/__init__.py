"""Payment providers.

Importing this package registers every built-in provider. Registration used to
depend on each consumer remembering to import the provider modules, which meant
the registry could look empty depending on the import path taken. Doing it here
makes ``get_provider`` reliable for anything that touches the package at all.
"""

from app.payments import manual_card, paypal, stars, zarinpal  # noqa: F401
from app.payments.base import Checkout, PaymentProvider, available, format_money, get_provider

__all__ = [
    "Checkout",
    "PaymentProvider",
    "available",
    "format_money",
    "get_provider",
]
