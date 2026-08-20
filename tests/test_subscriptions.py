"""The money-critical paths: no double grants, no stolen days."""

from datetime import timedelta

from app.db.models import PaymentStatus, ProviderKind, SubscriptionStatus
from app.services import subscriptions as svc
from tests.factories import make_channel, make_owner, make_plan, make_subscriber


async def _paid_subscription(session, *, plan, subscriber, ref):
    sub = await svc.start_purchase(session, subscriber=subscriber, plan=plan)
    payment = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.STARS,
        provider_ref=ref,
        amount=plan.price_amount,
        currency=plan.currency,
    )
    return sub, payment


async def test_confirming_a_payment_activates_access(session):
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel, days=30)
    subscriber = await make_subscriber(session)

    _sub, payment = await _paid_subscription(session, plan=plan, subscriber=subscriber, ref="p1")
    activated = await svc.confirm_payment(session, payment=payment, actor="test")

    assert activated is not None
    assert activated.status is SubscriptionStatus.ACTIVE
    assert payment.status is PaymentStatus.CONFIRMED
    delta = activated.expires_at - svc.utcnow()
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


async def test_duplicate_provider_reference_is_rejected(session):
    """A replayed webhook must not create a second payment row."""
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel)
    subscriber = await make_subscriber(session)

    sub, first = await _paid_subscription(session, plan=plan, subscriber=subscriber, ref="dup")
    assert first is not None

    replay = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.STARS,
        provider_ref="dup",
        amount=plan.price_amount,
        currency=plan.currency,
    )
    assert replay is None, "the same provider reference was accepted twice"


async def test_confirming_twice_does_not_extend_twice(session):
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel, days=30)
    subscriber = await make_subscriber(session)

    _sub, payment = await _paid_subscription(session, plan=plan, subscriber=subscriber, ref="p2")
    activated = await svc.confirm_payment(session, payment=payment, actor="test")
    first_expiry = activated.expires_at

    again = await svc.confirm_payment(session, payment=payment, actor="test")
    assert again is None
    assert activated.expires_at == first_expiry


async def test_early_renewal_extends_instead_of_resetting(session):
    """Renewing with time left keeps the unused days."""
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel, days=30)
    subscriber = await make_subscriber(session)

    first_sub, first_pay = await _paid_subscription(
        session, plan=plan, subscriber=subscriber, ref="r1"
    )
    await svc.confirm_payment(session, payment=first_pay, actor="test")
    original_expiry = first_sub.expires_at

    _second_sub, second_pay = await _paid_subscription(
        session, plan=plan, subscriber=subscriber, ref="r2"
    )
    renewed = await svc.confirm_payment(session, payment=second_pay, actor="test")

    assert renewed.expires_at == original_expiry + timedelta(days=30)
    assert first_sub.status is SubscriptionStatus.CANCELLED, "member left holding two rows"


async def test_renewal_after_lapse_starts_from_now(session):
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel, days=30)
    subscriber = await make_subscriber(session)

    sub, pay = await _paid_subscription(session, plan=plan, subscriber=subscriber, ref="l1")
    await svc.confirm_payment(session, payment=pay, actor="test")
    # Simulate a subscription that ran out and was removed.
    sub.status = SubscriptionStatus.EXPIRED
    sub.expires_at = svc.utcnow() - timedelta(days=10)
    await session.flush()

    _sub2, pay2 = await _paid_subscription(session, plan=plan, subscriber=subscriber, ref="l2")
    renewed = await svc.confirm_payment(session, payment=pay2, actor="test")

    delta = renewed.expires_at - svc.utcnow()
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


async def test_reminder_sweep_selects_only_upcoming_expiries(session):
    owner = await make_owner(session)
    channel = await make_channel(session, owner)
    plan = await make_plan(session, channel, days=30)

    soon = await make_subscriber(session)
    later = await make_subscriber(session)

    s1, p1 = await _paid_subscription(session, plan=plan, subscriber=soon, ref="s1")
    await svc.confirm_payment(session, payment=p1, actor="test")
    s1.expires_at = svc.utcnow() + timedelta(days=2)

    _s2, p2 = await _paid_subscription(session, plan=plan, subscriber=later, ref="s2")
    await svc.confirm_payment(session, payment=p2, actor="test")
    await session.flush()

    due = await svc.due_for_reminder(session, days_before=3)
    assert [d.id for d in due] == [s1.id]
