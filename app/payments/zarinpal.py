"""ZarinPal (Iranian rial gateway).

Two-legged: request an authority, send the payer to StartPay, then verify the
authority server-side when they come back. Verification is what makes the
payment real -- a user landing on the callback URL proves nothing on its own.

Amounts are handled in rial. Owners supply their own merchant id, so the money
moves between the payer and the owner and never through this platform.
"""

from __future__ import annotations

import httpx

from app.db.models import ProviderKind
from app.i18n import t
from app.payments.base import Checkout, PaymentProvider, format_money, register

REQUEST_URL = "https://payment.zarinpal.com/pg/v4/payment/request.json"
VERIFY_URL = "https://payment.zarinpal.com/pg/v4/payment/verify.json"
STARTPAY_URL = "https://payment.zarinpal.com/pg/StartPay/{authority}"

TIMEOUT = httpx.Timeout(15.0)


class ZarinPalError(RuntimeError):
    pass


class ZarinPalProvider(PaymentProvider):
    kind = ProviderKind.ZARINPAL
    auto_confirms = True

    def build_checkout(
        self, *, amount, currency, title, locale, config, reference
    ) -> Checkout:
        # The authority is fetched asynchronously by :func:`create_authority`
        # before this checkout is shown; the caller passes it through config.
        authority = config.get("authority")
        if not authority:
            raise ZarinPalError("authority missing -- call create_authority first")
        return Checkout(
            text=t("checkout.pay", locale, price=format_money(amount, currency, locale)),
            url=STARTPAY_URL.format(authority=authority),
            reference=authority,
        )

    async def create_authority(
        self, *, merchant_id: str, amount: int, description: str, callback_url: str
    ) -> str:
        payload = {
            "merchant_id": merchant_id,
            "amount": amount,
            "description": description[:255],
            "callback_url": callback_url,
        }
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(REQUEST_URL, json=payload)
            resp.raise_for_status()
            body = resp.json()
        data = body.get("data") or {}
        if data.get("code") != 100:
            raise ZarinPalError(f"request failed: {body.get('errors') or data}")
        return data["authority"]

    async def confirm(self, *, merchant_id: str, amount: int, authority: str) -> dict:
        """Server-side verification. Returns the gateway's data block."""
        payload = {"merchant_id": merchant_id, "amount": amount, "authority": authority}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(VERIFY_URL, json=payload)
            resp.raise_for_status()
            body = resp.json()
        data = body.get("data") or {}
        # 100 = verified now, 101 = already verified (a safe replay).
        if data.get("code") not in (100, 101):
            raise ZarinPalError(f"verify failed: {body.get('errors') or data}")
        return data

    def verify(self, *, payload: dict, config: dict) -> bool:
        return payload.get("code") in (100, 101)


register(ZarinPalProvider())
