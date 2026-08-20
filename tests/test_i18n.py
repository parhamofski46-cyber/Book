"""Translation coverage. A missing key here is a raw string shown to a customer."""

import json
import pathlib

from app.i18n import SUPPORTED, is_rtl, normalize, t

LOCALES = pathlib.Path("app/i18n/locales")


def test_every_supported_language_ships_a_catalogue():
    for code in SUPPORTED:
        assert (LOCALES / f"{code}.json").exists(), f"{code}.json is missing"


def test_all_catalogues_have_the_same_keys():
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    for code in SUPPORTED:
        other = json.loads((LOCALES / f"{code}.json").read_text(encoding="utf-8"))
        assert set(other) == set(en), f"{code}.json key drift: {set(en) ^ set(other)}"


def test_all_catalogues_share_the_same_placeholders():
    """A placeholder that exists in one language but not another renders wrong."""
    import string

    def fields(template: str) -> set[str]:
        return {f for _, f, _, _ in string.Formatter().parse(template) if f}

    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    for code in SUPPORTED:
        other = json.loads((LOCALES / f"{code}.json").read_text(encoding="utf-8"))
        for key, template in en.items():
            assert fields(template) == fields(other[key]), (
                f"{code}.json placeholder mismatch in {key!r}"
            )


def test_regional_codes_fall_back_to_the_base_language():
    assert normalize("fa-IR") == "fa"
    assert normalize("en-GB") == "en"


def test_unknown_language_falls_back_to_english():
    assert normalize("zz") == "en"
    assert normalize(None) == "en"


def test_missing_key_falls_back_to_english_text():
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    assert t("menu.help", "zz") == en["menu.help"]


def test_rtl_languages_are_flagged():
    assert is_rtl("fa") and is_rtl("ar")
    assert not is_rtl("en") and not is_rtl("ru")


def test_a_bad_placeholder_does_not_raise():
    """A handler must never crash mid-checkout over a formatting slip."""
    assert t("checkout.title", "en") is not None
