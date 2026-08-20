"""The owner's side: connect a channel, price it, watch it, pay for it."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import keyboards as kb
from app.bot.handlers.start import create_owner, get_owner
from app.config import get_settings
from app.db.models import (
    ManagedChannel,
    Owner,
    OwnerStatus,
    PaymentStatus,
    Plan,
    PlatformInvoice,
    ProviderKind,
)
from app.i18n import t
from app.payments.base import format_money
from app.services import billing
from app.services.membership import bot_can_manage
from app.services.subscriptions import audit, channel_stats

router = Router(name="owner")
log = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"


class AddPlan(StatesGroup):
    title = State()
    days = State()
    price = State()


async def _require_owner(message: Message, session: AsyncSession, locale: str) -> Owner | None:
    owner = await get_owner(session, message.from_user.id)
    if owner is None:
        owner = await create_owner(session, message=message, locale=locale, referred_by=None)
    return owner


@router.message(Command("setup"))
async def setup_intro(message: Message, session: AsyncSession, locale: str) -> None:
    await _require_owner(message, session, locale)
    await message.answer(t("owner.setup.intro", locale))


@router.message(F.forward_from_chat)
async def connect_channel(message: Message, session: AsyncSession, locale: str) -> None:
    """A forwarded post identifies the channel the owner wants managed."""
    owner = await _require_owner(message, session, locale)
    chat = message.forward_from_chat

    if not await bot_can_manage(message.bot, chat.id):
        await message.answer(t("owner.setup.not_admin", locale))
        return

    existing = await session.scalar(
        select(ManagedChannel).where(ManagedChannel.telegram_chat_id == chat.id)
    )
    if existing:
        existing.owner_id = owner.id
        existing.title = chat.title
        existing.is_active = True
        channel = existing
    else:
        channel = ManagedChannel(
            owner_id=owner.id, telegram_chat_id=chat.id, title=chat.title
        )
        session.add(channel)
        await session.flush()

    await audit(
        session,
        actor=f"owner:{owner.id}",
        action="channel.connected",
        entity="channel",
        entity_id=channel.id,
        detail={"chat_id": chat.id},
    )
    await message.answer(t("owner.setup.done", locale, channel=chat.title))


@router.message(Command("addplan"))
async def add_plan_start(
    message: Message, session: AsyncSession, locale: str, state: FSMContext
) -> None:
    owner = await _require_owner(message, session, locale)
    channel = await session.scalar(
        select(ManagedChannel)
        .where(ManagedChannel.owner_id == owner.id, ManagedChannel.is_active.is_(True))
        .order_by(ManagedChannel.id.desc())
    )
    if channel is None:
        await message.answer(t("owner.setup.intro", locale))
        return
    await state.update_data(channel_id=channel.id)
    await state.set_state(AddPlan.title)
    await message.answer(t("owner.plan.ask_title", locale))


@router.message(AddPlan.title)
async def add_plan_title(message: Message, locale: str, state: FSMContext) -> None:
    await state.update_data(title=(message.text or "").strip()[:128])
    await state.set_state(AddPlan.days)
    await message.answer(t("owner.plan.ask_days", locale))


@router.message(AddPlan.days)
async def add_plan_days(message: Message, locale: str, state: FSMContext) -> None:
    try:
        days = int((message.text or "").strip())
    except ValueError:
        await message.answer(t("owner.plan.ask_days", locale))
        return
    if not 1 <= days <= 3650:
        await message.answer(t("owner.plan.ask_days", locale))
        return
    await state.update_data(days=days)
    await state.set_state(AddPlan.price)
    await message.answer(t("owner.plan.ask_price", locale))


@router.message(AddPlan.price)
async def add_plan_price(
    message: Message, session: AsyncSession, locale: str, state: FSMContext
) -> None:
    raw = (message.text or "").strip().replace(",", "").replace("٬", "")
    try:
        price = int(raw)
    except ValueError:
        await message.answer(t("owner.plan.ask_price", locale))
        return
    if price <= 0:
        await message.answer(t("owner.plan.ask_price", locale))
        return

    data = await state.get_data()
    await state.clear()

    owner = await get_owner(session, message.from_user.id)
    currency = {
        ProviderKind.STARS: "XTR",
        ProviderKind.ZARINPAL: "IRR",
        ProviderKind.MANUAL_CARD: "IRR",
        ProviderKind.PAYPAL: "USD",
    }[owner.provider]

    plan = Plan(
        channel_id=data["channel_id"],
        title=data["title"],
        duration_days=data["days"],
        price_amount=price,
        currency=currency,
    )
    session.add(plan)
    await session.flush()

    me = await message.bot.me()
    link = f"https://t.me/{me.username}?start=plan_{plan.id}"
    await message.answer(
        t("owner.plan.created", locale, title=plan.title, link=link),
        disable_web_page_preview=True,
    )


@router.message(Command("channels"))
async def list_channels(message: Message, session: AsyncSession, locale: str) -> None:
    owner = await _require_owner(message, session, locale)
    channels = list(
        await session.scalars(
            select(ManagedChannel).where(
                ManagedChannel.owner_id == owner.id, ManagedChannel.is_active.is_(True)
            )
        )
    )
    if not channels:
        await message.answer(t("owner.setup.intro", locale))
        return

    for channel in channels:
        stats = await channel_stats(session, channel_id=channel.id)
        plan = await session.scalar(
            select(Plan).where(Plan.channel_id == channel.id, Plan.is_active.is_(True))
        )
        currency = plan.currency if plan else "IRR"
        await message.answer(
            t(
                "owner.stats",
                locale,
                channel=channel.title,
                active=stats["active"],
                expiring=stats["expiring"],
                revenue=format_money(stats["revenue"], currency, locale),
                renewal_rate=stats["renewal_rate"],
            )
        )


@router.message(Command("provider"))
async def pick_provider(message: Message, session: AsyncSession, locale: str) -> None:
    await _require_owner(message, session, locale)
    await message.answer(
        t("owner.provider.pick", locale), reply_markup=kb.provider_picker(locale)
    )


@router.callback_query(F.data.startswith("provider:"))
async def save_provider(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    kind = ProviderKind(call.data.split(":", 1)[1])
    owner = await get_owner(session, call.from_user.id)
    if owner is None:
        await call.answer(t("error.not_owner", locale), show_alert=True)
        return
    owner.provider = kind
    await call.message.edit_text(t("owner.provider.saved", locale, provider=kind.value))
    await call.answer()


@router.message(Command("billing"))
async def show_billing(message: Message, session: AsyncSession, locale: str) -> None:
    settings = get_settings()
    owner = await _require_owner(message, session, locale)

    if owner.status is OwnerStatus.TRIAL and owner.plan_expires_at is None:
        from datetime import timedelta

        from app.services.subscriptions import utcnow

        owner.plan_expires_at = utcnow() + timedelta(days=settings.platform_trial_days)
        await message.answer(
            t("billing.trial", locale, expires=owner.plan_expires_at.strftime(DATE_FMT))
        )
        return

    await message.answer(
        t(
            "billing.status",
            locale,
            status=owner.status.value,
            expires=owner.plan_expires_at.strftime(DATE_FMT)
            if owner.plan_expires_at
            else "-",
        )
    )

    invoice = await billing.open_invoice(
        session, owner=owner, base_amount=settings.platform_monthly_price
    )
    await message.answer(
        t(
            "billing.invoice",
            locale,
            days=invoice.period_days,
            amount=format_money(invoice.total_amount, invoice.currency, locale),
            card=settings.platform_card_number,
            holder=settings.platform_card_holder,
        ),
        reply_markup=kb.pay_invoice_button(locale),
    )


@router.callback_query(F.data == "inv_claim")
async def claim_invoice(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    """Owner says they transferred. Admins see it in /admin."""
    owner = await get_owner(session, call.from_user.id)
    if owner is None:
        await call.answer(t("error.not_owner", locale), show_alert=True)
        return

    invoice = await session.scalar(
        select(PlatformInvoice).where(
            PlatformInvoice.owner_id == owner.id,
            PlatformInvoice.status == PaymentStatus.PENDING,
        )
    )
    await call.message.edit_text(t("checkout.awaiting", locale))
    await call.answer()

    if invoice is None:
        return
    settings = get_settings()
    for admin_id in settings.admins:
        try:
            await call.bot.send_message(
                admin_id,
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
        except TelegramAPIError:
            log.warning("could not reach admin %s", admin_id)


@router.message(Command("referral"))
async def referral(message: Message, session: AsyncSession, locale: str) -> None:
    owner = await _require_owner(message, session, locale)
    me = await message.bot.me()
    count = await session.scalar(
        select(func.count()).select_from(Owner).where(Owner.referred_by_id == owner.id)
    )
    await message.answer(
        t(
            "referral.info",
            locale,
            link=f"https://t.me/{me.username}?start=ref_{owner.referral_code}",
            reward="30 days",
            count=count or 0,
        ),
        disable_web_page_preview=True,
    )
