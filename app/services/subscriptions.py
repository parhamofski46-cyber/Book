"""Subscription lifecycle: purchase, activation, renewal, expiry.

Two rules carry most of the correctness weight here.

*Idempotent activation.* ``(provider, provider_ref)`` is unique in the
database. A replayed webhook or a double-tapped confirm button loses the race
on insert and is treated as a no-op instead of granting a second period.

*Renewal extends, it does not reset.* Someone renewing four days early keeps
those four days -- the new period starts at the current expiry, not at now.
Resetting would quietly charge people for time they had already bought, and it
is the kind of bug that is only noticed after it has happened a hundred times.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AuditLog,
    ManagedChannel,
    Payment,
    PaymentStatus,
    Plan,
    ProviderKind,
    Subscriber,
    Subscription,
    SubscriptionStatus,
)


def utcnow() -> datetime:
    return datetime.now(UTC)


async def audit(
    session: AsyncSession,
    *,
    actor: str,
    action: str,
    entity: str,
    entity_id: int | None = None,
    detail: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor=actor,
            action=action,
            entity=entity,
            entity_id=entity_id,
            detail=json.dumps(detail, ensure_ascii=False) if detail else None,
        )
    )


async def get_or_create_subscriber(
    session: AsyncSession, *, telegram_user_id: int, username: str | None, locale: str
) -> Subscriber:
    row = await session.scalar(
        select(Subscriber).where(Subscriber.telegram_user_id == telegram_user_id)
    )
    if row:
        if username and row.username != username:
            row.username = username
        return row
    row = Subscriber(telegram_user_id=telegram_user_id, username=username, locale=locale)
    session.add(row)
    await session.flush()
    return row


async def active_subscription(
    session: AsyncSession, *, subscriber_id: int, channel_id: int
) -> Subscription | None:
    return await session.scalar(
        select(Subscription)
        .where(
            Subscription.subscriber_id == subscriber_id,
            Subscription.channel_id == channel_id,
            Subscription.status.in_(
                [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE]
            ),
        )
        .order_by(Subscription.expires_at.desc())
        .limit(1)
    )


async def start_purchase(
    session: AsyncSession, *, subscriber: Subscriber, plan: Plan
) -> Subscription:
    """Create the pending subscription a checkout will attach to."""
    sub = Subscription(
        subscriber_id=subscriber.id,
        channel_id=plan.channel_id,
        plan_id=plan.id,
        status=SubscriptionStatus.PENDING,
    )
    session.add(sub)
    await session.flush()
    await audit(
        session,
        actor=f"subscriber:{subscriber.id}",
        action="purchase.started",
        entity="subscription",
        entity_id=sub.id,
        detail={"plan_id": plan.id, "channel_id": plan.channel_id},
    )
    return sub


async def record_payment(
    session: AsyncSession,
    *,
    subscription: Subscription,
    provider: ProviderKind,
    provider_ref: str,
    amount: int,
    currency: str,
    raw_payload: dict | None = None,
    status: PaymentStatus = PaymentStatus.PENDING,
) -> Payment | None:
    """Insert a payment row. Returns None when this reference already exists,
    which is the signal that the caller is handling a duplicate."""
    payment = Payment(
        subscription_id=subscription.id,
        provider=provider,
        provider_ref=provider_ref,
        amount=amount,
        currency=currency,
        status=status,
        raw_payload=json.dumps(raw_payload, ensure_ascii=False) if raw_payload else None,
    )
    session.add(payment)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return None
    return payment


async def confirm_payment(
    session: AsyncSession, *, payment: Payment, actor: str
) -> Subscription | None:
    """Mark a payment confirmed and extend access.

    Returns the subscription on success, or None when the payment was already
    confirmed -- callers should not re-issue an invite in that case.
    """
    if payment.status is PaymentStatus.CONFIRMED:
        return None

    sub = await session.get(Subscription, payment.subscription_id)
    if sub is None:
        return None
    plan = await session.get(Plan, sub.plan_id)
    if plan is None:
        return None

    now = utcnow()
    payment.status = PaymentStatus.CONFIRMED
    payment.confirmed_at = now

    # Extend from the later of "now" and any unused time already paid for.
    prior = await active_subscription(
        session, subscriber_id=sub.subscriber_id, channel_id=sub.channel_id
    )
    base = now
    if prior and prior.id != sub.id and prior.expires_at and prior.expires_at > now:
        base = prior.expires_at
        # Fold the old row into this one so a member never holds two.
        prior.status = SubscriptionStatus.CANCELLED

    sub.starts_at = sub.starts_at or now
    sub.expires_at = base + timedelta(days=plan.duration_days)
    sub.status = SubscriptionStatus.ACTIVE
    sub.reminder_sent_at = None
    sub.removed_at = None

    await audit(
        session,
        actor=actor,
        action="payment.confirmed",
        entity="subscription",
        entity_id=sub.id,
        detail={
            "payment_id": payment.id,
            "provider": payment.provider.value,
            "amount": payment.amount,
            "currency": payment.currency,
            "expires_at": sub.expires_at.isoformat(),
            "extended_from_prior": base is not now,
        },
    )
    return sub


async def due_for_reminder(
    session: AsyncSession, *, days_before: int, limit: int = 200
) -> list[Subscription]:
    cutoff = utcnow() + timedelta(days=days_before)
    return list(
        await session.scalars(
            select(Subscription)
            .where(
                Subscription.status == SubscriptionStatus.ACTIVE,
                Subscription.expires_at <= cutoff,
                Subscription.expires_at > utcnow(),
                Subscription.reminder_sent_at.is_(None),
            )
            .limit(limit)
        )
    )


async def due_for_grace(session: AsyncSession, *, limit: int = 200) -> list[Subscription]:
    """Active subscriptions whose paid period has just run out."""
    return list(
        await session.scalars(
            select(Subscription)
            .where(
                Subscription.status == SubscriptionStatus.ACTIVE,
                Subscription.expires_at <= utcnow(),
            )
            .limit(limit)
        )
    )


async def due_for_removal(session: AsyncSession, *, limit: int = 200) -> list[Subscription]:
    """Lapsed subscriptions whose per-channel grace window has also passed."""
    now = utcnow()
    rows = await session.execute(
        select(Subscription, ManagedChannel.grace_days)
        .join(ManagedChannel, ManagedChannel.id == Subscription.channel_id)
        .where(Subscription.status == SubscriptionStatus.GRACE)
        .limit(limit)
    )
    out: list[Subscription] = []
    for sub, grace_days in rows:
        if sub.expires_at and sub.expires_at + timedelta(days=grace_days) <= now:
            out.append(sub)
    return out


async def channel_stats(session: AsyncSession, *, channel_id: int) -> dict:
    now = utcnow()
    active = await session.scalar(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.channel_id == channel_id,
            Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE]),
        )
    )
    expiring = await session.scalar(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.channel_id == channel_id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            Subscription.expires_at <= now + timedelta(days=7),
            Subscription.expires_at > now,
        )
    )
    revenue = await session.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Subscription, Subscription.id == Payment.subscription_id)
        .where(
            Subscription.channel_id == channel_id,
            Payment.status == PaymentStatus.CONFIRMED,
            Payment.confirmed_at >= now - timedelta(days=30),
        )
    )
    ended = await session.scalar(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.channel_id == channel_id,
            Subscription.status.in_([SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED]),
        )
    )
    renewed = await session.scalar(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.channel_id == channel_id,
            Subscription.status == SubscriptionStatus.CANCELLED,
        )
    )
    total_ended = (ended or 0) + (active or 0)
    rate = round(100 * (renewed or 0) / total_ended) if total_ended else 0
    return {
        "active": active or 0,
        "expiring": expiring or 0,
        "revenue": revenue or 0,
        "renewal_rate": rate,
    }
