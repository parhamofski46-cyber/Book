"""Provider behaviour: rendering, links, and the Stars invoice contract."""

import pytest

from app.db.models import ProviderKind
from app.payments.base import available, format_money, get_provider
from app.payments.paypal import paypal_me_url


def test_zero_decimal_currencies_are_not_divided():
    assert format_money(5_000_000, "IRR", "en").startswith("5,000,000")
    assert format_money(150, "XTR", "en") == "150 ⭐"


def test_decimal_currencies_render_cents():
    assert format_money(1900, "USD", "en") == "$19.00"
    assert format_money(99, "USD", "en") == "$0.99"


def test_persian_rial_uses_the_persian_name():
    assert "ریال" in format_money(500_000, "IRR", "fa")


def test_every_provider_kind_is_registered():
    assert set(available()) == set(ProviderKind)


def test_paypal_link_is_prefilled_from_a_handle():
    url = paypal_me_url("myhandle", 1900, "USD")
    assert url == "https://paypal.me/myhandle/19USD"


def test_paypal_link_is_none_for_a_bare_email():
    """An email address has no PayPal.me form; the address is shown instead."""
    assert paypal_me_url("someone@example.com", 1900, "USD") is None


def test_paypal_checkout_shows_the_account_when_there_is_no_link():
    checkout = get_provider(ProviderKind.PAYPAL).build_checkout(
        amount=1900,
        currency="USD",
        title="Monthly",
        locale="en",
        config={"paypal_account": "someone@example.com", "paypal_me": ""},
        reference="ref1",
    )
    assert "someone@example.com" in checkout.text
    assert checkout.needs_claim_button is True
    assert checkout.url is None


def test_stars_invoice_uses_an_empty_provider_token():
    """Telegram rejects Stars invoices that carry a provider token."""
    checkout = get_provider(ProviderKind.STARS).build_checkout(
        amount=150,
        currency="XTR",
        title="Monthly",
        locale="en",
        config={},
        reference="sub42",
    )
    assert checkout.invoice["provider_token"] == ""
    assert checkout.invoice["currency"] == "XTR"
    assert checkout.invoice["payload"] == "sub42"
    assert checkout.invoice["prices"][0]["amount"] == 150


def test_stars_rejects_non_star_pricing():
    with pytest.raises(ValueError):
        get_provider(ProviderKind.STARS).build_checkout(
            amount=1000,
            currency="IRR",
            title="Monthly",
            locale="en",
            config={},
            reference="x",
        )


def test_manual_card_checkout_states_the_exact_amount():
    checkout = get_provider(ProviderKind.MANUAL_CARD).build_checkout(
        amount=5_001_234,
        currency="IRR",
        title="Monthly",
        locale="fa",
        config={"card_number": "6037-1111", "card_holder": "Someone"},
        reference="inv1",
    )
    assert "5,001,234" in checkout.text
    assert "6037-1111" in checkout.text
    assert checkout.needs_claim_button is True
