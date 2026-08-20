"""The buyer's path: see a plan, pay, get let in.

Providers that prove payment themselves (Stars) land in
``on_successful_payment``. The rest raise a claim that an owner or admin
reviews. Both funnel into :func:`grant_access`, so access is granted in exactly
one place no matter how the money arrived.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.types import CallbackQuery, LabeledPrice, Message, PreCheckoutQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import keyboards as kb
from app.db.models import (
    ManagedChannel,
    Owner,
    Payment,
    PaymentStatus,
    Plan,
    ProviderKind,
    Subscriber,
    Subscription,
)
from app.i18n import t
from app.payments.base import format_money, get_provider, supports_currency
from app.services import subscriptions as svc
from app.services.membership import issue_invite
from app.services.owner_config import provider_config_for

router = Router(name="subscriber")
log = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"


async def open_checkout(
    message: Message, *, session: AsyncSession, locale: str, plan_id: int
) -> None:
    plan = await session.get(Plan, plan_id)
    if plan is None or not plan.is_active:
        await message.answer(t("plan.none", locale))
        return

    channel = await session.get(ManagedChannel, plan.channel_id)
    owner = await session.get(Owner, channel.owner_id)

    # An owner can switch payment provider after pricing their plans, which
    # strands anything priced in the old currency. Catch it here rather than
    # letting the provider raise, or -- worse -- quote a rial price in Stars.
    if not supports_currency(owner.provider, plan.currency):
        await message.answer(t("error.plan_unavailable", locale))
        await _warn_owner_of_stranded_plan(message.bot, owner=owner, plan=plan)
        return

    subscriber = await svc.get_or_create_subscriber(
        session,
        telegram_user_id=message.from_user.id,
        username=message.from_user.username,
        locale=locale,
    )
    subscription = await svc.start_purchase(session, subscriber=subscriber, plan=plan)

    provider = get_provider(owner.provider)
    config = provider_config_for(owner)
    checkout = provider.build_checkout(
        amount=plan.price_amount,
        currency=plan.currency,
        title=f"{plan.title} — {channel.title}",
        locale=locale,
        config=config,
        reference=f"sub{subscription.id}",
    )

    header = t(
        "checkout.title",
        locale,
        plan=plan.title,
        channel=channel.title,
        price=format_money(plan.price_amount, plan.currency, locale),
        days=plan.duration_days,
    )

    if checkout.invoice:
        await message.answer(header)
        await message.answer_invoice(
            title=checkout.invoice["title"],
            description=checkout.invoice["description"],
            payload=checkout.invoice["payload"],
            provider_token=checkout.invoice["provider_token"],
            currency=checkout.invoice["currency"],
            prices=[
                LabeledPrice(label=p["label"], amount=p["amount"])
                for p in checkout.invoice["prices"]
            ],
        )
        return

    await message.answer(
        f"{header}\n\n{checkout.text}",
        reply_markup=kb.checkout_actions(
            subscription.id,
            locale,
            url=checkout.url,
            needs_claim=checkout.needs_claim_button,
        ),
        disable_web_page_preview=True,
    )


async def _warn_owner_of_stranded_plan(bot, *, owner, plan) -> None:
    from app.payments.base import CURRENCY_FOR

    try:
        await bot.send_message(
            owner.telegram_user_id,
            t(
                "owner.provider.mismatch",
                owner.locale,
                count=1,
                old=plan.currency,
                new=owner.provider.value,
                new_currency=CURRENCY_FOR[owner.provider],
            ),
        )
    except TelegramAPIError:
        log.warning("could not warn owner %s about a stranded plan", owner.id)


@router.callback_query(F.data.startswith("buy:"))
async def buy(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    plan_id = int(call.data.split(":", 1)[1])
    await open_checkout(call.message, session=session, locale=locale, plan_id=plan_id)
    await call.answer()


@router.pre_checkout_query()
async def approve_pre_checkout(query: PreCheckoutQuery) -> None:
    # Nothing to reserve, so every well-formed Stars checkout is approved.
    await query.answer(ok=True)


@router.message(F.successful_payment)
async def on_successful_payment(message: Message, session: AsyncSession, locale: str) -> None:
    """Telegram already took the money; record it and let the buyer in."""
    sp = message.successful_payment
    reference = sp.invoice_payload
    try:
        subscription_id = int(reference.removeprefix("sub"))
    except ValueError:
        log.error("unparseable Stars payload %r", reference)
        await message.answer(t("error.generic", locale))
        return

    subscription = await session.get(Subscription, subscription_id)
    if subscription is None:
        await message.answer(t("error.generic", locale))
        return

    payment = await svc.record_payment(
        session,
        subscription=subscription,
        provider=ProviderKind.STARS,
        provider_ref=sp.telegram_payment_charge_id,
        amount=sp.total_amount,
        currency=sp.currency,
        raw_payload=sp.model_dump(mode="json"),
    )
    if payment is None:
        # Telegram redelivered a charge we already processed.
        log.info("duplicate Stars charge %s ignored", sp.telegram_payment_charge_id)
        return

    await grant_access(message.bot, session, payment=payment, actor="telegram")


@router.callback_query(F.data.startswith("claim:"))
async def claim_payment(call: CallbackQuery, session: AsyncSession, locale: str) -> None:
    """Buyer says they paid through a provider we cannot verify automatically."""
    subscription_id = int(call.data.split(":", 1)[1])
    subscription = await session.get(Subscription, subscription_id)
    if subscription is None:
        await call.answer(t("error.generic", locale), show_alert=True)
        return

    plan = await session.get(Plan, subscription.plan_id)
    channel = await session.get(ManagedChannel, subscription.channel_id)
    owner = await session.get(Owner, channel.owner_id)

    payment = await session.scalar(
        select(Payment).where(Payment.subscription_id == subscription.id)
    )
    if payment is None:
        payment = await svc.record_payment(
            session,
            subscription=subscription,
            provider=owner.provider,
            provider_ref=f"claim-{subscription.id}",
            amount=plan.price_amount,
            currency=plan.currency,
            status=PaymentStatus.PENDING,
        )

    await call.message.edit_text(t("checkout.awaiting", locale))
    if payment is not None:
        await _notify_owner_of_claim(
            call, owner=owner, channel=channel, plan=plan, payment=payment
        )
    await call.answer()


async def _notify_owner_of_claim(
    call: CallbackQuery, *, owner, channel, plan, payment
) -> None:
    """Hand the owner the claim and the two buttons that resolve it.

    Without the buttons this notification is a dead end: the buyer has paid and
    nothing in the product can let them in.
    """
    text = (
        f"💰 Payment claimed\n"
        f"Channel: {channel.title}\n"
        f"Plan: {plan.title} — {format_money(plan.price_amount, plan.currency, owner.locale)}\n"
        f"From: @{call.from_user.username or call.from_user.id}"
    )
    try:
        await call.bot.send_message(
            owner.telegram_user_id,
            text,
            reply_markup=kb.claim_review(payment.id, owner.locale),
        )
    except TelegramAPIError:  # the owner may have blocked the bot
        log.warning("could not notify owner %s of a claim", owner.id)


async def grant_access(
    bot, session: AsyncSession, *, payment: Payment, actor: str
) -> None:
    """Confirm a payment and deliver the invite. Safe to call twice.

    Messages go out in the buyer's own language -- whoever triggered the
    confirmation may not share it.
    """
    subscription = await svc.confirm_payment(session, payment=payment, actor=actor)
    if subscription is None:
        return  # already confirmed elsewhere

    channel = await session.get(ManagedChannel, subscription.channel_id)
    subscriber = await session.get(Subscriber, subscription.subscriber_id)
    link = await issue_invite(
        bot, session, subscription=subscription, chat_id=channel.telegram_chat_id
    )
    if link is None:
        await bot.send_message(
            subscriber.telegram_user_id, t("error.generic", subscriber.locale)
        )
        return

    await bot.send_message(
        subscriber.telegram_user_id,
        t(
            "payment.confirmed",
            subscriber.locale,
            channel=channel.title,
            link=link,
            expires=subscription.expires_at.strftime(DATE_FMT),
        ),
        disable_web_page_preview=True,
    )
