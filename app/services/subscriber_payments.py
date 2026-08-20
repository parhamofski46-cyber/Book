"""Confirming payments that no provider can prove.

Telegram Stars settle themselves. PayPal and card transfers do not: the buyer
asserts they paid, and someone has to check. This module is that path, and
without it those providers are a dead end -- the buyer pays and never gets in.

Authorisation is resolved from the channel that the payment's subscription
belongs to, never from what the caller claims to be. Confirmation is idempotent
for the same reason payments are: a second tap must not buy a second month.
"""

from __future__ import annotations

import logging

from aiogram import Bot
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ManagedChannel,
    Payment,
    PaymentStatus,
    Subscriber,
    Subscription,
)
from app.i18n import t
from app.services.membership import issue_invite
from app.services.subscriptions import audit, confirm_payment

log = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"


async def pending_claims_for_owner(
    session: AsyncSession, *, owner_id: int, limit: int = 50
) -> list[Payment]:
    """Unconfirmed claims across every channel this owner runs."""
    return list(
        await session.scalars(
            select(Payment)
            .join(Subscription, Subscription.id == Payment.subscription_id)
            .join(ManagedChannel, ManagedChannel.id == Subscription.channel_id)
            .where(
                ManagedChannel.owner_id == owner_id,
                Payment.status == PaymentStatus.PENDING,
            )
            .order_by(Payment.created_at)
            .limit(limit)
        )
    )


async def _authorise(session: AsyncSession, *, payment: Payment, owner_id: int) -> ManagedChannel:
    subscription = await session.get(Subscription, payment.subscription_id)
    if subscription is None:
        raise PermissionError("payment has no subscription")
    channel = await session.get(ManagedChannel, subscription.channel_id)
    if channel is None or channel.owner_id != owner_id:
        raise PermissionError("payment belongs to another owner's channel")
    return channel


async def confirm_claim(
    bot: Bot,
    session: AsyncSession,
    *,
    payment: Payment,
    actor_telegram_id: int,
    owner_id: int,
) -> Subscription | None:
    """Accept a claimed payment and let the buyer in.

    Returns None when the claim was already settled, so the caller knows not to
    issue a second invite.
    """
    channel = await _authorise(session, payment=payment, owner_id=owner_id)

    subscription = await confirm_payment(
        session, payment=payment, actor=f"owner:{owner_id}"
    )
    if subscription is None:
        return None

    subscriber = await session.get(Subscriber, subscription.subscriber_id)
    link = await issue_invite(
        bot, session, subscription=subscription, chat_id=channel.telegram_chat_id
    )
    if link is None:
        log.error("confirmed payment %s but could not issue an invite", payment.id)
        return subscription

    # The buyer's language, not the confirmer's.
    await _notify(
        bot,
        subscriber.telegram_user_id,
        t(
            "payment.confirmed",
            subscriber.locale,
            channel=channel.title,
            link=link,
            expires=subscription.expires_at.strftime(DATE_FMT),
        ),
    )
    await audit(
        session,
        actor=f"owner:{owner_id}",
        action="claim.confirmed",
        entity="payment",
        entity_id=payment.id,
        detail={"by_telegram_id": actor_telegram_id, "subscription_id": subscription.id},
    )
    return subscription


async def reject_claim(
    bot: Bot,
    session: AsyncSession,
    *,
    payment: Payment,
    actor_telegram_id: int,
    owner_id: int,
) -> bool:
    await _authorise(session, payment=payment, owner_id=owner_id)
    if payment.status is not PaymentStatus.PENDING:
        return False

    payment.status = PaymentStatus.FAILED
    subscription = await session.get(Subscription, payment.subscription_id)
    subscriber = await session.get(Subscriber, subscription.subscriber_id)

    await _notify(bot, subscriber.telegram_user_id, t("payment.failed", subscriber.locale))
    await audit(
        session,
        actor=f"owner:{owner_id}",
        action="claim.rejected",
        entity="payment",
        entity_id=payment.id,
        detail={"by_telegram_id": actor_telegram_id},
    )
    return True


async def _notify(bot: Bot, chat_id: int, text: str) -> None:
    from aiogram.exceptions import TelegramAPIError

    try:
        await bot.send_message(chat_id, text, disable_web_page_preview=True)
    except TelegramAPIError:
        log.warning("could not reach %s", chat_id)
