"""Channel access: handing out invites and taking access away.

Invites are single-use and short-lived, so a link forwarded to a friend is
worthless by the time it travels. Removal bans and immediately unbans, which
ejects the member without blacklisting them -- a lapsed subscriber has to be
able to come back and pay again.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InviteLink, Subscription, SubscriptionStatus
from app.services.subscriptions import audit, utcnow

log = logging.getLogger(__name__)

# How long a freshly issued invite stays usable.
INVITE_TTL = timedelta(hours=24)


async def issue_invite(
    bot: Bot, session: AsyncSession, *, subscription: Subscription, chat_id: int
) -> str | None:
    """Create a one-time invite for a confirmed subscription."""
    try:
        link = await bot.create_chat_invite_link(
            chat_id=chat_id,
            member_limit=1,
            expire_date=utcnow() + INVITE_TTL,
            name=f"sub-{subscription.id}",
        )
    except TelegramAPIError:
        log.exception("could not create invite link for chat %s", chat_id)
        return None

    session.add(InviteLink(subscription_id=subscription.id, url=link.invite_link))
    await audit(
        session,
        actor="system",
        action="invite.issued",
        entity="subscription",
        entity_id=subscription.id,
    )
    return link.invite_link


async def revoke_invites(
    bot: Bot, session: AsyncSession, *, subscription_id: int, chat_id: int
) -> None:
    """Kill any invite still outstanding for a subscription."""
    from sqlalchemy import select

    rows = await session.scalars(
        select(InviteLink).where(
            InviteLink.subscription_id == subscription_id,
            InviteLink.revoked_at.is_(None),
        )
    )
    now = utcnow()
    for row in rows:
        try:
            await bot.revoke_chat_invite_link(chat_id=chat_id, invite_link=row.url)
        except TelegramAPIError:
            log.warning("invite %s already gone", row.id)
        row.revoked_at = now


async def remove_member(
    bot: Bot, session: AsyncSession, *, subscription: Subscription, chat_id: int, user_id: int
) -> bool:
    """Eject a lapsed member, leaving them free to rejoin later."""
    try:
        await bot.ban_chat_member(chat_id=chat_id, user_id=user_id)
        await bot.unban_chat_member(chat_id=chat_id, user_id=user_id, only_if_banned=True)
    except TelegramAPIError:
        log.exception("could not remove user %s from chat %s", user_id, chat_id)
        return False

    subscription.status = SubscriptionStatus.EXPIRED
    subscription.removed_at = utcnow()
    await revoke_invites(bot, session, subscription_id=subscription.id, chat_id=chat_id)
    await audit(
        session,
        actor="system",
        action="member.removed",
        entity="subscription",
        entity_id=subscription.id,
        detail={"chat_id": chat_id, "user_id": user_id},
    )
    return True


async def bot_can_manage(bot: Bot, chat_id: int) -> bool:
    """True when the bot holds the two rights this product cannot work without."""
    try:
        me = await bot.get_chat_member(chat_id=chat_id, user_id=(await bot.me()).id)
    except TelegramAPIError:
        return False
    return bool(
        getattr(me, "can_invite_users", False) and getattr(me, "can_restrict_members", False)
    )
