"""Platform billing: unique amounts, no double credit, referral payout."""

from datetime import timedelta

from app.db.models import OwnerStatus, PaymentStatus
from app.services import billing
from app.services.subscriptions import utcnow
from tests.factories import make_owner

BASE = 5_000_000


async def test_invoice_amount_is_unique_among_open_invoices(session):
    amounts = set()
    for _ in range(25):
        owner = await make_owner(session)
        inv = await billing.open_invoice(session, owner=owner, base_amount=BASE)
        assert inv.total_amount not in amounts, "two owners asked for the same amount"
        amounts.add(inv.total_amount)


async def test_reopening_returns_the_same_open_invoice(session):
    owner = await make_owner(session)
    first = await billing.open_invoice(session, owner=owner, base_amount=BASE)
    second = await billing.open_invoice(session, owner=owner, base_amount=BASE)
    assert first.id == second.id, "a second invoice was issued while one was open"


async def test_confirming_an_invoice_activates_the_owner(session):
    owner = await make_owner(session, status=OwnerStatus.TRIAL)
    inv = await billing.open_invoice(session, owner=owner, base_amount=BASE, period_days=30)

    updated = await billing.confirm_invoice(session, invoice=inv, admin_id=1)

    assert updated.status is OwnerStatus.ACTIVE
    assert inv.status is PaymentStatus.CONFIRMED
    assert inv.confirmed_by == 1
    delta = updated.plan_expires_at - utcnow()
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


async def test_confirming_twice_does_not_grant_two_months(session):
    owner = await make_owner(session)
    inv = await billing.open_invoice(session, owner=owner, base_amount=BASE)
    await billing.confirm_invoice(session, invoice=inv, admin_id=1)
    expiry = owner.plan_expires_at

    again = await billing.confirm_invoice(session, invoice=inv, admin_id=1)

    assert again is None
    assert owner.plan_expires_at == expiry


async def test_early_renewal_extends_the_owner_plan(session):
    owner = await make_owner(session)
    first = await billing.open_invoice(session, owner=owner, base_amount=BASE)
    await billing.confirm_invoice(session, invoice=first, admin_id=1)
    original = owner.plan_expires_at

    second = await billing.open_invoice(session, owner=owner, base_amount=BASE)
    await billing.confirm_invoice(session, invoice=second, admin_id=1)

    assert owner.plan_expires_at == original + timedelta(days=30)


async def test_referrer_is_credited_once(session):
    referrer = await make_owner(session)
    invited = await make_owner(session, referred_by_id=referrer.id)

    first = await billing.open_invoice(session, owner=invited, base_amount=BASE)
    await billing.confirm_invoice(session, invoice=first, admin_id=1)
    after_first = referrer.plan_expires_at
    assert after_first is not None, "referrer was not rewarded"

    second = await billing.open_invoice(session, owner=invited, base_amount=BASE)
    await billing.confirm_invoice(session, invoice=second, admin_id=1)

    assert referrer.plan_expires_at == after_first, "referrer rewarded twice"


async def test_rejecting_an_invoice_leaves_the_owner_unchanged(session):
    owner = await make_owner(session, status=OwnerStatus.TRIAL)
    inv = await billing.open_invoice(session, owner=owner, base_amount=BASE)

    await billing.reject_invoice(session, invoice=inv, admin_id=1, note="not found")

    assert inv.status is PaymentStatus.FAILED
    assert owner.status is OwnerStatus.TRIAL
    assert owner.plan_expires_at is None
