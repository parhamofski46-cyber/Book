"""Full lifecycle against real services, real SQL and real sweeps.

Only the Telegram transport is faked. Everything else -- subscription logic,
invite issuing, the hourly sweep, platform billing -- is the shipping code.
"""

from dataclasses import dataclass
from datetime import timedelta

import pytest

from app.db.models import (
    ManagedChannel,
    Owner,
    OwnerStatus,
    PaymentStatus,
    Plan,
    ProviderKind,
    Subscriber,
    SubscriptionStatus,
)
from app.payments import get_provider
from app.scheduler import jobs
from app.services import billing
from app.services import subscriptions as svc
from app.services.membership import issue_invite

OWNER_TG = 500_001
BUYER_TG = 500_002
CHANNEL_CHAT = -100_500_003
ADMIN_TG = 1


@dataclass
class Scenario:
    owner: Owner
    channel: ManagedChannel
    plan: Plan
    buyer: Subscriber


async def _seed(
    session, *, provider=ProviderKind.STARS, currency="XTR", price=150, grace=2
) -> Scenario:
    owner = Owner(
        telegram_user_id=OWNER_TG,
        display_name="Owner",
        locale="fa",
        referral_code="owner01",
        provider=provider,
    )
    session.add(owner)
    await session.flush()

    channel = ManagedChannel(
        owner_id=owner.id,
        telegram_chat_id=CHANNEL_CHAT,
        title="VIP Signals",
        grace_days=grace,
    )
    session.add(channel)
    await session.flush()

    plan = Plan(
        channel_id=channel.id,
        title="Monthly",
        duration_days=30,
        price_amount=price,
        currency=currency,
    )
    session.add(plan)
    await session.flush()

    buyer = Subscriber(telegram_user_id=BUYER_TG, locale="fa")
    session.add(buyer)
    await session.flush()
    await session.commit()
    return Scenario(owner=owner, channel=channel, plan=plan, buyer=buyer)


async def _buy_and_confirm(session, bot, *, plan, buyer, ref):
    sub = await svc.start_purchase(session, subscriber=buyer, plan=plan)
    payment = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.STARS,
        provider_ref=ref,
        amount=plan.price_amount,
        currency=plan.currency,
    )
    confirmed = await svc.confirm_payment(session, payment=payment, actor="telegram")
    link = await issue_invite(
        bot, session, subscription=confirmed, chat_id=CHANNEL_CHAT
    )
    await session.commit()
    return confirmed, link


async def test_full_subscriber_lifecycle(session, bot):
    """Buy, get in, get reminded, lapse, get removed -- through the real sweeps."""
    s = await _seed(session)

    # --- 1. purchase and admission -------------------------------------
    sub, link = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="charge-1")

    assert sub.status is SubscriptionStatus.ACTIVE
    assert link is not None
    invite = bot.invites_created[-1]
    assert invite["chat_id"] == CHANNEL_CHAT
    assert invite["member_limit"] == 1, "invite must be single-use"
    assert invite["expire_date"] > svc.utcnow(), "invite must expire"

    # --- 2. reminder fires once, three days out ------------------------
    sub.expires_at = svc.utcnow() + timedelta(days=2)
    await session.commit()

    reminded = await jobs.send_renewal_reminders(bot)
    assert reminded == 1
    assert "VIP Signals" in bot.texts_to(BUYER_TG)[-1]

    bot.clear()
    assert await jobs.send_renewal_reminders(bot) == 0, "reminder sent twice"

    # --- 3. expiry moves to grace, not removal -------------------------
    sub.expires_at = svc.utcnow() - timedelta(minutes=1)
    await session.commit()

    assert await jobs.move_to_grace(bot) == 1
    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.GRACE
    assert not bot.banned, "member removed during the grace window"

    assert await jobs.remove_lapsed_members(bot) == 0, "removed before grace expired"

    # --- 4. removal once the grace window closes -----------------------
    sub.expires_at = svc.utcnow() - timedelta(days=s.channel.grace_days, minutes=1)
    await session.commit()

    assert await jobs.remove_lapsed_members(bot) == 1
    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.EXPIRED
    assert (CHANNEL_CHAT, BUYER_TG) in bot.banned
    assert (CHANNEL_CHAT, BUYER_TG) in bot.unbanned, "ban was not lifted -- user cannot return"
    assert bot.invites_revoked, "stale invite left usable after removal"


async def test_a_removed_member_can_buy_again(session, bot):
    s = await _seed(session)
    sub, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="c1")

    sub.expires_at = svc.utcnow() - timedelta(days=10)
    sub.status = SubscriptionStatus.GRACE
    await session.commit()
    await jobs.remove_lapsed_members(bot)

    again, link = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="c2")
    assert again.status is SubscriptionStatus.ACTIVE
    assert link is not None
    delta = again.expires_at - svc.utcnow()
    assert timedelta(days=29, hours=23) < delta <= timedelta(days=30)


async def test_sweep_survives_a_blocked_user(session, bot):
    """One unreachable subscriber must not stall the sweep for everyone else."""
    s = await _seed(session)
    sub, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="c1")

    other = Subscriber(telegram_user_id=BUYER_TG + 1, locale="en")
    session.add(other)
    await session.flush()
    sub2, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=other, ref="c2")

    bot.blocked_chats.add(BUYER_TG)
    sub.expires_at = svc.utcnow() + timedelta(days=1)
    sub2.expires_at = svc.utcnow() + timedelta(days=1)
    await session.commit()

    sent = await jobs.send_renewal_reminders(bot)
    assert sent == 1, "the reachable subscriber was not reminded"

    await session.refresh(sub)
    assert sub.reminder_sent_at is not None, "blocked user will be retried every hour"


async def test_full_sweep_runs_in_order(session, bot):
    s = await _seed(session, grace=0)
    sub, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="c1")
    sub.expires_at = svc.utcnow() - timedelta(minutes=1)
    await session.commit()

    result = await jobs.run_all(bot)

    assert result["grace"] == 1
    assert result["removed"] == 1, "zero-day grace should remove within the same sweep"
    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.EXPIRED


async def test_owner_billing_cycle(session, bot):
    """Trial, invoice, admin confirmation, past-due sweep."""
    s = await _seed(session)

    invoice = await billing.open_invoice(session, owner=s.owner, base_amount=5_000_000)
    assert 1_000 <= invoice.unique_suffix <= 9_999
    assert invoice.total_amount == 5_000_000 + invoice.unique_suffix

    updated = await billing.confirm_invoice(session, invoice=invoice, admin_id=ADMIN_TG)
    await session.commit()
    assert updated.status is OwnerStatus.ACTIVE

    s.owner.plan_expires_at = svc.utcnow() - timedelta(days=1)
    await session.commit()

    assert await jobs.mark_owners_past_due(bot) == 1
    await session.refresh(s.owner)
    assert s.owner.status is OwnerStatus.PAST_DUE
    assert bot.texts_to(OWNER_TG), "owner was not told their plan lapsed"


async def test_past_due_owner_does_not_break_existing_members(session, bot):
    """An owner's unpaid bill must not eject subscribers who paid."""
    s = await _seed(session)
    sub, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="c1")

    s.owner.plan_expires_at = svc.utcnow() - timedelta(days=1)
    await session.commit()
    await jobs.run_all(bot)

    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.ACTIVE
    assert not bot.banned


async def test_checkout_renders_in_each_language(session, bot):
    """The buyer-facing checkout must be complete in every shipped language."""
    await _seed(session, provider=ProviderKind.MANUAL_CARD, currency="IRR", price=5_000_000)
    provider = get_provider(ProviderKind.MANUAL_CARD)

    for locale in ("en", "fa", "ar", "tr", "ru"):
        checkout = provider.build_checkout(
            amount=5_001_234,
            currency="IRR",
            title="Monthly",
            locale=locale,
            config={"card_number": "6037-1111", "card_holder": "Someone"},
            reference="ref",
        )
        assert "5,001,234" in checkout.text, f"{locale}: amount missing"
        assert "6037-1111" in checkout.text, f"{locale}: card number missing"
        assert "{" not in checkout.text, f"{locale}: unrendered placeholder"


async def test_replayed_charge_does_not_grant_a_second_period(session, bot):
    """Telegram redelivering a charge must not extend access."""
    s = await _seed(session)
    sub, _ = await _buy_and_confirm(session, bot, plan=s.plan, buyer=s.buyer, ref="charge-x")
    expiry = sub.expires_at
    invites_before = len(bot.invites_created)

    replay = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.STARS,
        provider_ref="charge-x",
        amount=s.plan.price_amount,
        currency=s.plan.currency,
    )
    assert replay is None

    await session.refresh(sub)
    assert sub.expires_at == expiry
    assert len(bot.invites_created) == invites_before, "a second invite was issued"


# --- manually-settled providers (PayPal, card transfer) --------------------


async def test_owner_can_confirm_a_manually_settled_payment(session, bot):
    """A PayPal or card-transfer buyer must be reachable by a confirmation.

    Providers that cannot prove payment themselves depend entirely on someone
    confirming the claim. Without that path the buyer pays and never gets in.
    """
    from app.services.subscriber_payments import confirm_claim, pending_claims_for_owner

    s = await _seed(
        session, provider=ProviderKind.PAYPAL, currency="USD", price=1900
    )

    sub = await svc.start_purchase(session, subscriber=s.buyer, plan=s.plan)
    claim = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.PAYPAL,
        provider_ref=f"claim-{sub.id}",
        amount=s.plan.price_amount,
        currency=s.plan.currency,
        status=PaymentStatus.PENDING,
    )
    await session.commit()

    pending = await pending_claims_for_owner(session, owner_id=s.owner.id)
    assert [p.id for p in pending] == [claim.id], "owner cannot see the claim"

    granted = await confirm_claim(
        bot, session, payment=claim, actor_telegram_id=OWNER_TG, owner_id=s.owner.id
    )
    await session.commit()

    assert granted is not None
    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.ACTIVE
    assert bot.invites_created, "no invite issued after confirmation"
    assert bot.texts_to(BUYER_TG), "buyer never told they were let in"


async def test_confirming_a_claim_twice_grants_one_period(session, bot):
    from app.services.subscriber_payments import confirm_claim

    s = await _seed(
        session, provider=ProviderKind.MANUAL_CARD, currency="IRR", price=5_000_000
    )
    sub = await svc.start_purchase(session, subscriber=s.buyer, plan=s.plan)
    claim = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.MANUAL_CARD,
        provider_ref=f"claim-{sub.id}",
        amount=s.plan.price_amount,
        currency=s.plan.currency,
        status=PaymentStatus.PENDING,
    )
    await session.commit()

    await confirm_claim(
        bot, session, payment=claim, actor_telegram_id=OWNER_TG, owner_id=s.owner.id
    )
    await session.commit()
    await session.refresh(sub)
    expiry = sub.expires_at
    invites = len(bot.invites_created)

    again = await confirm_claim(
        bot, session, payment=claim, actor_telegram_id=OWNER_TG, owner_id=s.owner.id
    )
    await session.commit()

    assert again is None
    await session.refresh(sub)
    assert sub.expires_at == expiry
    assert len(bot.invites_created) == invites, "a second invite was issued"


async def test_another_owner_cannot_confirm_someone_elses_claim(session, bot):
    """Authorisation is checked against the s.channel, not the caller's word."""
    from app.services.subscriber_payments import confirm_claim

    s = await _seed(
        session, provider=ProviderKind.PAYPAL, currency="USD", price=1900
    )
    intruder = Owner(
        telegram_user_id=OWNER_TG + 77, referral_code="intrud1", locale="en"
    )
    session.add(intruder)
    await session.flush()

    sub = await svc.start_purchase(session, subscriber=s.buyer, plan=s.plan)
    claim = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.PAYPAL,
        provider_ref=f"claim-{sub.id}",
        amount=s.plan.price_amount,
        currency=s.plan.currency,
        status=PaymentStatus.PENDING,
    )
    await session.commit()

    with pytest.raises(PermissionError):
        await confirm_claim(
            bot,
            session,
            payment=claim,
            actor_telegram_id=intruder.telegram_user_id,
            owner_id=intruder.id,
        )

    await session.refresh(sub)
    assert sub.status is SubscriptionStatus.PENDING


async def test_buyer_is_notified_in_their_own_language(session, bot):
    """The confirmer's language must not leak into the buyer's message."""
    from app.services.subscriber_payments import confirm_claim

    s = await _seed(
        session, provider=ProviderKind.PAYPAL, currency="USD", price=1900
    )
    s.owner.locale = "fa"
    s.buyer.locale = "ru"
    await session.commit()

    sub = await svc.start_purchase(session, subscriber=s.buyer, plan=s.plan)
    claim = await svc.record_payment(
        session,
        subscription=sub,
        provider=ProviderKind.PAYPAL,
        provider_ref=f"claim-{sub.id}",
        amount=s.plan.price_amount,
        currency=s.plan.currency,
        status=PaymentStatus.PENDING,
    )
    await session.commit()

    await confirm_claim(
        bot, session, payment=claim, actor_telegram_id=OWNER_TG, owner_id=s.owner.id
    )

    buyer_text = bot.texts_to(BUYER_TG)[-1]
    assert "Платёж подтверждён" in buyer_text, f"buyer got the wrong language: {buyer_text!r}"


# --- provider / currency consistency ---------------------------------------


async def test_every_provider_declares_a_settlement_currency():
    from app.payments.base import CURRENCY_FOR

    assert set(CURRENCY_FOR) == set(ProviderKind), "a provider has no declared currency"


async def test_each_provider_accepts_only_its_own_currency():
    from app.payments.base import CURRENCY_FOR, supports_currency

    for kind, currency in CURRENCY_FOR.items():
        assert supports_currency(kind, currency)
        assert supports_currency(kind, currency.lower()), "currency check is case-sensitive"
        wrong = "USD" if currency != "USD" else "IRR"
        assert not supports_currency(kind, wrong)


async def test_a_provider_renders_every_plan_it_accepts(session):
    """Whatever CURRENCY_FOR promises, the provider must actually render."""
    from app.payments.base import CURRENCY_FOR

    for kind, currency in CURRENCY_FOR.items():
        checkout = get_provider(kind).build_checkout(
            amount=1900,
            currency=currency,
            title="Monthly",
            locale="en",
            config={
                "card_number": "6037",
                "card_holder": "X",
                "paypal_account": "a@b.com",
                "authority": "AUTH123",
            },
            reference="ref",
        )
        assert checkout.text, f"{kind.value} rendered nothing"
        assert "{" not in checkout.text, f"{kind.value} left a placeholder unrendered"


async def test_switching_provider_strands_plans_priced_in_the_old_currency(session):
    """The condition the checkout guard exists to catch."""
    from app.payments.base import supports_currency

    s = await _seed(session, provider=ProviderKind.MANUAL_CARD, currency="IRR", price=5_000_000)

    # Owner switches to Stars; the rial plan can no longer be paid.
    s.owner.provider = ProviderKind.STARS
    await session.commit()

    assert not supports_currency(s.owner.provider, s.plan.currency), (
        "a rial plan should not be payable through Stars"
    )

    # And the provider itself would have raised rather than quoting nonsense.
    with pytest.raises(ValueError):
        get_provider(ProviderKind.STARS).build_checkout(
            amount=s.plan.price_amount,
            currency=s.plan.currency,
            title="Monthly",
            locale="fa",
            config={},
            reference="x",
        )
