"""Entry points: /start (including deep links), /language, /help.

Deep links carry the whole growth loop. ``?start=plan_<id>`` drops a buyer
straight into checkout, and ``?start=ref_<code>`` attributes a new owner to
whoever referred them.
"""

from __future__ import annotations

import logging
import secrets

from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import keyboards as kb
from app.config import get_settings
from app.db.models import ManagedChannel, Owner, Subscriber, Subscription, SubscriptionStatus
from app.i18n import normalize, t

router = Router(name="start")
log = logging.getLogger(__name__)


async def _referral_code(session: AsyncSession) -> str:
    for _ in range(20):
        code = secrets.token_urlsafe(6)[:8]
        exists = await session.scalar(select(Owner.id).where(Owner.referral_code == code))
        if not exists:
            return code
    raise RuntimeError("could not allocate a referral code")


async def get_owner(session: AsyncSession, telegram_user_id: int) -> Owner | None:
    return await session.scalar(
        select(Owner).where(Owner.telegram_user_id == telegram_user_id)
    )


async def create_owner(
    session: AsyncSession, *, message: Message, locale: str, referred_by: Owner | None
) -> Owner:
    owner = Owner(
        telegram_user_id=message.from_user.id,
        username=message.from_user.username,
        display_name=message.from_user.full_name,
        locale=locale,
        referral_code=await _referral_code(session),
        referred_by_id=referred_by.id if referred_by else None,
    )
    session.add(owner)
    await session.flush()
    return owner


@router.message(CommandStart(deep_link=True))
async def start_with_payload(
    message: Message, command: CommandObject, session: AsyncSession, locale: str
) -> None:
    payload = (command.args or "").strip()

    if payload.startswith("plan_"):
        from app.bot.handlers.subscriber import open_checkout

        try:
            plan_id = int(payload.removeprefix("plan_"))
        except ValueError:
            await message.answer(t("error.generic", locale))
            return
        await open_checkout(message, session=session, locale=locale, plan_id=plan_id)
        return

    if payload.startswith("ref_"):
        code = payload.removeprefix("ref_")
        referrer = await session.scalar(select(Owner).where(Owner.referral_code == code))
        owner = await get_owner(session, message.from_user.id)
        if owner is None:
            owner = await create_owner(
                session, message=message, locale=locale, referred_by=referrer
            )
        await message.answer(
            t("cmd.start.new", locale, trial_days=get_settings().platform_trial_days)
        )
        return

    await start(message, session, locale)


@router.message(CommandStart())
async def start(message: Message, session: AsyncSession, locale: str) -> None:
    owner = await get_owner(session, message.from_user.id)
    if owner:
        channels = await session.scalar(
            select(func.count())
            .select_from(ManagedChannel)
            .where(ManagedChannel.owner_id == owner.id, ManagedChannel.is_active.is_(True))
        )
        members = await session.scalar(
            select(func.count())
            .select_from(Subscription)
            .join(ManagedChannel, ManagedChannel.id == Subscription.channel_id)
            .where(
                ManagedChannel.owner_id == owner.id,
                Subscription.status.in_(
                    [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE]
                ),
            )
        )
        await message.answer(
            t(
                "cmd.start.owner",
                locale,
                name=owner.display_name or "",
                channels=channels or 0,
                members=members or 0,
            )
        )
        return

    subscriber = await session.scalar(
        select(Subscriber).where(Subscriber.telegram_user_id == message.from_user.id)
    )
    if subscriber:
        await message.answer(t("sub.none", locale))
        return

    await message.answer(
        t("cmd.start.new", locale, trial_days=get_settings().platform_trial_days)
    )


@router.message(F.text.in_({"/language", "/lang"}))
async def language_command(message: Message, locale: str) -> None:
    await message.answer(t("language.pick", locale), reply_markup=kb.language_picker(locale))


@router.callback_query(F.data.startswith("lang:"))
async def set_language(call: CallbackQuery, session: AsyncSession) -> None:
    code = normalize(call.data.split(":", 1)[1])
    user_id = call.from_user.id

    owner = await get_owner(session, user_id)
    if owner:
        owner.locale = code
    subscriber = await session.scalar(
        select(Subscriber).where(Subscriber.telegram_user_id == user_id)
    )
    if subscriber:
        subscriber.locale = code

    await call.message.edit_text(
        t("language.saved", code), reply_markup=kb.language_picker(code)
    )
    await call.answer()


@router.message(F.text == "/help")
async def help_command(message: Message, locale: str) -> None:
    await message.answer(
        t("cmd.start.new", locale, trial_days=get_settings().platform_trial_days)
    )
