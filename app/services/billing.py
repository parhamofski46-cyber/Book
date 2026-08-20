"""Platform billing: what channel owners pay for using this product.

Settlement is a card transfer checked against a bank statement, so the amount
itself has to identify the payer. Each open invoice gets a random suffix that
is unique among invoices currently awaiting payment -- two owners can never be
asked for the same figure at the same time, which is what makes "match the
statement line" a reliable confirmation rather than a guess.

This flow is deliberately low-volume. Past roughly a hundred transfers a month
a personal account crosses into business-account territory in Iran, so the
migration path is to add a gateway provider here, not to scale the manual
review.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Owner, OwnerStatus, PaymentStatus, PlatformInvoice
from app.payments.manual_card import make_suffix
from app.services.subscriptions import audit, utcnow

# Volume at which manual reconciliation should give way to a real gateway.
MANUAL_VOLUME_CEILING = 80


async def _unused_suffix(session: AsyncSession, base_amount: int) -> int:
    """Pick a suffix no other pending invoice of the same base is using."""
    taken = set(
        await session.scalars(
            select(PlatformInvoice.unique_suffix).where(
                PlatformInvoice.status == PaymentStatus.PENDING,
                PlatformInvoice.base_amount == base_amount,
            )
        )
    )
    for _ in range(50):
        candidate = make_suffix()
        if candidate not in taken:
            return candidate
    # Every attempt collided, which means an implausible number of open
    # invoices. Fail loudly rather than issue an ambiguous amount.
    raise RuntimeError("could not allocate a unique invoice amount")


async def open_invoice(
    session: AsyncSession,
    *,
    owner: Owner,
    base_amount: int,
    currency: str = "IRR",
    period_days: int = 30,
) -> PlatformInvoice:
    """Reuse the owner's open invoice if there is one, else issue a new one."""
    existing = await session.scalar(
        select(PlatformInvoice).where(
            PlatformInvoice.owner_id == owner.id,
            PlatformInvoice.status == PaymentStatus.PENDING,
        )
    )
    if existing:
        return existing

    invoice = PlatformInvoice(
        owner_id=owner.id,
        base_amount=base_amount,
        unique_suffix=await _unused_suffix(session, base_amount),
        currency=currency,
        period_days=period_days,
    )
    session.add(invoice)
    await session.flush()
    await audit(
        session,
        actor=f"owner:{owner.id}",
        action="invoice.opened",
        entity="platform_invoice",
        entity_id=invoice.id,
        detail={"amount": invoice.total_amount, "currency": currency},
    )
    return invoice


async def confirm_invoice(
    session: AsyncSession, *, invoice: PlatformInvoice, admin_id: int
) -> Owner | None:
    """Accept a transfer and extend the owner's plan.

    Returns None if the invoice was already settled, so a double tap on the
    admin button cannot buy a second month.
    """
    if invoice.status is not PaymentStatus.PENDING:
        return None

    owner = await session.get(Owner, invoice.owner_id)
    if owner is None:
        return None

    now = utcnow()
    invoice.status = PaymentStatus.CONFIRMED
    invoice.paid_at = now
    invoice.confirmed_by = admin_id

    # Extend from unused time rather than from today.
    base = (
        owner.plan_expires_at
        if owner.plan_expires_at and owner.plan_expires_at > now
        else now
    )
    owner.plan_expires_at = base + timedelta(days=invoice.period_days)
    owner.status = OwnerStatus.ACTIVE

    await audit(
        session,
        actor=f"admin:{admin_id}",
        action="invoice.confirmed",
        entity="platform_invoice",
        entity_id=invoice.id,
        detail={
            "owner_id": owner.id,
            "amount": invoice.total_amount,
            "plan_expires_at": owner.plan_expires_at.isoformat(),
        },
    )
    await _credit_referrer(session, owner=owner, invoice=invoice)
    return owner


async def reject_invoice(
    session: AsyncSession, *, invoice: PlatformInvoice, admin_id: int, note: str | None = None
) -> None:
    invoice.status = PaymentStatus.FAILED
    invoice.note = note
    await audit(
        session,
        actor=f"admin:{admin_id}",
        action="invoice.rejected",
        entity="platform_invoice",
        entity_id=invoice.id,
        detail={"note": note},
    )


async def _credit_referrer(
    session: AsyncSession, *, owner: Owner, invoice: PlatformInvoice
) -> None:
    """Reward the referrer once, on the referred owner's first paid invoice."""
    if not owner.referred_by_id:
        return
    paid_count = await session.scalar(
        select(func.count())
        .select_from(PlatformInvoice)
        .where(
            PlatformInvoice.owner_id == owner.id,
            PlatformInvoice.status == PaymentStatus.CONFIRMED,
        )
    )
    if (paid_count or 0) > 1:
        return  # already rewarded on the first one

    referrer = await session.get(Owner, owner.referred_by_id)
    if referrer is None:
        return
    now = utcnow()
    base = (
        referrer.plan_expires_at
        if referrer.plan_expires_at and referrer.plan_expires_at > now
        else now
    )
    referrer.plan_expires_at = base + timedelta(days=invoice.period_days)
    if referrer.status is OwnerStatus.PAST_DUE:
        referrer.status = OwnerStatus.ACTIVE
    await audit(
        session,
        actor="system",
        action="referral.rewarded",
        entity="owner",
        entity_id=referrer.id,
        detail={"referred_owner_id": owner.id, "days": invoice.period_days},
    )


async def manual_volume_this_month(session: AsyncSession) -> int:
    """Confirmed transfers in the last 30 days -- watch this against the ceiling."""
    since = utcnow() - timedelta(days=30)
    return (
        await session.scalar(
            select(func.count())
            .select_from(PlatformInvoice)
            .where(
                PlatformInvoice.status == PaymentStatus.CONFIRMED,
                PlatformInvoice.paid_at >= since,
            )
        )
        or 0
    )
