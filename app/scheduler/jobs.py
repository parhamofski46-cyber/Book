"""Background sweeps: remind, lapse, remove.

The three subscriber sweeps run in sequence, once an hour. Each one is
restartable -- a subscription that has already been reminded, lapsed or removed
is not picked up again -- so a crash mid-sweep costs nothing but a retry.

Removal is deliberately the last step and never immediate: a member whose
payment is a day late keeps access through the channel's grace window. Owners
recover a meaningful share of late renewals that way, and nobody is thrown out
over a bank delay.
"""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from sqlalchemy import select

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import (
    ManagedChannel,
    Owner,
    OwnerStatus,
    Subscriber,
    SubscriptionStatus,
)
from app.i18n import t
from app.services import subscriptions as svc
from app.services.membership import remove_member

log = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"


async def _send(bot: Bot, chat_id: int, text: str, **kw) -> bool:
    try:
        await bot.send_message(chat_id, text, **kw)
        return True
    except TelegramAPIError:
        # Blocked bot or deleted account -- not worth failing the sweep over.
        log.info("could not message %s", chat_id)
        return False


async def send_renewal_reminders(bot: Bot) -> int:
    from app.bot import keyboards as kb

    settings = get_settings()
    sent = 0
    async with SessionLocal() as session:
        due = await svc.due_for_reminder(session, days_before=settings.reminder_days_before)
        for sub in due:
            subscriber = await session.get(Subscriber, sub.subscriber_id)
            channel = await session.get(ManagedChannel, sub.channel_id)
            if not subscriber or not channel:
                continue
            days = max(1, (sub.expires_at - svc.utcnow()).days)
            ok = await _send(
                bot,
                subscriber.telegram_user_id,
                t(
                    "sub.reminder",
                    subscriber.locale,
                    channel=channel.title,
                    days=days,
                    expires=sub.expires_at.strftime(DATE_FMT),
                ),
                reply_markup=kb.renew_button(sub.plan_id, subscriber.locale),
            )
            # Mark either way: an unreachable user should not be retried hourly.
            sub.reminder_sent_at = svc.utcnow()
            sent += int(ok)
        await session.commit()
    return sent


async def move_to_grace(bot: Bot) -> int:
    """Paid period is over; hold access open for the channel's grace window."""
    from app.bot import keyboards as kb

    moved = 0
    async with SessionLocal() as session:
        for sub in await svc.due_for_grace(session):
            channel = await session.get(ManagedChannel, sub.channel_id)
            subscriber = await session.get(Subscriber, sub.subscriber_id)
            if not channel or not subscriber:
                continue

            sub.status = SubscriptionStatus.GRACE
            moved += 1
            if channel.grace_days > 0:
                await _send(
                    bot,
                    subscriber.telegram_user_id,
                    t(
                        "sub.grace",
                        subscriber.locale,
                        channel=channel.title,
                        days=channel.grace_days,
                    ),
                    reply_markup=kb.renew_button(sub.plan_id, subscriber.locale),
                )
            await svc.audit(
                session,
                actor="system",
                action="subscription.grace",
                entity="subscription",
                entity_id=sub.id,
            )
        await session.commit()
    return moved


async def remove_lapsed_members(bot: Bot) -> int:
    from app.bot import keyboards as kb

    removed = 0
    async with SessionLocal() as session:
        for sub in await svc.due_for_removal(session):
            channel = await session.get(ManagedChannel, sub.channel_id)
            subscriber = await session.get(Subscriber, sub.subscriber_id)
            if not channel or not subscriber:
                continue

            ok = await remove_member(
                bot,
                session,
                subscription=sub,
                chat_id=channel.telegram_chat_id,
                user_id=subscriber.telegram_user_id,
            )
            if ok:
                removed += 1
                await _send(
                    bot,
                    subscriber.telegram_user_id,
                    t("sub.expired", subscriber.locale, channel=channel.title),
                    reply_markup=kb.renew_button(sub.plan_id, subscriber.locale),
                )
        await session.commit()
    return removed


async def mark_owners_past_due(bot: Bot) -> int:
    """Owners whose own plan lapsed. Their channels keep running; new signups
    are what stops, so existing members are never punished for an owner's bill."""
    marked = 0
    now = svc.utcnow()
    async with SessionLocal() as session:
        owners = await session.scalars(
            select(Owner).where(
                Owner.status.in_([OwnerStatus.ACTIVE, OwnerStatus.TRIAL]),
                Owner.plan_expires_at.is_not(None),
                Owner.plan_expires_at <= now,
            )
        )
        for owner in owners:
            owner.status = OwnerStatus.PAST_DUE
            marked += 1
            await _send(
                bot,
                owner.telegram_user_id,
                t(
                    "billing.past_due",
                    owner.locale,
                    expires=owner.plan_expires_at.strftime(DATE_FMT),
                ),
            )
        await session.commit()
    return marked


async def run_all(bot: Bot) -> dict[str, int]:
    """One full pass. Order matters: remind before lapsing, lapse before removing."""
    result = {
        "reminded": await send_renewal_reminders(bot),
        "grace": await move_to_grace(bot),
        "removed": await remove_lapsed_members(bot),
        "past_due": await mark_owners_past_due(bot),
    }
    if any(result.values()):
        log.info("sweep: %s", result)
    return result
