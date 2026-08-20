"""Inline keyboards. Every label goes through the translator."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.db.models import Plan, ProviderKind
from app.i18n import SUPPORTED, t
from app.payments.base import format_money


def language_picker(current: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for code, label in SUPPORTED.items():
        mark = "✅ " if code == current else ""
        kb.button(text=f"{mark}{label}", callback_data=f"lang:{code}")
    kb.adjust(2)
    return kb.as_markup()


def plan_list(plans: list[Plan], locale: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for plan in plans:
        label = t(
            "plan.item",
            locale,
            title=plan.title,
            price=format_money(plan.price_amount, plan.currency, locale),
            days=plan.duration_days,
        )
        kb.button(text=label, callback_data=f"buy:{plan.id}")
    kb.adjust(1)
    return kb.as_markup()


def checkout_actions(
    subscription_id: int, locale: str, *, url: str | None, needs_claim: bool
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    if url:
        kb.button(text=t("checkout.pay", locale, price=""), url=url)
    if needs_claim:
        kb.button(
            text=t("checkout.paid_button", locale),
            callback_data=f"claim:{subscription_id}",
        )
    kb.adjust(1)
    return kb.as_markup()


def renew_button(plan_id: int, locale: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=t("sub.renew", locale), callback_data=f"buy:{plan_id}")]
        ]
    )


def provider_picker(locale: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    labels = {
        ProviderKind.STARS: "⭐ Telegram Stars",
        ProviderKind.ZARINPAL: "🇮🇷 ZarinPal",
        ProviderKind.PAYPAL: "🅿️ PayPal",
        ProviderKind.MANUAL_CARD: "💳 Card transfer",
    }
    for kind, label in labels.items():
        kb.button(text=label, callback_data=f"provider:{kind.value}")
    kb.adjust(1)
    return kb.as_markup()


def invoice_review(invoice_id: int, locale: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=t("admin.invoice.confirm", locale), callback_data=f"inv_ok:{invoice_id}"
                ),
                InlineKeyboardButton(
                    text=t("admin.invoice.reject", locale), callback_data=f"inv_no:{invoice_id}"
                ),
            ]
        ]
    )


def pay_invoice_button(locale: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=t("checkout.paid_button", locale), callback_data="inv_claim"
                )
            ]
        ]
    )


def claim_review(payment_id: int, locale: str) -> InlineKeyboardMarkup:
    """Owner-facing confirm/reject for a manually settled payment."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=t("admin.invoice.confirm", locale),
                    callback_data=f"subpay_ok:{payment_id}",
                ),
                InlineKeyboardButton(
                    text=t("admin.invoice.reject", locale),
                    callback_data=f"subpay_no:{payment_id}",
                ),
            ]
        ]
    )
