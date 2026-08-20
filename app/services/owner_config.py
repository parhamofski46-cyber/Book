"""Resolve the payment credentials a checkout should use.

An owner's own credentials always win -- their subscribers' money must reach
them directly, never this platform. The platform's own card and PayPal details
are only used for the invoices owners pay us, and are read from settings so
they never live in the database or the repository.
"""

from __future__ import annotations

import json
import logging

from app.config import get_settings
from app.db.models import Owner, ProviderKind

log = logging.getLogger(__name__)


def provider_config_for(owner: Owner) -> dict:
    """Credentials for collecting an owner's subscriber payments."""
    if not owner.provider_config:
        return {}
    try:
        config = json.loads(owner.provider_config)
    except json.JSONDecodeError:
        log.error("owner %s has malformed provider_config", owner.id)
        return {}
    return config if isinstance(config, dict) else {}


def set_provider_config(owner: Owner, config: dict) -> None:
    owner.provider_config = json.dumps(config, ensure_ascii=False)


def platform_config(kind: ProviderKind) -> dict:
    """Credentials for the invoices owners pay this platform."""
    s = get_settings()
    if kind is ProviderKind.MANUAL_CARD:
        return {
            "card_number": s.platform_card_number,
            "card_holder": s.platform_card_holder,
        }
    if kind is ProviderKind.PAYPAL:
        return {
            "paypal_account": s.platform_paypal_account,
            "paypal_me": s.platform_paypal_me,
        }
    return {}
