import secrets

from app.db.models import ManagedChannel, Owner, Plan, Subscriber


async def make_owner(session, **kw) -> Owner:
    owner = Owner(
        telegram_user_id=kw.get("telegram_user_id", secrets.randbelow(10**9)),
        referral_code=kw.get("referral_code", secrets.token_hex(4)),
        **{k: v for k, v in kw.items() if k not in {"telegram_user_id", "referral_code"}},
    )
    session.add(owner)
    await session.flush()
    return owner


async def make_channel(session, owner, **kw) -> ManagedChannel:
    ch = ManagedChannel(
        owner_id=owner.id,
        telegram_chat_id=kw.get("telegram_chat_id", -secrets.randbelow(10**9)),
        title=kw.get("title", "Test channel"),
        grace_days=kw.get("grace_days", 2),
    )
    session.add(ch)
    await session.flush()
    return ch


async def make_plan(session, channel, *, days=30, price=100, currency="XTR") -> Plan:
    plan = Plan(
        channel_id=channel.id,
        title="Monthly",
        duration_days=days,
        price_amount=price,
        currency=currency,
    )
    session.add(plan)
    await session.flush()
    return plan


async def make_subscriber(session, **kw) -> Subscriber:
    sub = Subscriber(
        telegram_user_id=kw.get("telegram_user_id", secrets.randbelow(10**9)),
        locale=kw.get("locale", "en"),
    )
    session.add(sub)
    await session.flush()
    return sub
