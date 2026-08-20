"""Data model.

Money rules that shaped this schema:

* Subscriber money never touches the platform. Each owner plugs in their own
  payment credentials, so ``Payment`` rows for subscriptions are a record of a
  transaction between the subscriber and the owner -- not a balance we hold.
* Every payment carries a provider-unique reference and is written exactly
  once. Callbacks and manual approvals both go through the same idempotent
  path, so a retried webhook can never grant a second subscription period.
* Anything that changes money or access is mirrored into ``AuditLog``.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SubscriptionStatus(str, enum.Enum):
    PENDING = "pending"      # created, awaiting payment
    ACTIVE = "active"        # paid, inside the channel
    GRACE = "grace"          # expired but still admitted during the grace window
    EXPIRED = "expired"      # removed from the channel
    CANCELLED = "cancelled"  # ended early by the owner


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    REFUNDED = "refunded"


class ProviderKind(str, enum.Enum):
    STARS = "stars"            # Telegram Stars (XTR)
    ZARINPAL = "zarinpal"      # Iranian gateway, IRR
    PAYPAL = "paypal"          # PayPal.me link, manually confirmed
    MANUAL_CARD = "manual_card"  # card-to-card with a unique amount


class OwnerStatus(str, enum.Enum):
    TRIAL = "trial"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    SUSPENDED = "suspended"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Owner(Base, TimestampMixin):
    """A channel owner: the paying customer of this platform."""

    __tablename__ = "owners"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    display_name: Mapped[str | None] = mapped_column(String(128))
    locale: Mapped[str] = mapped_column(String(8), default="en")

    status: Mapped[OwnerStatus] = mapped_column(
        Enum(OwnerStatus, native_enum=False), default=OwnerStatus.TRIAL, index=True
    )
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Which provider this owner collects subscriber money with, plus the
    # credentials for it. Credentials belong to the owner; we only relay them.
    provider: Mapped[ProviderKind] = mapped_column(
        Enum(ProviderKind, native_enum=False), default=ProviderKind.STARS
    )
    provider_config: Mapped[str | None] = mapped_column(Text)  # JSON blob

    # Viral loop: who brought this owner in, and this owner's own code.
    referral_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    referred_by_id: Mapped[int | None] = mapped_column(ForeignKey("owners.id"))

    channels: Mapped[list[ManagedChannel]] = relationship(back_populates="owner")
    referred_by: Mapped[Owner | None] = relationship(remote_side=[id])


class ManagedChannel(Base, TimestampMixin):
    """A private channel or group the bot administers on an owner's behalf."""

    __tablename__ = "managed_channels"
    __table_args__ = (UniqueConstraint("telegram_chat_id", name="uq_channel_chat_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), index=True)
    telegram_chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    title: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Days a lapsed member keeps access before removal. Owners tune this;
    # a short grace window recovers a meaningful share of late renewals.
    grace_days: Mapped[int] = mapped_column(Integer, default=2)

    owner: Mapped[Owner] = relationship(back_populates="channels")
    plans: Mapped[list[Plan]] = relationship(back_populates="channel")


class Plan(Base, TimestampMixin):
    """A subscription tier an owner sells for one channel."""

    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("managed_channels.id"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    duration_days: Mapped[int] = mapped_column(Integer)
    # Minor units for fiat (rial, cent); whole Stars for XTR.
    price_amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(8))  # IRR / USD / XTR
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    channel: Mapped[ManagedChannel] = relationship(back_populates="plans")


class Subscriber(Base, TimestampMixin):
    """An end user buying access to someone's channel."""

    __tablename__ = "subscribers"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    locale: Mapped[str] = mapped_column(String(8), default="en")


class Subscription(Base, TimestampMixin):
    """One subscriber's access to one channel for one period."""

    __tablename__ = "subscriptions"
    __table_args__ = (
        Index("ix_subscription_expiry_sweep", "status", "expires_at"),
        Index("ix_subscription_member", "channel_id", "subscriber_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subscriber_id: Mapped[int] = mapped_column(ForeignKey("subscribers.id"), index=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("managed_channels.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))

    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus, native_enum=False),
        default=SubscriptionStatus.PENDING,
        index=True,
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Guards against sending the same reminder twice when a sweep re-runs.
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    subscriber: Mapped[Subscriber] = relationship()
    channel: Mapped[ManagedChannel] = relationship()
    plan: Mapped[Plan] = relationship()


class Payment(Base, TimestampMixin):
    """A subscriber -> owner transaction. Recorded, never held."""

    __tablename__ = "payments"
    __table_args__ = (
        # The idempotency key. A replayed webhook collides here instead of
        # granting a second period.
        UniqueConstraint("provider", "provider_ref", name="uq_payment_provider_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id"), index=True)
    provider: Mapped[ProviderKind] = mapped_column(Enum(ProviderKind, native_enum=False))
    provider_ref: Mapped[str] = mapped_column(String(128))
    amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(8))
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, native_enum=False), default=PaymentStatus.PENDING, index=True
    )
    raw_payload: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PlatformInvoice(Base, TimestampMixin):
    """What an owner owes the platform. Settled by card transfer and checked
    by hand, so the amount carries a unique suffix that makes each transfer
    identifiable in a bank statement without trusting a screenshot."""

    __tablename__ = "platform_invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), index=True)
    base_amount: Mapped[int] = mapped_column(BigInteger)
    unique_suffix: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(8), default="IRR")
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, native_enum=False), default=PaymentStatus.PENDING, index=True
    )
    period_days: Mapped[int] = mapped_column(Integer, default=30)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by: Mapped[int | None] = mapped_column(BigInteger)  # admin telegram id
    note: Mapped[str | None] = mapped_column(Text)

    owner: Mapped[Owner] = relationship()

    @property
    def total_amount(self) -> int:
        return self.base_amount + self.unique_suffix


class InviteLink(Base, TimestampMixin):
    """A single-use invite issued after a confirmed payment."""

    __tablename__ = "invite_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id"), index=True)
    url: Mapped[str] = mapped_column(String(255))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    """Append-only trail for money and access events."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    actor: Mapped[str] = mapped_column(String(64))       # "system" | "admin:123" | "owner:12"
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    detail: Mapped[str | None] = mapped_column(Text)
