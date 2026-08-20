"""Operator panel -- the platform owner's own controls, inside Telegram.

Access is restricted to the Telegram ids in ADMIN_IDS. Everything that moves
money here is idempotent at the service layer, so a double tap is harmless.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import keyboards as kb
from app.config import get_settings
from app.db.models import (
    ManagedChannel,
    Owner,
    OwnerStatus,
    PaymentStatus,
    PlatformInvoice,
    Subscription,
    SubscriptionStatus,
)
from app.i18n import t
from app.payments.base import format_money
from app.services import billing

router = Router(name="admin")
log = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"


def is_admin(user_id: int) -> bool:
    return user_id in get_settings().admins


@router.message(Command("admin"))
async def panel(message: Message, session: AsyncSession, locale: str) -> None:
    if not is_admin(message.from_user.id):
        await message.answer(t("error.not_admin", locale))
        return

    async def count(model, *where):
        return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0

    owners = await count(Owner)
    trial = await count(Owner, Owner.status == OwnerStatus.TRIAL)
    active = await count(Owner, Owner.status == OwnerStatus.ACTIVE)
    past_due = await count(Owner, Owner.status == OwnerStatus.PAST_DUE)
    channels = await count(ManagedChannel, ManagedChannel.is_active.is_(True))
    subs = await count(
        Subscription,
        Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE]),
    )
    pending = await count(PlatformInvoice, PlatformInvoice.status == PaymentStatus.PENDING)

    volume = await billing.manual_volume_this_month(session)
    warning = ""
    if volume >= billing.MANUAL_VOLUME_CEILING:
        warning = (
            f"\n\n⚠️ {volume} manual transfers in the last 30 days. "
            "Past ~100 a month a personal account is treated as a business "
            "account — time to move billing onto a gateway."
        )

    await message.answer(
        t(
            "admin.panel",
            locale,
            owners=owners,
            trial=trial,
            active=active,
            past_due=past_due,
            channels=channels,
            subs=subs,
            pending=pending,
        )
        + warning
    )


@router.message(Command("invoices"))
async def pending_invoices(message: Message, session: AsyncSession, locale: str) -> None:
    if not is_admin(message.from_user.id):
        await message.answer(t("error.not_admin", locale))
        return

    rows = list(
        await session.scalars(
            select(PlatformInvoice)
            .where(PlatformInvoice.status == PaymentStatus.PENDING)
            .order_by(PlatformInvoice.created_at)
            .limit(20)
        )
    )
    if not rows:
        await message.answer(t("admin.no_pending", locale))
        return

    for invoice in rows:
        owner = await session.get(Owner, invoice.owner_id)
        await message.answer(
            t(
                "admin.invoice.item",
                locale,
                id=invoice.id,
                owner=owner.display_name or owner.telegram_user_id,
                amount=format_money(invoice.total_amount, invoice.currency, locale),
                created=invoice.created_at.strftime(DATE_FMT),
            ),
            reply_markup=kb.invoice_review(invoice.id, locale),
        )


@router.callback_query(F.data.startswith("inv_ok:"))
async def confirm(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    if not is_admin(call.from_user.id):
        await call.answer(t("error.not_admin", locale), show_alert=True)
        return

    invoice_id = int(call.data.split(":", 1)[1])
    invoice = await session.get(PlatformInvoice, invoice_id)
    if invoice is None:
        await call.answer(t("error.generic", locale), show_alert=True)
        return

    owner = await billing.confirm_invoice(
        session, invoice=invoice, admin_id=call.from_user.id
    )
    if owner is None:
        # Already settled -- most likely a second tap on the same message.
        await call.answer("already handled")
        return

    await call.message.edit_text(
        t(
            "admin.invoice.confirmed",
            locale,
            id=invoice.id,
            owner=owner.display_name or owner.telegram_user_id,
            expires=owner.plan_expires_at.strftime(DATE_FMT),
        )
    )
    try:
        await call.bot.send_message(
            owner.telegram_user_id,
            t(
                "billing.status",
                owner.locale,
                status=owner.status.value,
                expires=owner.plan_expires_at.strftime(DATE_FMT),
            ),
        )
    except TelegramAPIError:
        log.warning("could not notify owner %s", owner.id)
    await call.answer()


@router.callback_query(F.data.startswith("inv_no:"))
async def reject(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    if not is_admin(call.from_user.id):
        await call.answer(t("error.not_admin", locale), show_alert=True)
        return

    invoice_id = int(call.data.split(":", 1)[1])
    invoice = await session.get(PlatformInvoice, invoice_id)
    if invoice is None or invoice.status is not PaymentStatus.PENDING:
        await call.answer("already handled")
        return

    await billing.reject_invoice(session, invoice=invoice, admin_id=call.from_user.id)
    await call.message.edit_text(t("admin.invoice.rejected", locale, id=invoice.id))
    await call.answer()
